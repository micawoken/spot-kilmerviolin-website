/**
 * tests/compositor/render.test.tsx
 *
 * Exercises the BUILD render path end to end (§6.6): a stored design document, through
 * `buildConfig(theme, "build")`, through Puck's static `Render`, to HTML. This is the path
 * `pages/[...slug].astro` uses for a published design page.
 *
 * It guards two things a passing build does not: that the "build" target's passthrough field really
 * delivers stored Portable Text to the renderer (Puck's native richtext field would blank it — the
 * reason the dual-target config exists, §6.3), and that the output carries no JavaScript.
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

import { Render } from "@puckeditor/core/rsc"
import type { Data } from "@puckeditor/core"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, it, expect } from "vitest"

import { buildConfig } from "../../src/lib/compositor/catalog"
import { RichTextView } from "../../src/lib/compositor/richtext"
import { EMPTY_TOKEN_CATALOG, type TokenCatalog } from "../../src/lib/compositor/tokens"

const theme: TokenCatalog = {
    schemaVersion: 1,
    colors: [{ name: "surface", value: "#fff8f0" }],
    typography: [
        { name: "display", family: "Georgia, serif", size: "2rem", weight: "700", lineHeight: "1.2" }
    ],
    space: [{ name: "md", value: "1rem" }],
    radius: [],
    shadows: [],
    borders: [],
    breakpoints: []
}

/** A Section wrapping a Heading and a RichText whose body is STORED Portable Text (not ProseMirror). */
const doc = {
    root: { props: {} },
    content: [
        {
            type: "Section",
            props: {
                id: "section-1",
                background: "surface",
                paddingY: "md",
                content: [
                    {
                        type: "Heading",
                        props: { id: "heading-1", text: "Recitals", level: "h1", typography: "display", align: "start" }
                    },
                    {
                        type: "RichText",
                        props: {
                            id: "richtext-1",
                            body: [
                                {
                                    _type: "block",
                                    _key: "b1",
                                    style: "normal",
                                    children: [{ _type: "span", _key: "s1", text: "Hello from Portable Text", marks: [] }],
                                    markDefs: []
                                }
                            ]
                        }
                    }
                ]
            }
        }
    ]
}

function render(catalog: TokenCatalog): string {
    return renderToStaticMarkup(
        <Render config={buildConfig(catalog, "build")} data={doc as unknown as Data} />
    )
}

describe("build render path", () => {
    it("renders the stored Portable Text body (the build passthrough is not blanked)", () => {
        expect(render(theme)).toContain("Hello from Portable Text")
    })

    it("renders the heading at its authored level", () => {
        expect(render(theme)).toMatch(/<h1[^>]*>Recitals<\/h1>/)
    })

    it("emits the component classes the stylesheet targets", () => {
        const html = render(theme)
        expect(html).toContain("cmp-section")
        expect(html).toContain("cmp-heading")
        expect(html).toContain("cmp-richtext")
    })

    it("resolves token props to --dtk-* custom properties", () => {
        const html = render(theme)
        // Kind prefixes are abbreviated by tokenVarName (colors → color, typography → type).
        expect(html).toContain("var(--dtk-color-surface)")
        expect(html).toContain("var(--dtk-space-md)")
        expect(html).toContain("var(--dtk-type-display-size)")
    })

    it("ships zero JavaScript", () => {
        const html = render(theme)
        expect(html).not.toContain("<script")
        expect(html).not.toContain("astro-island")
    })

    it("still renders structurally when no theme is published", () => {
        const html = render(EMPTY_TOKEN_CATALOG)
        expect(html).toContain("Hello from Portable Text")
        expect(html).toMatch(/<h1[^>]*>Recitals<\/h1>/)
    })
})

describe("rich text link targets", () => {
    /** One block whose whole text carries a link mark with the given markDef fields. */
    function renderLink(markDef: Record<string, unknown>): string {
        const value = [
            {
                _type: "block",
                _key: "b1",
                style: "normal",
                children: [{ _type: "span", _key: "s1", text: "source", marks: ["l1"] }],
                markDefs: [{ _type: "link", _key: "l1", ...markDef }]
            }
        ]
        return renderToStaticMarkup(<RichTextView value={value as never} />)
    }

    it("opens a site-relative link in the same tab", () => {
        const html = renderLink({ href: "/composers/maier" })
        expect(html).toContain('href="/composers/maier"')
        expect(html).not.toContain("target=")
    })

    it("opens a fragment link in the same tab", () => {
        expect(renderLink({ href: "#sources" })).not.toContain("target=")
    })

    it("opens an off-site link in a new tab, with rel", () => {
        const html = renderLink({ href: "https://imslp.org" })
        expect(html).toContain('target="_blank"')
        expect(html).toContain('rel="noopener noreferrer"')
    })

    it.each(["mailto:info@example.com", "tel:+15551234567"])("opens %s in a new tab", (href) => {
        expect(renderLink({ href })).toContain('target="_blank"')
    })

    // The regression this rule exists for. Both editors stamp target="_blank" on every link they produce
    // (Tiptap's Link default, which neither overrides), so honouring `blank` opened internal links in a
    // new tab — see richtext.tsx's opensInNewTab.
    it("ignores blank: true on an internal link", () => {
        expect(renderLink({ href: "/database", blank: true })).not.toContain("target=")
    })

    it("honours an explicit target over the scheme, both ways", () => {
        expect(renderLink({ href: "/database", target: "_blank" })).toContain('target="_blank"')
        expect(renderLink({ href: "https://imslp.org", target: "_self" })).not.toContain("target=")
    })

    it("keeps an unsafe href in the same tab once sanitized to #", () => {
        const html = renderLink({ href: "javascript:alert(1)" })
        expect(html).toContain('href="#"')
        expect(html).not.toContain("target=")
    })
})
