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
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
 *
 * This license is also subject to additional terms as specified in the README.md.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { Render } from "@puckeditor/core/rsc"
import type { Data } from "@puckeditor/core"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, it, expect } from "vitest"

import { buildConfig } from "../../src/lib/compositor/catalog"
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
