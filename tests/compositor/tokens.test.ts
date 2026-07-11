/**
 * tests/compositor/tokens.test.ts
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

import { describe, it, expect } from "vitest"

import {
    hasToken,
    isTokenCatalog,
    isValidTokenName,
    tokenSelectOptions,
    tokensToCss,
    tokenVar,
    tokenVarName,
    type TokenCatalog
} from "../../src/lib/compositor/tokens"

const catalog: TokenCatalog = {
    schemaVersion: 1,
    colors: [
        { name: "page-bg", value: "light-dark(#ffffff, #1a1a1a)" },
        { name: "accent", value: "#2337ff" }
    ],
    typography: [
        { name: "body", family: "system-ui, sans-serif", size: "1rem", weight: "400", lineHeight: "1.5" },
        {
            name: "display",
            family: "system-ui, sans-serif",
            size: "2.5rem",
            weight: "700",
            lineHeight: "1.2",
            letterSpacing: "-0.02em"
        }
    ],
    space: [{ name: "md", value: "2rem" }],
    radius: [{ name: "md", value: "0.5rem" }],
    shadows: [{ name: "md", value: "0 1px 3px rgba(0,0,0,0.12)" }],
    borders: [{ name: "default", width: "1px", style: "solid", colorRef: "accent" }],
    breakpoints: [{ name: "md", minWidth: "768px" }]
}

describe("token name validation", () => {
    it("accepts kebab-case slugs", () => {
        expect(isValidTokenName("page-bg")).toBe(true)
        expect(isValidTokenName("accent")).toBe(true)
        expect(isValidTokenName("band-primary-2")).toBe(true)
    })
    it("rejects non-kebab-case names", () => {
        expect(isValidTokenName("Page-Bg")).toBe(false)
        expect(isValidTokenName("page_bg")).toBe(false)
        expect(isValidTokenName("-lead")).toBe(false)
        expect(isValidTokenName("trail-")).toBe(false)
        expect(isValidTokenName("space md")).toBe(false)
        expect(isValidTokenName("")).toBe(false)
    })
})

describe("tokenVar / tokenVarName", () => {
    it("builds the --dtk custom-property name and var() reference", () => {
        expect(tokenVarName("colors", "accent")).toBe("--dtk-color-accent")
        expect(tokenVarName("space", "md")).toBe("--dtk-space-md")
        expect(tokenVarName("typography", "body", "size")).toBe("--dtk-type-body-size")
        expect(tokenVar("colors", "accent")).toBe("var(--dtk-color-accent)")
        expect(tokenVar("typography", "body", "line-height")).toBe("var(--dtk-type-body-line-height)")
    })
    it("returns a var() reference for a missing token (fail-soft, no throw)", () => {
        expect(tokenVar("colors", "does-not-exist")).toBe("var(--dtk-color-does-not-exist)")
    })
})

describe("tokensToCss emission", () => {
    const css = tokensToCss(catalog)

    it("emits one property per simple value token", () => {
        expect(css).toContain("--dtk-color-page-bg: light-dark(#ffffff, #1a1a1a);")
        expect(css).toContain("--dtk-color-accent: #2337ff;")
        expect(css).toContain("--dtk-space-md: 2rem;")
        expect(css).toContain("--dtk-radius-md: 0.5rem;")
        expect(css).toContain("--dtk-shadow-md: 0 1px 3px rgba(0,0,0,0.12);")
    })
    it("emits one property per typography sub-value, letterSpacing only when present", () => {
        expect(css).toContain("--dtk-type-body-family: system-ui, sans-serif;")
        expect(css).toContain("--dtk-type-body-size: 1rem;")
        expect(css).toContain("--dtk-type-body-weight: 400;")
        expect(css).toContain("--dtk-type-body-line-height: 1.5;")
        expect(css).not.toContain("--dtk-type-body-letter-spacing")
        expect(css).toContain("--dtk-type-display-letter-spacing: -0.02em;")
    })
    it("resolves a border's colorRef to the referenced color property", () => {
        expect(css).toContain("--dtk-border-default-width: 1px;")
        expect(css).toContain("--dtk-border-default-style: solid;")
        expect(css).toContain("--dtk-border-default-color: var(--dtk-color-accent);")
    })
    it("does not emit breakpoints (unusable as custom properties in @media)", () => {
        expect(css).not.toContain("--dtk-breakpoint")
    })
    it("wraps declarations in a :root block", () => {
        expect(css.startsWith(":root {")).toBe(true)
        expect(css.trimEnd().endsWith("}")).toBe(true)
    })
    it("skips tokens whose name is not a valid slug", () => {
        const bad = tokensToCss({
            ...catalog,
            colors: [{ name: "Bad Name", value: "red" }, { name: "ok", value: "blue" }]
        })
        expect(bad).not.toContain("Bad Name")
        expect(bad).toContain("--dtk-color-ok: blue;")
    })
})

describe("tokenSelectOptions", () => {
    it("returns name-keyed options in catalog order", () => {
        expect(tokenSelectOptions(catalog, "colors")).toEqual([
            { label: "page-bg", value: "page-bg" },
            { label: "accent", value: "accent" }
        ])
        expect(tokenSelectOptions(catalog, "typography")).toEqual([
            { label: "body", value: "body" },
            { label: "display", value: "display" }
        ])
    })
})

describe("hasToken", () => {
    it("reports presence by kind and name", () => {
        expect(hasToken(catalog, "colors", "accent")).toBe(true)
        expect(hasToken(catalog, "colors", "missing")).toBe(false)
        expect(hasToken(catalog, "space", "md")).toBe(true)
    })
})

describe("isTokenCatalog", () => {
    it("accepts a well-formed catalog", () => {
        expect(isTokenCatalog(catalog)).toBe(true)
    })
    it("rejects non-objects and missing/typed-wrong fields", () => {
        expect(isTokenCatalog(null)).toBe(false)
        expect(isTokenCatalog([])).toBe(false)
        expect(isTokenCatalog({ ...catalog, schemaVersion: "1" })).toBe(false)
        expect(isTokenCatalog({ ...catalog, colors: [{ name: "x" }] })).toBe(false)
        expect(isTokenCatalog({ ...catalog, typography: [{ name: "x", family: "f", size: "1rem", weight: "400" }] })).toBe(false)
        expect(isTokenCatalog({ ...catalog, borders: [{ name: "b", width: "1px", style: "solid" }] })).toBe(false)
        const { breakpoints: _omit, ...withoutBreakpoints } = catalog
        expect(isTokenCatalog(withoutBreakpoints)).toBe(false)
    })
})
