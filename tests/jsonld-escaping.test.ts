/**
 * tests/jsonld-escaping.test.ts
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This file is part of the spot-kilmerviolin-website program, available at
 * https://github.com/micawoken/spot-kilmerviolin-website.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * This license is also subject to additional terms as specified in the README.md.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Regression coverage for security audit SEC-004.
 *
 * `<script type="application/ld+json">` is a raw-text element: nothing inside it is HTML-decoded, and the
 * only sequence that can end it is a closing tag. JSON encoding does not escape `<`, so a stored entity
 * value containing `</script>` used to close the element and inject markup into the public page.
 *
 * The rendered markup is put through a real HTML parser rather than string-matched, so these fail if a
 * payload ever becomes an element again - the proof the audit asked for.
 */

import { describe, it, expect } from "vitest"
import { serializeJsonForHtml } from "../src/lib/public/json"

interface ParsedJsonLd {
    /** Every element the parser found, in document order. */
    elements: string[]
    /** The raw text the parser left inside the script element. */
    scriptText: string
}

/** Renders a JSON-LD block the way EntityStructuredData.astro does, then parses it with HTMLRewriter. */
async function renderJsonLd(value: unknown): Promise<ParsedJsonLd> {
    const html = `<script type="application/ld+json">${serializeJsonForHtml(value)}</script>`
    const elements: string[] = []
    let scriptText = ""
    const parsed = new HTMLRewriter()
        .on("*", {
            element(element) {
                elements.push(element.tagName)
            }
        })
        .on("script", {
            text(chunk) {
                scriptText += chunk.text
            }
        })
        .transform(new Response(html))
    await parsed.text()
    return { elements, scriptText }
}

describe("serializeJsonForHtml", () => {
    it("escapes every < so no tag can be opened or closed", () => {
        expect(serializeJsonForHtml({ name: "</script>" })).not.toContain("<")
        expect(serializeJsonForHtml({ name: "a < b" })).toBe('{"name":"a \\u003c b"}')
    })

    it("round-trips through JSON.parse unchanged", () => {
        const value = { name: "</script><style>x</style>", nested: { list: ["<p>", "</SCRIPT >"] } }
        expect(JSON.parse(serializeJsonForHtml(value))).toEqual(value)
    })

    it("leaves ordinary values byte-identical to JSON.stringify", () => {
        const value = { "@type": "Person", name: "Fritz Kreisler", born: 1875, alive: false, x: null }
        expect(serializeJsonForHtml(value)).toBe(JSON.stringify(value))
    })
})

describe("JSON-LD rendered into a raw-text script element", () => {
    it("keeps a </script> payload inside the script element instead of injecting markup", async () => {
        const value = { "@type": "Person", name: '</script><p id="pwn">owned</p>' }
        const { elements, scriptText } = await renderJsonLd(value)

        expect(elements).toEqual(["script"])
        expect(JSON.parse(scriptText)).toEqual(value)
    })

    it("keeps the payload the audit used verbatim as parseable JSON data", async () => {
        const value = { "@type": "Person", name: "</script><style>body{display:none}</style>" }
        const { elements, scriptText } = await renderJsonLd(value)

        expect(elements).toEqual(["script"])
        expect(JSON.parse(scriptText)).toEqual(value)
    })

    it("resists case and whitespace variants of the closing tag", async () => {
        for (const payload of ["</script>", "</SCRIPT>", "</script >", "</script\tbar>", "<!--<script>"]) {
            const value = { name: payload }
            const { elements, scriptText } = await renderJsonLd(value)

            expect(elements).toEqual(["script"])
            expect(JSON.parse(scriptText)).toEqual(value)
        }
    })
})
