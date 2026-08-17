/**
 * tests/build/theme-fonts.test.ts
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
 * Guards the preload/`font-display: optional` lockstep invariant (`unpreloadedOptionalFaces`)
 */

import { describe, it, expect } from "vitest"

import { unpreloadedOptionalFaces } from "../../src/lib/build/theme-fonts"

/** One `@font-face` block in the exact shape `localizeThemeFonts` emits. */
function block(url: string, display: "optional" | "swap"): string {
    return (
        `@font-face{font-family:"Spectral";src:url("${url}") format("woff2");` +
        `font-weight:400;font-style:normal;unicode-range:U+0000-00FF;font-display:${display};}`
    )
}

describe("unpreloadedOptionalFaces", () => {
    it("passes when every optional face is preloaded", () => {
        const fonts = {
            fontFaceCss: [block("/fonts/theme/a.woff2", "optional"), block("/fonts/theme/b.woff2", "swap")].join("\n"),
            preloadHrefs: ["/fonts/theme/a.woff2"]
        }
        expect(unpreloadedOptionalFaces(fonts)).toEqual([])
    })

    it("flags an optional face with no preload - the silent cold-load failure", () => {
        const fonts = {
            fontFaceCss: block("/fonts/theme/a.woff2", "optional"),
            preloadHrefs: []
        }
        expect(unpreloadedOptionalFaces(fonts)).toEqual(["/fonts/theme/a.woff2"])
    })

    it("does not flag a swap face without a preload - swap is the correct un-preloaded pairing", () => {
        const fonts = { fontFaceCss: block("/fonts/theme/b.woff2", "swap"), preloadHrefs: [] }
        expect(unpreloadedOptionalFaces(fonts)).toEqual([])
    })

    it("reports every offender, not just the first", () => {
        const fonts = {
            fontFaceCss: [block("/fonts/theme/a.woff2", "optional"), block("/fonts/theme/b.woff2", "optional")].join("\n"),
            preloadHrefs: []
        }
        expect(unpreloadedOptionalFaces(fonts)).toEqual(["/fonts/theme/a.woff2", "/fonts/theme/b.woff2"])
    })

    it("holds for an empty manifest (no theme, or a failed theme read)", () => {
        expect(unpreloadedOptionalFaces({ fontFaceCss: "", preloadHrefs: [] })).toEqual([])
    })

    it("is not fooled by a preload for a DIFFERENT face", () => {
        const fonts = {
            fontFaceCss: block("/fonts/theme/a.woff2", "optional"),
            preloadHrefs: ["/fonts/theme/z.woff2"]
        }
        expect(unpreloadedOptionalFaces(fonts)).toEqual(["/fonts/theme/a.woff2"])
    })

    it("ignores a face whose block declares no font-display at all", () => {
        const fonts = {
            fontFaceCss: '@font-face{font-family:"Spectral";src:url("/fonts/theme/a.woff2") format("woff2");}',
            preloadHrefs: []
        }
        expect(unpreloadedOptionalFaces(fonts)).toEqual([])
    })
})
