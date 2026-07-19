/**
 * tests/compositor/render-zero-js.test.ts
 *
 * Fixture-level zero-JS gate for the templated render path (pivot §6 Phase B gate 2). Drives the same
 * renderer `[...slug].astro` uses — Puck's RSC `<Render>` over `buildConfig(theme, "build", { entry })`
 * — across a design doc that exercises every content outlet, and asserts the emitted HTML carries the
 * entry's values and NO client JavaScript (no <script>, no <astro-island>). The dist-level sweep
 * (tools/check-zero-js.mjs) still runs against a real templated page once one exists on prod (gate 4);
 * this test is the deterministic local stand-in, per the recorded-fixtures convention.
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
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
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { Render } from "@puckeditor/core/rsc"

import { buildConfig } from "../../src/lib/compositor/catalog"
import type { TokenCatalog } from "../../src/lib/compositor/tokens"
import type { PuckData } from "../../src/lib/compositor/types"

const theme: TokenCatalog = {
    schemaVersion: 1,
    colors: [{ name: "page-bg", value: "#fff" }],
    typography: [{ name: "display", family: "serif", size: "2rem", weight: "700", lineHeight: "1.2" }],
    space: [{ name: "md", value: "2rem" }],
    radius: [],
    shadows: [],
    borders: [],
    breakpoints: []
}

const entry = {
    title: "The routed entry",
    body: [
        {
            _type: "block",
            _key: "b1",
            style: "normal",
            markDefs: [],
            children: [{ _type: "span", _key: "s1", text: "Body text from the entry.", marks: [] }]
        }
    ],
    // EmDash's real local-media wire shape: `src` stripped on persist, key at `meta.storageKey`.
    cover: { id: "med_9", alt: "Cover art", width: 640, height: 480, provider: "local", meta: { storageKey: "med_9.jpg" } }
}

/** The public media origin a prerendered page must reference (EMDASH_MEDIA_PUBLIC_URL). */
const MEDIA_ORIGIN = "https://store.example.test"

/** A template doc exercising a slot plus every content outlet, in stored (build-path) form. */
const templatedDoc = {
    root: { props: {} },
    content: [
        {
            type: "Section",
            props: {
                id: "s-1",
                background: "",
                paddingY: "md",
                content: [
                    {
                        type: "ContentText",
                        props: { id: "c-1", field: "title", level: "h1", typography: "display", align: "start" }
                    },
                    { type: "ContentImage", props: { id: "c-2", field: "cover", aspect: "landscape" } },
                    { type: "ContentRichText", props: { id: "c-3", field: "body" } }
                ]
            }
        }
    ]
} as unknown as PuckData

describe("templated render path — zero client JS", () => {
    const config = buildConfig(theme, "build", { entry, mediaBaseUrl: MEDIA_ORIGIN })
    const html = renderToStaticMarkup(createElement(Render, { config, data: templatedDoc }))

    it("renders the entry's values through the outlets", () => {
        expect(html).toContain("The routed entry")
        expect(html).toContain("Body text from the entry.")
        expect(html).toContain(`src="${MEDIA_ORIGIN}/med_9.jpg"`)
        expect(html).toContain('alt="Cover art"')
    })

    it("references no Access-gated URL — every visitor of a prerendered page is anonymous", () => {
        expect(html).not.toContain("/_emdash")
    })

    it("emits no client JavaScript or island markers", () => {
        expect(html).not.toMatch(/<script[\s>]/i)
        expect(html).not.toMatch(/<astro-island[\s>]/i)
    })

    it("renders outlets to nothing (not placeholders) when the design_page path has no entry", () => {
        const bare = renderToStaticMarkup(
            createElement(Render, { config: buildConfig(theme, "build"), data: templatedDoc })
        )
        expect(bare).not.toContain("The routed entry")
        expect(bare).not.toContain("cmp-outlet-placeholder")
        expect(bare).toContain("cmp-section") // the layout itself still renders
    })
})
