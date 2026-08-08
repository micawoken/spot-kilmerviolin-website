/**
 * tests/scripts/publication.test.ts
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

import { describe, it, expect } from "vitest"

import { renderPublicationUri } from "../../src/scripts/publication"

describe("renderPublicationUri", () => {
    it("links an https URI as a clickable anchor", () => {
        const html = renderPublicationUri("https", "https://example.test/score", "(none)")
        expect(html).toContain('href="https://example.test/score"')
        expect(html).toContain(">https://example.test/score<")
    })

    it("renders a non-https URI value as inert escaped text (defense-in-depth)", () => {
        const html = renderPublicationUri("https", "javascript:alert(1)", "(none)")
        expect(html).not.toContain("<a ")
        expect(html).toContain("javascript:alert(1)")
    })

    it("links a DOI to its doi.org resolver", () => {
        const html = renderPublicationUri("doi", "10.1000/182", "(none)")
        expect(html).toContain('href="https://doi.org/10.1000/182"')
        expect(html).toContain(">10.1000/182<")
    })

    it("links an ISBN to its WorldCat lookup", () => {
        const html = renderPublicationUri("isbn", "9780306406157", "(none)")
        expect(html).toContain('href="https://www.worldcat.org/isbn/9780306406157"')
        expect(html).toContain(">9780306406157<")
    })

    it("strips whitespace and dashes from an ISBN before building the WorldCat link", () => {
        const html = renderPublicationUri("isbn", "978-0-306-40615-7", "(none)")
        expect(html).toContain('href="https://www.worldcat.org/isbn/9780306406157"')
    })

    it("returns the placeholder for a null, undefined, or blank URI", () => {
        expect(renderPublicationUri("https", null, "(none)")).toBe("(none)")
        expect(renderPublicationUri("https", undefined, "(none)")).toBe("(none)")
        expect(renderPublicationUri("https", "   ", "(none)")).toBe("(none)")
    })

    it("renders the bare value for an unknown uri_type", () => {
        expect(renderPublicationUri("carrier-pigeon", "some-value", "(none)")).toBe("some-value")
    })

    it("escapes an untrusted value (XSS defense-in-depth)", () => {
        const html = renderPublicationUri("isbn", "<script>alert(1)</script>", "(none)")
        expect(html).not.toContain("<script>")
        expect(html).toContain("&lt;script&gt;")
    })
})
