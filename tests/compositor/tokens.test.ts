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
    lintTokenCatalog,
    tokenSelectOptions,
    tokensToCss,
    tokenVar,
    tokenVarName,
    webFontsHref,
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

// --- Phase D: theme-authored button variants -------------------------------------------------------

/** A variant naming only tokens that exist in `catalog` above; used across the buttonVariants tests. */
const primary = { name: "primary", background: "accent", text: "page-bg", radius: "md", paddingX: "md", paddingY: "md" }
const secondary = { name: "secondary", background: "page-bg", text: "accent", radius: "md", paddingX: "md", paddingY: "md", border: "default" }
const withVariants: TokenCatalog = { ...catalog, buttonVariants: [primary, secondary] }

describe("isTokenCatalog — buttonVariants is optional (trap A)", () => {
    it("ACCEPTS a catalog that omits buttonVariants entirely", () => {
        // The single most important guard in Phase D: the live published theme predates the key, and a
        // rejection here would make fetchPublishedTheme return null and unstyle every design page silently.
        expect("buttonVariants" in catalog).toBe(false)
        expect(isTokenCatalog(catalog)).toBe(true)
    })
    it("accepts a catalog with valid buttonVariants (border optional)", () => {
        expect(isTokenCatalog(withVariants)).toBe(true)
    })
    it("rejects a present-but-malformed buttonVariants", () => {
        expect(isTokenCatalog({ ...catalog, buttonVariants: [{ name: "x" }] })).toBe(false)
        expect(isTokenCatalog({ ...catalog, buttonVariants: [{ ...primary, background: 1 }] })).toBe(false)
        expect(isTokenCatalog({ ...catalog, buttonVariants: "nope" })).toBe(false)
    })
})

describe("hasToken / tokenSelectOptions with buttonVariants absent (no throw)", () => {
    it("returns false / [] when the key is missing rather than throwing", () => {
        expect(hasToken(catalog, "buttonVariants", "primary")).toBe(false)
        expect(tokenSelectOptions(catalog, "buttonVariants")).toEqual([])
    })
    it("reads variants when present", () => {
        expect(hasToken(withVariants, "buttonVariants", "primary")).toBe(true)
        expect(tokenSelectOptions(withVariants, "buttonVariants")).toEqual([
            { label: "primary", value: "primary" },
            { label: "secondary", value: "secondary" }
        ])
    })
})

describe("tokensToCss — button variants", () => {
    it("emits one var() per sub-value, resolving each ref to the referenced token's property", () => {
        const css = tokensToCss(withVariants)
        expect(css).toContain("--dtk-btn-primary-bg: var(--dtk-color-accent);")
        expect(css).toContain("--dtk-btn-primary-text: var(--dtk-color-page-bg);")
        expect(css).toContain("--dtk-btn-primary-radius: var(--dtk-radius-md);")
        expect(css).toContain("--dtk-btn-primary-pad-x: var(--dtk-space-md);")
        expect(css).toContain("--dtk-btn-primary-pad-y: var(--dtk-space-md);")
    })
    it("emits border sub-props only for a variant that names a border", () => {
        const css = tokensToCss(withVariants)
        expect(css).not.toContain("--dtk-btn-primary-border-width")
        expect(css).toContain("--dtk-btn-secondary-border-width: var(--dtk-border-default-width);")
        expect(css).toContain("--dtk-btn-secondary-border-style: var(--dtk-border-default-style);")
        expect(css).toContain("--dtk-btn-secondary-border-color: var(--dtk-border-default-color);")
    })
    it("emits nothing for a catalog with no variants", () => {
        expect(tokensToCss(catalog)).not.toContain("--dtk-btn")
    })
})

describe("lintTokenCatalog", () => {
    it("returns no findings when every variant ref resolves", () => {
        expect(lintTokenCatalog(withVariants)).toEqual([])
    })
    it("flags a variant field whose ref names a token not in the catalog", () => {
        const bad: TokenCatalog = { ...catalog, buttonVariants: [{ ...primary, background: "ghost-color" }] }
        const findings = lintTokenCatalog(bad)
        expect(findings).toEqual([{ variant: "primary", field: "background", ref: "ghost-color", kind: "colors" }])
    })
})

// --- Web fonts -------------------------------------------------------------------------------------

describe("isTokenCatalog — fonts is optional (trap A)", () => {
    it("ACCEPTS a catalog that omits fonts entirely", () => {
        expect("fonts" in catalog).toBe(false)
        expect(isTokenCatalog(catalog)).toBe(true)
    })
    it("accepts a catalog with valid fonts (weights optional)", () => {
        expect(isTokenCatalog({ ...catalog, fonts: [{ family: "Inter", weights: [400, 700] }, { family: "Lora" }] })).toBe(true)
    })
    it("rejects a present-but-malformed fonts", () => {
        expect(isTokenCatalog({ ...catalog, fonts: [{ weights: [400] }] })).toBe(false)
        expect(isTokenCatalog({ ...catalog, fonts: [{ family: "Inter", weights: ["400"] }] })).toBe(false)
        expect(isTokenCatalog({ ...catalog, fonts: "nope" })).toBe(false)
    })
})

describe("isTokenCatalog — colorScheme is optional (trap A)", () => {
    it("ACCEPTS a catalog that omits colorScheme entirely", () => {
        expect("colorScheme" in catalog).toBe(false)
        expect(isTokenCatalog(catalog)).toBe(true)
    })
    it("accepts either literal", () => {
        expect(isTokenCatalog({ ...catalog, colorScheme: "adaptive" })).toBe(true)
        expect(isTokenCatalog({ ...catalog, colorScheme: "fixed" })).toBe(true)
    })
    it("rejects a present-but-unrecognized colorScheme", () => {
        expect(isTokenCatalog({ ...catalog, colorScheme: "auto" })).toBe(false)
        expect(isTokenCatalog({ ...catalog, colorScheme: true })).toBe(false)
    })
})

describe("webFontsHref", () => {
    it("builds a css2 URL with each family's weights, sorted, deduped, and display=swap", () => {
        const href = webFontsHref([
            { family: "Playfair Display", weights: [700, 400, 400] },
            { family: "Inter" }
        ])
        expect(href).toBe(
            "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Inter:wght@400&display=swap"
        )
    })
    it("returns null when there is no valid font", () => {
        expect(webFontsHref([])).toBeNull()
        // a family with URL-unsafe characters cannot be trusted into the href and is skipped
        expect(webFontsHref([{ family: "Evil</style>", weights: [400] }])).toBeNull()
    })
    it("drops non-integer and out-of-range weights, defaulting to 400", () => {
        expect(webFontsHref([{ family: "Inter", weights: [0, 1500, 350.5] }])).toBe(
            "https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap"
        )
    })
})
