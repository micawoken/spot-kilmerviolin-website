/**
 * tests/compositor/theme-presets.test.ts
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

import { applyThemePreset, PRESET_CORE_NAMES, THEME_PRESETS } from "../../src/lib/compositor/theme-presets"
import { contrastRatio, parseCssColorToRgb, parseLightDark } from "../../src/lib/compositor/theme-controls"
import {
    isTokenCatalog,
    isValidTokenName,
    lintTokenCatalog,
    lintTokenValues,
    referencedFontFaces,
    fontFaceKey,
    type TokenCatalog
} from "../../src/lib/compositor/tokens"

/** The light or dark channel of a named color token, as RGB */
function channel(catalog: TokenCatalog, name: string, scheme: "light" | "dark") {
    const value = catalog.colors.find((token) => token.name === name)?.value ?? ""
    const pair = parseLightDark(value)
    const rgb = parseCssColorToRgb(pair ? pair[scheme] : value)
    if (!rgb) throw new Error(`color ${name} (${scheme}) is not parseable: ${value}`)
    return rgb
}

/** [foreground, background, minimum ratio] pairs every preset must meet in both schemes */
const CONTRAST_PAIRS: Array<[string, string, number]> = [
    ["ink", "paper", 7],
    ["ink", "surface", 7],
    ["muted", "paper", 4.5],
    ["muted", "surface", 4.5],
    ["accent", "paper", 4.5],
    ["accent", "surface", 4.5],
    ["accent-strong", "paper", 4.5],
    ["on-accent", "accent", 4.5]
]

describe("THEME_PRESETS", () => {
    it("has unique, valid ids", () => {
        const ids = THEME_PRESETS.map((preset) => preset.id)
        expect(new Set(ids).size).toBe(ids.length)
        for (const id of ids) expect(isValidTokenName(id)).toBe(true)
    })

    for (const preset of THEME_PRESETS) {
        describe(preset.label, () => {
            const { catalog } = preset

            it("is a structurally valid catalog with safe values and resolvable references", () => {
                expect(isTokenCatalog(catalog)).toBe(true)
                expect(lintTokenValues(catalog)).toEqual([])
                expect(lintTokenCatalog(catalog)).toEqual([])
            })

            it("defines the shared core vocabulary", () => {
                for (const [kind, names] of Object.entries(PRESET_CORE_NAMES)) {
                    const defined = (catalog[kind as keyof typeof PRESET_CORE_NAMES] ?? []).map((token) => token.name)
                    for (const name of names) expect(defined, `${kind}:${name}`).toContain(name)
                }
            })

            it("wires every Site Chrome role to a token that exists", () => {
                const kindOf: Record<string, keyof TokenCatalog> = {
                    hairlineBorder: "borders",
                    headingTypography: "typography",
                    paragraphTypography: "typography"
                }
                for (const [role, name] of Object.entries(catalog.siteChrome ?? {})) {
                    const kind = kindOf[role] ?? (/Space/.test(role) ? "space" : "colors")
                    const names = (catalog[kind] as Array<{ name: string }>).map((token) => token.name)
                    expect(names, `${role} -> ${name}`).toContain(name)
                }
                expect(catalog.breakpoints.map((token) => token.name)).toContain(catalog.layoutStackBreakpoint)
                for (const border of catalog.borders) {
                    expect(catalog.colors.map((token) => token.name)).toContain(border.colorRef)
                }
            })

            it("is adaptive, with every color a light-dark() pair", () => {
                expect(catalog.colorScheme).toBe("adaptive")
                for (const token of catalog.colors) {
                    if (token.name === "transparent") continue
                    expect(parseLightDark(token.value), token.name).not.toBeNull()
                }
            })

            for (const scheme of ["light", "dark"] as const) {
                it(`meets its contrast floor in the ${scheme} scheme`, () => {
                    for (const [fg, bg, min] of CONTRAST_PAIRS) {
                        const ratio = contrastRatio(channel(catalog, fg, scheme), channel(catalog, bg, scheme))
                        expect(ratio, `${fg} on ${bg}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min)
                    }
                })
            }

            it("loads a web font face for every family and weight its typography uses", () => {
                const loaded = new Set(
                    (catalog.fonts ?? []).flatMap((font) => (font.weights ?? [400]).map((weight) => fontFaceKey(font.family, String(weight))))
                )
                for (const face of referencedFontFaces(catalog)) expect(loaded, face).toContain(face)
            })
        })
    }

    it("gives each extra categorical color legible contrast on paper", () => {
        for (const preset of THEME_PRESETS) {
            const core = new Set<string>(PRESET_CORE_NAMES.colors)
            for (const token of preset.catalog.colors.filter((color) => !core.has(color.name))) {
                for (const scheme of ["light", "dark"] as const) {
                    const ratio = contrastRatio(channel(preset.catalog, token.name, scheme), channel(preset.catalog, "paper", scheme))
                    expect(ratio, `${preset.id} ${token.name} ${scheme}`).toBeGreaterThanOrEqual(4.5)
                }
            }
        }
    })
})

describe("applyThemePreset", () => {
    const preset = THEME_PRESETS[0].catalog
    const current: TokenCatalog = {
        schemaVersion: 1,
        colors: [
            { name: "garnet", value: "#7b2d26" },
            { name: "cream", value: "#fffaf0" }
        ],
        typography: [],
        space: [{ name: "huge", value: "8rem" }],
        radius: [{ name: "pill", value: "999px" }],
        shadows: [],
        borders: [{ name: "garnet-rule", width: "2px", style: "solid", colorRef: "garnet" }],
        breakpoints: [],
        buttonVariants: [
            { name: "cta", background: "cream", text: "garnet", radius: "pill", paddingX: "huge", paddingY: "sm", border: "garnet-rule" }
        ]
    }

    it("returns the preset unchanged when no design references anything", () => {
        const result = applyThemePreset(preset, current, new Map())
        expect(result.catalog).toEqual(preset)
        expect(result.carried).toEqual([])
        expect(result.missing).toEqual([])
    })

    it("does not mutate the preset", () => {
        const before = structuredClone(preset)
        applyThemePreset(preset, current, new Map([["colors:garnet", ["Home"]]]))
        expect(preset).toEqual(before)
    })

    it("keeps preset tokens over current ones of the same name", () => {
        const result = applyThemePreset(preset, { ...current, colors: [{ name: "accent", value: "#000000" }] }, new Map([["colors:accent", ["Home"]]]))
        expect(result.catalog.colors.find((token) => token.name === "accent")?.value).not.toBe("#000000")
        expect(result.carried).toEqual([])
    })

    it("carries referenced tokens the preset lacks, following border and button references", () => {
        const result = applyThemePreset(preset, current, new Map([["buttonVariants:cta", ["Home"]]]))
        expect(result.carried).toEqual(
            expect.arrayContaining([
                { kind: "buttonVariants", name: "cta" },
                { kind: "colors", name: "cream" },
                { kind: "colors", name: "garnet" },
                { kind: "radius", name: "pill" },
                { kind: "space", name: "huge" },
                { kind: "borders", name: "garnet-rule" }
            ])
        )
        // `sm` space is already in the preset, so it is not carried.
        expect(result.carried).not.toContainEqual({ kind: "space", name: "sm" })
        expect(lintTokenCatalog(result.catalog)).toEqual([])
        expect(isTokenCatalog(result.catalog)).toBe(true)
    })

    it("reports references nothing defines", () => {
        const result = applyThemePreset(preset, current, new Map([["shadows:glow", ["About"]]]))
        expect(result.missing).toEqual([{ kind: "shadows", name: "glow" }])
        expect(result.carried).toEqual([])
    })

    it("tolerates a null usage map (scan failed)", () => {
        expect(applyThemePreset(preset, current, null).catalog).toEqual(preset)
    })
})
