/**
 * tests/compositor/theme-controls.test.ts
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

import {
    bestTextColorFor,
    formatClamp,
    formatLength,
    formatLightDark,
    formatShadow,
    isHexColor,
    parseClamp,
    parseCssColorToRgb,
    parseLength,
    parseLightDark,
    parseShadow,
    relativeLuminance,
    splitTopLevel,
    type ShadowLayer
} from "../../src/lib/compositor/theme-controls"

describe("splitTopLevel", () => {
    it("splits at the top level only, keeping separators inside parens", () => {
        expect(splitTopLevel("a, b, c", ",")).toEqual(["a", " b", " c"])
        expect(splitTopLevel("rgb(0, 0, 0), red", ",")).toEqual(["rgb(0, 0, 0)", " red"])
    })

    it("handles nested parens", () => {
        expect(splitTopLevel("clamp(1rem, calc(1vw + 1rem), 2rem)", ",")).toEqual([
            "clamp(1rem, calc(1vw + 1rem), 2rem)"
        ])
    })

    it("returns the whole string when the separator is absent", () => {
        expect(splitTopLevel("solid", ",")).toEqual(["solid"])
    })
})

describe("parseLightDark / formatLightDark", () => {
    it("round-trips a simple pair", () => {
        const parsed = parseLightDark("light-dark(#ffffff, #1a1a1a)")
        expect(parsed).toEqual({ light: "#ffffff", dark: "#1a1a1a" })
        expect(formatLightDark(parsed!)).toBe("light-dark(#ffffff, #1a1a1a)")
    })

    it("respects nested rgb() in a channel", () => {
        const parsed = parseLightDark("light-dark(rgb(255, 255, 255), #000)")
        expect(parsed).toEqual({ light: "rgb(255, 255, 255)", dark: "#000" })
    })

    it("returns null for a non-light-dark color", () => {
        expect(parseLightDark("#2337ff")).toBeNull()
        expect(parseLightDark("red")).toBeNull()
    })

    it("returns null for the wrong argument count or trailing text", () => {
        expect(parseLightDark("light-dark(#fff)")).toBeNull()
        expect(parseLightDark("light-dark(#fff, #000, #ccc)")).toBeNull()
        expect(parseLightDark("light-dark(#fff, #000) 1px")).toBeNull()
    })
})

describe("isHexColor", () => {
    it("accepts 3/4/6/8-digit hex", () => {
        expect(isHexColor("#fff")).toBe(true)
        expect(isHexColor("#ffff")).toBe(true)
        expect(isHexColor("#7a1f2a")).toBe(true)
        expect(isHexColor("#7a1f2aff")).toBe(true)
    })

    it("rejects non-hex color forms", () => {
        expect(isHexColor("red")).toBe(false)
        expect(isHexColor("rgb(0,0,0)")).toBe(false)
        expect(isHexColor("#12")).toBe(false)
        expect(isHexColor("light-dark(#fff, #000)")).toBe(false)
    })
})

describe("parseLength / formatLength", () => {
    it("round-trips number and unit exactly", () => {
        for (const value of ["2rem", "1px", "0", ".5rem", "-0.02em", "100%", "48ch", "2.50rem"]) {
            const parsed = parseLength(value)
            expect(parsed, value).not.toBeNull()
            expect(formatLength(parsed!)).toBe(value)
        }
    })

    it("splits the numeric and unit parts", () => {
        expect(parseLength("2rem")).toEqual({ number: "2", unit: "rem" })
        expect(parseLength("0")).toEqual({ number: "0", unit: "" })
    })

    it("returns null for expressions and unknown units", () => {
        expect(parseLength("clamp(1rem, 5vw, 3rem)")).toBeNull()
        expect(parseLength("calc(100% - 2rem)")).toBeNull()
        expect(parseLength("var(--x)")).toBeNull()
        expect(parseLength("2fr")).toBeNull()
        expect(parseLength("auto")).toBeNull()
    })
})

describe("parseClamp / formatClamp", () => {
    it("round-trips the load-bearing md centering clamp", () => {
        const value = "clamp(1rem, calc(50% - 30rem), 50%)"
        const parsed = parseClamp(value)
        expect(parsed).toEqual({ min: "1rem", preferred: "calc(50% - 30rem)", max: "50%" })
        expect(formatClamp(parsed!)).toBe(value)
    })

    it("returns null unless it is exactly clamp() with three arguments", () => {
        expect(parseClamp("2rem")).toBeNull()
        expect(parseClamp("clamp(1rem, 2rem)")).toBeNull()
        expect(parseClamp("clamp(1rem, 2rem, 3rem, 4rem)")).toBeNull()
        expect(parseClamp("clamp(1rem, , 3rem)")).toBeNull()
    })
})

describe("parseShadow / formatShadow", () => {
    it("round-trips a single layer with a nested rgba color", () => {
        const value = "0 1px 3px rgba(0, 0, 0, 0.12)"
        const parsed = parseShadow(value)
        expect(parsed).toEqual([
            { inset: false, x: "0", y: "1px", blur: "3px", spread: "", color: "rgba(0, 0, 0, 0.12)" }
        ])
        expect(formatShadow(parsed!)).toBe(value)
    })

    it("round-trips a two-layer shadow with an inset spread layer", () => {
        const value = "0 1px 2px #0003, inset 0 0 0 1px #fff"
        const parsed = parseShadow(value)
        expect(parsed).toEqual([
            { inset: false, x: "0", y: "1px", blur: "2px", spread: "", color: "#0003" },
            { inset: true, x: "0", y: "0", blur: "0", spread: "1px", color: "#fff" }
        ] satisfies ShadowLayer[])
        expect(formatShadow(parsed!)).toBe(value)
    })

    it("treats none as an empty layer list and formats it back", () => {
        expect(parseShadow("none")).toEqual([])
        expect(formatShadow([])).toBe("none")
    })

    it("inserts a 0 blur when a spread has no blur", () => {
        // A parsed layer cannot express spread-without-blur (parse assigns lengths in order), but a
        // builder-constructed layer can, and CSS needs the placeholder blur to read the spread correctly.
        const layer: ShadowLayer = { inset: false, x: "0", y: "0", blur: "", spread: "2px", color: "#000" }
        expect(formatShadow([layer])).toBe("0 0 0 2px #000")
    })

    it("returns null for ambiguous or empty input", () => {
        expect(parseShadow("")).toBeNull()
        expect(parseShadow("0")).toBeNull() // only one offset
        expect(parseShadow("0 0 0 0 0")).toBeNull() // five lengths
        expect(parseShadow("0 0 red blue")).toBeNull() // two colors
    })
})

describe("parseCssColorToRgb", () => {
    it("parses hex colors, expanding shorthand and ignoring alpha", () => {
        expect(parseCssColorToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 })
        expect(parseCssColorToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 })
        expect(parseCssColorToRgb("#f00")).toEqual({ r: 255, g: 0, b: 0 })
        expect(parseCssColorToRgb("#00ff0080")).toEqual({ r: 0, g: 255, b: 0 })
    })

    it("parses rgb()/rgba(), including percentage channels", () => {
        expect(parseCssColorToRgb("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30 })
        expect(parseCssColorToRgb("rgba(255, 0, 0, 0.5)")).toEqual({ r: 255, g: 0, b: 0 })
        expect(parseCssColorToRgb("rgb(100%, 0%, 0%)")).toEqual({ r: 255, g: 0, b: 0 })
    })

    it("parses hsl()/hsla() via the standard conversion", () => {
        expect(parseCssColorToRgb("hsl(0, 100%, 50%)")).toEqual({ r: 255, g: 0, b: 0 })
        expect(parseCssColorToRgb("hsl(120, 100%, 50%)")).toEqual({ r: 0, g: 255, b: 0 })
        expect(parseCssColorToRgb("hsla(0, 0%, 0%, 1)")).toEqual({ r: 0, g: 0, b: 0 })
    })

    it("returns null for named colors and other functions it does not parse", () => {
        expect(parseCssColorToRgb("red")).toBeNull()
        expect(parseCssColorToRgb("var(--dtk-color-ink)")).toBeNull()
        expect(parseCssColorToRgb("oklch(0.7 0.15 30)")).toBeNull()
        expect(parseCssColorToRgb("")).toBeNull()
    })
})

describe("relativeLuminance", () => {
    it("is 0 for black and 1 for white", () => {
        expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0)
        expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBe(1)
    })
})

describe("bestTextColorFor", () => {
    it("picks white text on dark backgrounds and black text on light backgrounds", () => {
        expect(bestTextColorFor("#000000")).toBe("#ffffff")
        expect(bestTextColorFor("#ffffff")).toBe("#000000")
        expect(bestTextColorFor("#111111")).toBe("#ffffff")
        expect(bestTextColorFor("#eeeeee")).toBe("#000000")
    })

    it("returns null for a background it cannot parse, rather than guessing", () => {
        expect(bestTextColorFor("var(--dtk-color-ink)")).toBeNull()
        expect(bestTextColorFor("papayawhip")).toBeNull()
    })
})
