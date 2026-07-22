/**
 * tests/compositor/tokens.test.ts
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
    columnsStackBreakpointCss,
    EMPTY_TOKEN_CATALOG,
    hasToken,
    isTokenCatalog,
    isValidTokenName,
    lintTokenCatalog,
    tokenSelectOptions,
    tokensToCss,
    tokenVar,
    tokenVarName,
    viewTransitionCss,
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

describe("tokensToCss — site chrome horizontal spacing", () => {
    const withSplitRoles: TokenCatalog = {
        ...catalog,
        space: [...catalog.space, { name: "xs", value: "0.5rem" }, { name: "sm", value: "1rem" }],
        siteChrome: {
            horizontalSpaceInset: "md",
            horizontalSpaceItemGap: "sm",
            horizontalSpaceControl: "xs"
        }
    }

    it("emits each split role as its own --dtk-chrome-horizontal-space-* var", () => {
        const css = tokensToCss(withSplitRoles)
        expect(css).toContain("--dtk-chrome-horizontal-space-inset: var(--dtk-space-md);")
        expect(css).toContain("--dtk-chrome-horizontal-space-item-gap: var(--dtk-space-sm);")
        expect(css).toContain("--dtk-chrome-horizontal-space-control: var(--dtk-space-xs);")
    })

    it("falls back the deprecated singular horizontalSpace to all three roles when the split is unset", () => {
        // A catalog saved before the split has only the old field; every consumer must keep resolving to
        // it so an already-configured theme doesn't silently revert to its built-in literal fallback.
        const legacyOnly: TokenCatalog = { ...catalog, siteChrome: { horizontalSpace: "md" } }
        const css = tokensToCss(legacyOnly)
        expect(css).toContain("--dtk-chrome-horizontal-space-inset: var(--dtk-space-md);")
        expect(css).toContain("--dtk-chrome-horizontal-space-item-gap: var(--dtk-space-md);")
        expect(css).toContain("--dtk-chrome-horizontal-space-control: var(--dtk-space-md);")
    })

    it("lets an explicit split role override the legacy fallback for just that role", () => {
        const mixed: TokenCatalog = {
            ...catalog,
            space: [...catalog.space, { name: "xs", value: "0.5rem" }],
            siteChrome: { horizontalSpace: "md", horizontalSpaceControl: "xs" }
        }
        const css = tokensToCss(mixed)
        expect(css).toContain("--dtk-chrome-horizontal-space-inset: var(--dtk-space-md);")
        expect(css).toContain("--dtk-chrome-horizontal-space-item-gap: var(--dtk-space-md);")
        expect(css).toContain("--dtk-chrome-horizontal-space-control: var(--dtk-space-xs);")
    })

    it("emits nothing when siteChrome is absent entirely", () => {
        expect(tokensToCss(catalog)).not.toContain("--dtk-chrome-horizontal-space")
    })

    it("emits the static nudge with no legacy fallback, independent of the other three", () => {
        const withStatic: TokenCatalog = {
            ...catalog,
            space: [...catalog.space, { name: "xs", value: "0.5rem" }],
            siteChrome: { horizontalSpace: "md", horizontalSpaceStatic: "xs" }
        }
        const css = tokensToCss(withStatic)
        expect(css).toContain("--dtk-chrome-horizontal-space-static: var(--dtk-space-xs);")
        // The legacy singular only seeds inset/item-gap/control — the static nudge has no prior dial to
        // fall back to, so it stays unset here rather than also picking up "md".
        expect(tokensToCss({ ...catalog, siteChrome: { horizontalSpace: "md" } })).not.toContain(
            "--dtk-chrome-horizontal-space-static"
        )
    })
})

describe("isTokenCatalog — site chrome horizontal spacing roles", () => {
    it("accepts the three split roles alongside the deprecated singular field", () => {
        expect(
            isTokenCatalog({
                ...catalog,
                siteChrome: {
                    horizontalSpace: "md",
                    horizontalSpaceInset: "md",
                    horizontalSpaceItemGap: "sm",
                    horizontalSpaceControl: "xs"
                }
            })
        ).toBe(true)
    })
    it("rejects a present-but-malformed split role", () => {
        expect(isTokenCatalog({ ...catalog, siteChrome: { horizontalSpaceInset: 1 } })).toBe(false)
    })
    it("accepts the static nudge role", () => {
        expect(isTokenCatalog({ ...catalog, siteChrome: { horizontalSpaceStatic: "xs" } })).toBe(true)
    })
    it("rejects a present-but-malformed static nudge role", () => {
        expect(isTokenCatalog({ ...catalog, siteChrome: { horizontalSpaceStatic: 1 } })).toBe(false)
    })
})

describe("tokensToCss — site chrome vertical spacing", () => {
    const withVerticalRoles: TokenCatalog = {
        ...catalog,
        space: [...catalog.space, { name: "xs", value: "0.5rem" }, { name: "sm", value: "1rem" }],
        siteChrome: {
            verticalSpaceSection: "md",
            verticalSpaceItemGap: "sm",
            verticalSpaceControl: "xs"
        }
    }

    it("emits each vertical role as its own --dtk-chrome-vertical-space-* var", () => {
        const css = tokensToCss(withVerticalRoles)
        expect(css).toContain("--dtk-chrome-vertical-space-section: var(--dtk-space-md);")
        expect(css).toContain("--dtk-chrome-vertical-space-item-gap: var(--dtk-space-sm);")
        expect(css).toContain("--dtk-chrome-vertical-space-control: var(--dtk-space-xs);")
    })

    it("emits an unset role's var not at all, independent of the other two", () => {
        const partial: TokenCatalog = { ...catalog, siteChrome: { verticalSpaceControl: "xs" } }
        const css = tokensToCss(partial)
        expect(css).not.toContain("--dtk-chrome-vertical-space-section")
        expect(css).not.toContain("--dtk-chrome-vertical-space-item-gap")
        expect(css).toContain("--dtk-chrome-vertical-space-control: var(--dtk-space-xs);")
    })

    it("emits nothing when siteChrome is absent entirely", () => {
        expect(tokensToCss(catalog)).not.toContain("--dtk-chrome-vertical-space")
    })

    it("emits the static nudge independent of the other roles", () => {
        const partial: TokenCatalog = { ...catalog, siteChrome: { verticalSpaceStatic: "xs" } }
        const css = tokensToCss(partial)
        expect(css).not.toContain("--dtk-chrome-vertical-space-section")
        expect(css).toContain("--dtk-chrome-vertical-space-static: var(--dtk-space-xs);")
    })
})

describe("isTokenCatalog — site chrome vertical spacing roles", () => {
    it("accepts the three vertical roles", () => {
        expect(
            isTokenCatalog({
                ...catalog,
                siteChrome: {
                    verticalSpaceSection: "md",
                    verticalSpaceItemGap: "sm",
                    verticalSpaceControl: "xs"
                }
            })
        ).toBe(true)
    })
    it("rejects a present-but-malformed vertical role", () => {
        expect(isTokenCatalog({ ...catalog, siteChrome: { verticalSpaceSection: 1 } })).toBe(false)
    })
    it("accepts the static nudge role", () => {
        expect(isTokenCatalog({ ...catalog, siteChrome: { verticalSpaceStatic: "xs" } })).toBe(true)
    })
    it("rejects a present-but-malformed static nudge role", () => {
        expect(isTokenCatalog({ ...catalog, siteChrome: { verticalSpaceStatic: 1 } })).toBe(false)
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

describe("isTokenCatalog — viewTransitions is optional (trap A)", () => {
    it("ACCEPTS a catalog that omits viewTransitions entirely", () => {
        expect("viewTransitions" in catalog).toBe(false)
        expect(isTokenCatalog(catalog)).toBe(true)
    })
    it("accepts either boolean", () => {
        expect(isTokenCatalog({ ...catalog, viewTransitions: true })).toBe(true)
        expect(isTokenCatalog({ ...catalog, viewTransitions: false })).toBe(true)
    })
    it("rejects a present-but-non-boolean viewTransitions", () => {
        expect(isTokenCatalog({ ...catalog, viewTransitions: "true" })).toBe(false)
    })
})

describe("webFontsHref", () => {
    it("builds a css2 URL with each family's weights, sorted and deduped", () => {
        const href = webFontsHref([
            { family: "Playfair Display", weights: [700, 400, 400] },
            { family: "Inter" }
        ])
        expect(href).toBe("https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Inter:wght@400")
    })
    it("returns null when there is no valid font", () => {
        expect(webFontsHref([])).toBeNull()
        // a family with URL-unsafe characters cannot be trusted into the href and is skipped
        expect(webFontsHref([{ family: "Evil</style>", weights: [400] }])).toBeNull()
    })
    it("drops non-integer and out-of-range weights, defaulting to 400", () => {
        expect(webFontsHref([{ family: "Inter", weights: [0, 1500, 350.5] }])).toBe(
            "https://fonts.googleapis.com/css2?family=Inter:wght@400"
        )
    })
})

describe("columnsStackBreakpointCss", () => {
    it("falls back to the historical fixed 767.98px when no theme is published (empty catalog)", () => {
        expect(columnsStackBreakpointCss(EMPTY_TOKEN_CATALOG)).toBe(
            "@media (max-width: 767.98px) {\n    .cmp-columns {\n        grid-template-columns: 1fr;\n    }\n}"
        )
    })

    it("falls back to the same fixed cutoff when layoutStackBreakpoint is unset", () => {
        expect(columnsStackBreakpointCss(catalog)).toContain("max-width: 767.98px")
    })

    it("falls back when layoutStackBreakpoint names a token that doesn't exist", () => {
        expect(columnsStackBreakpointCss({ ...catalog, layoutStackBreakpoint: "nope" })).toContain("max-width: 767.98px")
    })

    it("uses the designated breakpoint's minWidth, just below it, when set", () => {
        const withLg: TokenCatalog = {
            ...catalog,
            breakpoints: [...catalog.breakpoints, { name: "lg", minWidth: "1024px" }],
            layoutStackBreakpoint: "lg"
        }
        expect(columnsStackBreakpointCss(withLg)).toBe(
            "@media (max-width: 1023.98px) {\n    .cmp-columns {\n        grid-template-columns: 1fr;\n    }\n}"
        )
    })

    it("uses a non-px minWidth as-is, without arithmetic", () => {
        const withRem: TokenCatalog = {
            ...catalog,
            breakpoints: [...catalog.breakpoints, { name: "tablet", minWidth: "48rem" }],
            layoutStackBreakpoint: "tablet"
        }
        expect(columnsStackBreakpointCss(withRem)).toContain("max-width: 48rem")
    })
})

describe("viewTransitionCss", () => {
    const ENABLED_CSS =
        "@view-transition {\n" +
        "    navigation: auto;\n" +
        "}\n" +
        "::view-transition-group(root) {\n" +
        "    background-color: var(--dtk-chrome-page-bg, var(--dtk-color-paper, var(--color-bg)));\n" +
        "}\n" +
        "::view-transition-old(root),\n" +
        "::view-transition-new(root) {\n" +
        "    mix-blend-mode: normal;\n" +
        "}"

    it("is enabled by default when no theme is published (empty catalog)", () => {
        expect(viewTransitionCss(EMPTY_TOKEN_CATALOG)).toBe(ENABLED_CSS)
    })
    it("is enabled when viewTransitions is unset on a real catalog", () => {
        expect("viewTransitions" in catalog).toBe(false)
        expect(viewTransitionCss(catalog)).toBe(ENABLED_CSS)
    })
    it("is enabled when viewTransitions is explicitly true", () => {
        expect(viewTransitionCss({ ...catalog, viewTransitions: true })).toBe(ENABLED_CSS)
    })
    it("emits nothing when viewTransitions is explicitly false", () => {
        expect(viewTransitionCss({ ...catalog, viewTransitions: false })).toBe("")
    })
})
