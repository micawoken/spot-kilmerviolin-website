/**
 * lib/compositor/tokens.ts
 *
 * The design token catalog (impl §4.3): the closed set of theme values a design page may use.
 * Owns the `TokenCatalog` type, hand-rolled structural guards (project validation style,
 * `src/lib/api/validation.ts`), CSS custom-property emission (`tokensToCss`), the `var(--dtk-…)`
 * reference builder (`tokenVar`), and the Puck select-option builder (`tokenSelectOptions`).
 *
 * Every visual control in the catalog stores a token *name* and resolves it to `var(--dtk-…)` at
 * render — raw CSS values never appear in component fields (plan decision 4). A stored name absent
 * from the current theme resolves to an unset custom property (emitted only for tokens that exist),
 * so rendering never throws on drift; lint (§6.7) surfaces the dangling reference instead.
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

import { isRecord } from "./types"

/** A named CSS value token (colors, space, radius, shadows). `value` is any CSS value string. */
export interface ValueToken {
    name: string
    value: string
}

/**
 * CSS `text-transform` keywords a typography token may default to. Mirrors `weight`'s convention of
 * a plain keyword string, kept as a literal union here (rather than free text) since the CSS property
 * itself only accepts this closed set.
 */
export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize"

/** A typography token: emitted as one custom property per sub-value (impl §4.3). */
export interface TypographyToken {
    name: string
    family: string
    size: string
    weight: string
    lineHeight: string
    letterSpacing?: string
    /** Default `font-style: italic` when true. OPTIONAL, trap A: absent means not italic. */
    italic?: boolean
    /**
     * Shortcut that forces the emitted weight to `"bold"` when true, overriding `weight` for that one
     * property (the `weight` field's own value is preserved, unaffected, so unchecking restores it).
     * OPTIONAL, trap A: absent behaves exactly as before this field existed.
     */
    bold?: boolean
    /**
     * Default `text-decoration-line` components. CSS allows combining these (e.g. underline +
     * line-through) so each is an independent flag rather than a single select. OPTIONAL, trap A:
     * absent means no decoration, matching pre-existing behavior.
     */
    underline?: boolean
    lineThrough?: boolean
    overline?: boolean
    /** Default `text-transform`. OPTIONAL, trap A: absent means no transform. */
    textTransform?: TextTransform
}

/** A border token. `colorRef` names a color token, resolved to `var(--dtk-color-<colorRef>)` on emit. */
export interface BorderToken {
    name: string
    width: string
    style: string
    colorRef: string
}

/** A responsive breakpoint. Not emitted as a custom property (custom props can't be used in `@media`). */
export interface BreakpointToken {
    name: string
    minWidth: string
}

/**
 * A named button style: a bundle of references to other tokens (mirrors `BorderToken.colorRef`).
 * Emitted as one `--dtk-btn-<name>-…` custom property per sub-value, each resolving to the referenced
 * token's own property, so renaming a referenced token flows through here fail-soft (an unset var).
 */
export interface ButtonVariantToken {
    name: string
    /** names a `colors` token */
    background: string
    /** names a `colors` token */
    text: string
    /** names a `borders` token; omit for no border */
    border?: string
    /** names a `radius` token */
    radius: string
    /** names a `space` token */
    paddingX: string
    /** names a `space` token */
    paddingY: string
}

/**
 * The theme's token catalog — the value of the single `design_theme` item's `tokens` field
 * (impl §4.3). A closed set of token types (plan decision 7); `modes` is a documented schema
 * door for dark mode, intentionally not built in Phase 1.
 */
/**
 * A web font the site loads from Google Fonts. NOT a token — it is not emitted as a `--dtk-*` property;
 * it declares a family to fetch so a `typography` token's `family` can name it. The css2 stylesheet URL
 * is built and validated by `webFontsHref`; only positive-integer weights and a letters/digits/spaces
 * family survive into the URL, so a hand-edited theme cannot inject arbitrary markup.
 */
export interface WebFont {
    /** the family name exactly as Google Fonts lists it, e.g. "Inter" or "Playfair Display" */
    family: string
    /** the weights to load; defaults to [400] when empty. Non-integer or out-of-range weights are dropped. */
    weights?: number[]
}

/**
 * The public site frame's fixed semantic color/border/spacing roles (page background, body text,
 * links, horizontal spacing, …), each naming a token the owner has authored elsewhere in the catalog.
 * The roles themselves are a closed, non-removable set — every role always exists as a concept in the
 * editor — but which named token fills each one is the owner's choice, resolved the same way
 * `Section.background` or `Divider.color` already resolve a stored name to `var(--dtk-…)`.
 *
 * Replaces the earlier convention of `public-chrome.css`/`search.astro` hardcoding specific color
 * names (`ink`, `paper`, `garnet`, `slate`, `surface`), a `hairline` border name, and (until
 * `horizontalSpace` existed) a hand-picked `--dtk-space-*` name per declaration: those names were
 * undiscoverable from the editor UI and silently fell back to generic defaults whenever a theme didn't
 * happen to define them. Every role here is OPTIONAL (trap A): unset roles fall back to the old
 * magic-name lookup in the consuming CSS, so an unmigrated theme renders unchanged until its owner
 * opens the editor and sets these explicitly.
 */
export interface SiteChromeRoles {
    /** names a `colors` token; the page/site frame background */
    pageBackground?: string
    /** names a `colors` token; the page/site frame's default text color */
    bodyText?: string
    /** names a `colors` token; in-content link color */
    linkColor?: string
    /** names a `colors` token; in-content link color on hover */
    linkHoverColor?: string
    /** names a `colors` token; muted nav/footer text */
    mutedText?: string
    /** names a `colors` token; footer background */
    footerBackground?: string
    /** names a `borders` token; header/footer hairline rule */
    hairlineBorder?: string
    /**
     * names a `space` token; DEPRECATED, superseded by the three split roles below. Kept only so a
     * catalog written before the split still has a value to migrate from: `toEditable` (ThemeEditor.tsx)
     * seeds `horizontalSpaceInset`/`horizontalSpaceItemGap`/`horizontalSpaceControl` from this field
     * one time when they're unset, and `tokensToCss` falls back to it per-role the same way, so an
     * already-configured theme doesn't silently revert to the built-in literal fallbacks the moment the
     * split ships. Never written by a save going forward — the editor no longer exposes it.
     */
    horizontalSpace?: string
    /**
     * names a `space` token; how far static site-chrome content sits from the viewport edge — header
     * nav, `main > article`, unwrapped `main` content, the footer, and NavTiles' outer padding-inline.
     */
    horizontalSpaceInset?: string
    /**
     * names a `space` token; the horizontal gap between repeated items in a row — nav links, footer
     * links, header nav's title/toggle grid columns, and the NavTiles/entity-list grids.
     */
    horizontalSpaceItemGap?: string
    /**
     * names a `space` token; horizontal padding inside, and the gap between, interactive controls — the
     * header and search-page search boxes, and entity list-result cards.
     */
    horizontalSpaceControl?: string
}

export interface TokenCatalog {
    /** Catalog schema version, independent of the design-doc `schemaVersion`. */
    schemaVersion: number
    /**
     * How colors are authored. `"adaptive"` (the default when absent) means color values carry a
     * `light-dark(L, D)` pair that follows the viewer's color scheme; `"fixed"` means a single value.
     * Authoring metadata only — the theme editor uses it to choose one color picker or two; `tokensToCss`
     * never reads it (it emits each color's `value` verbatim, whatever shape the editor composed). OPTIONAL
     * and defaulted on read, same trap-A contract as `buttonVariants`/`fonts`: a theme predating this field
     * must still validate or the whole catalog is rejected and every design page renders unstyled.
     */
    colorScheme?: "adaptive" | "fixed"
    colors: ValueToken[]
    typography: TypographyToken[]
    space: ValueToken[]
    radius: ValueToken[]
    shadows: ValueToken[]
    borders: BorderToken[]
    breakpoints: BreakpointToken[]
    /**
     * Theme-authored button styles. OPTIONAL and normalized to `[]` on read: a live theme predating this
     * field must still validate, or `fetchPublishedTheme` would reject the whole catalog and unstyle every
     * design page (see `isTokenCatalog`). New keys added to this interface must follow the same pattern.
     */
    buttonVariants?: ButtonVariantToken[]
    /**
     * Site-wide web fonts to load (Google Fonts). OPTIONAL and normalized to `[]` on read — same trap-A
     * contract as `buttonVariants`. Consumed by `webFontsHref`, not `tokensToCss`.
     */
    fonts?: WebFont[]
    /**
     * The public site frame's semantic color/border role mapping (§ SiteChromeRoles). OPTIONAL, trap A:
     * a theme predating this field must still validate; every role within it is independently optional
     * too, so partial adoption (e.g. only `pageBackground` set) is valid.
     */
    siteChrome?: SiteChromeRoles
    /**
     * Names a `breakpoints` token whose `minWidth` drives the one real breakpoint-consuming rule on the
     * site today (`Columns` stacking to a single column below this width). Site-wide, not per-component-
     * instance: custom properties can't appear in `@media` conditions, so this value is read at CSS-
     * generation time (`theme-head.ts`) and interpolated as a literal pixel value into a real `@media`
     * rule, replacing the previously hardcoded 768px in the static stylesheet. OPTIONAL, trap A: unset
     * (or naming a token that doesn't exist) preserves the original hardcoded 768px behavior.
     */
    layoutStackBreakpoint?: string
    /**
     * Whether cross-document view transitions (`@view-transition { navigation: auto; }`) are enabled on
     * the public site. Site-wide, like `layoutStackBreakpoint`: a real `@view-transition` at-rule, not a
     * `--dtk-*` custom property, so it is read at CSS-generation time (`theme-head.ts`) rather than
     * emitted by `tokensToCss`. OPTIONAL, trap A: absent means enabled, matching the site's original
     * always-on `styles/global.css` behavior before this control existed. Only `false` (explicitly
     * disabled) changes anything.
     */
    viewTransitions?: boolean
}

/**
 * A catalog with no tokens in any kind. Used by the build when no theme is published (§6.6): the design
 * still renders structurally, every token select is empty, and no `--dtk-*` property is declared, so
 * token-backed declarations fall back to their initial values rather than breaking the page.
 */
export const EMPTY_TOKEN_CATALOG: TokenCatalog = Object.freeze({
    schemaVersion: 1,
    colorScheme: "adaptive",
    colors: [],
    typography: [],
    space: [],
    radius: [],
    shadows: [],
    borders: [],
    breakpoints: [],
    buttonVariants: [],
    fonts: []
})

/** The catalog keys a component field can select from. Drives `tokenVar` / `tokenSelectOptions`. */
export type TokenKind =
    | "colors"
    | "typography"
    | "space"
    | "radius"
    | "shadows"
    | "borders"
    | "breakpoints"
    | "buttonVariants"

/**
 * Registry mapping a component `type` to each of its token-select props and the token kind that prop
 * draws from (e.g. `Section.background → "colors"`). Supplied by the catalog (§6.3) so lint (§6.7)
 * can flag a stored token name absent from the current theme without importing the catalog's
 * React/Puck code. A component type absent from the registry has no token props.
 */
export type TokenPropRegistry = Record<string, Record<string, TokenKind>>

/**
 * Kind → the `--dtk-<segment>-…` name segment. Deliberately terse and stable: these strings are
 * baked into stored/emitted CSS, so renaming a segment is a breaking change to every design page.
 */
const KIND_SEGMENT: Record<TokenKind, string> = {
    colors: "color",
    typography: "type",
    space: "space",
    radius: "radius",
    shadows: "shadow",
    borders: "border",
    breakpoints: "breakpoint",
    buttonVariants: "btn"
}

/**
 * Token names are kebab-case slugs: lowercase alphanumerics separated by single hyphens. Enforced
 * so a name maps 1:1 to a valid CSS custom-property segment and a hand-edited theme cannot inject
 * arbitrary text into an emitted property name.
 */
export const TOKEN_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Whether a string is a valid kebab-case token name (see TOKEN_NAME_PATTERN).
 *
 * @param {string} name - the candidate token name
 * @returns {boolean} - true if the name is a valid kebab-case slug
 */
export function isValidTokenName(name: string): boolean {
    return TOKEN_NAME_PATTERN.test(name)
}

/**
 * The CSS custom-property name for a token, e.g. `--dtk-color-accent`, `--dtk-space-md`,
 * `--dtk-type-body-size`. `sub` names a typography/border sub-value.
 *
 * @param {TokenKind} kind - the catalog kind
 * @param {string} name - the token name
 * @param {string} [sub] - an optional sub-value segment (e.g. "size", "width")
 * @returns {string} - the `--dtk-…` custom-property name
 */
export function tokenVarName(kind: TokenKind, name: string, sub?: string): string {
    const base = `--dtk-${KIND_SEGMENT[kind]}-${name}`
    return sub ? `${base}-${sub}` : base
}

/**
 * A `var(--dtk-…)` reference to a token, for use in a component's rendered CSS. Returns the
 * reference regardless of whether the token currently exists — a missing token resolves to an
 * unset custom property (rendering does not throw); lint reports the dangling reference.
 *
 * @param {TokenKind} kind - the catalog kind
 * @param {string} name - the token name
 * @param {string} [sub] - an optional sub-value segment
 * @returns {string} - a `var(--dtk-…)` string
 */
export function tokenVar(kind: TokenKind, name: string, sub?: string): string {
    return `var(${tokenVarName(kind, name, sub)})`
}

/**
 * Whether a token of the given kind and name exists in the catalog. Used by lint (§6.7) and the
 * unknown-token tests; rendering itself never needs it (missing tokens fail soft to unset vars).
 *
 * @param {TokenCatalog} catalog - the theme catalog
 * @param {TokenKind} kind - the catalog kind
 * @param {string} name - the token name
 * @returns {boolean} - true if a token with that name exists under that kind
 */
export function hasToken(catalog: TokenCatalog, kind: TokenKind, name: string): boolean {
    return (catalog[kind] ?? []).some((token) => token.name === name)
}

/**
 * Puck select options for a token kind: `{ label, value }` with both set to the token name
 * (editors pick by name). Order follows the catalog.
 *
 * @param {TokenCatalog} catalog - the theme catalog
 * @param {TokenKind} kind - the catalog kind
 * @returns {{ label: string; value: string }[]} - select options for the kind's tokens
 */
export function tokenSelectOptions(catalog: TokenCatalog, kind: TokenKind): { label: string; value: string }[] {
    return (catalog[kind] ?? []).map((token) => ({ label: token.name, value: token.name }))
}

/**
 * Emits the theme as CSS custom properties inside a `:root { … }` block — one property per simple
 * value token, one per typography/border sub-value. Injected as a `<style>` into the build head of
 * design pages and into the Puck canvas iframe in the editor (impl §4.3, spike (c)).
 *
 * Tokens whose name is not a valid kebab-case slug are skipped (defensive: a malformed name must
 * not become a malformed property). Breakpoints are not emitted — custom properties cannot be used
 * in `@media` conditions, so the catalog (§6.3) references breakpoint values directly.
 *
 * @param {TokenCatalog} catalog - the theme catalog
 * @returns {string} - a `:root { … }` CSS block declaring the `--dtk-*` properties
 */
/**
 * The `text-decoration-line` value for a typography token's underline/lineThrough/overline flags.
 * CSS allows combining these on one element (e.g. `underline overline`), so each flag contributes
 * independently rather than the field being a single exclusive choice.
 *
 * @param {TypographyToken} token - the typography token
 * @returns {string} - `"none"`, or a space-separated list of the active decoration lines
 */
function textDecorationLine(token: TypographyToken): string {
    const lines: string[] = []
    if (token.underline) lines.push("underline")
    if (token.overline) lines.push("overline")
    if (token.lineThrough) lines.push("line-through")
    return lines.length > 0 ? lines.join(" ") : "none"
}

export function tokensToCss(catalog: TokenCatalog): string {
    const lines: string[] = []

    for (const token of catalog.colors) {
        if (isValidTokenName(token.name)) lines.push(`${tokenVarName("colors", token.name)}: ${token.value};`)
    }
    for (const token of catalog.typography) {
        if (!isValidTokenName(token.name)) continue
        lines.push(`${tokenVarName("typography", token.name, "family")}: ${token.family};`)
        lines.push(`${tokenVarName("typography", token.name, "size")}: ${token.size};`)
        // `bold` is a shortcut that overrides the emitted weight for this property only; the token's
        // own `weight` value is untouched, so unchecking `bold` restores it.
        lines.push(`${tokenVarName("typography", token.name, "weight")}: ${token.bold ? "bold" : token.weight};`)
        lines.push(`${tokenVarName("typography", token.name, "line-height")}: ${token.lineHeight};`)
        if (token.letterSpacing !== undefined) {
            lines.push(`${tokenVarName("typography", token.name, "letter-spacing")}: ${token.letterSpacing};`)
        }
        lines.push(`${tokenVarName("typography", token.name, "style")}: ${token.italic ? "italic" : "normal"};`)
        lines.push(`${tokenVarName("typography", token.name, "decoration")}: ${textDecorationLine(token)};`)
        lines.push(`${tokenVarName("typography", token.name, "transform")}: ${token.textTransform ?? "none"};`)
    }
    for (const token of catalog.space) {
        if (isValidTokenName(token.name)) lines.push(`${tokenVarName("space", token.name)}: ${token.value};`)
    }
    for (const token of catalog.radius) {
        if (isValidTokenName(token.name)) lines.push(`${tokenVarName("radius", token.name)}: ${token.value};`)
    }
    for (const token of catalog.shadows) {
        if (isValidTokenName(token.name)) lines.push(`${tokenVarName("shadows", token.name)}: ${token.value};`)
    }
    for (const token of catalog.borders) {
        if (!isValidTokenName(token.name)) continue
        lines.push(`${tokenVarName("borders", token.name, "width")}: ${token.width};`)
        lines.push(`${tokenVarName("borders", token.name, "style")}: ${token.style};`)
        // colorRef resolves to the color token's own property; a dangling ref yields an unset var.
        lines.push(`${tokenVarName("borders", token.name, "color")}: ${tokenVar("colors", token.colorRef)};`)
    }
    // Each variant field references another token, emitted as a var() to that token's own property
    // (like borders' colorRef). A dangling ref yields an unset var, not a crash; the border sub-values
    // are emitted only when `border` names a token, so a border-less variant inherits the CSS fallback.
    for (const variant of catalog.buttonVariants ?? []) {
        if (!isValidTokenName(variant.name)) continue
        lines.push(`${tokenVarName("buttonVariants", variant.name, "bg")}: ${tokenVar("colors", variant.background)};`)
        lines.push(`${tokenVarName("buttonVariants", variant.name, "text")}: ${tokenVar("colors", variant.text)};`)
        lines.push(`${tokenVarName("buttonVariants", variant.name, "radius")}: ${tokenVar("radius", variant.radius)};`)
        lines.push(`${tokenVarName("buttonVariants", variant.name, "pad-x")}: ${tokenVar("space", variant.paddingX)};`)
        lines.push(`${tokenVarName("buttonVariants", variant.name, "pad-y")}: ${tokenVar("space", variant.paddingY)};`)
        if (variant.border !== undefined && variant.border !== "") {
            lines.push(
                `${tokenVarName("buttonVariants", variant.name, "border-width")}: ${tokenVar("borders", variant.border, "width")};`
            )
            lines.push(
                `${tokenVarName("buttonVariants", variant.name, "border-style")}: ${tokenVar("borders", variant.border, "style")};`
            )
            lines.push(
                `${tokenVarName("buttonVariants", variant.name, "border-color")}: ${tokenVar("borders", variant.border, "color")};`
            )
        }
    }
    // Site Chrome roles: emitted only when the owner has set them, as `--dtk-chrome-<role>` pointing at
    // the chosen token's own property (like buttonVariants' refs). An unset role emits nothing, so the
    // consuming CSS's own `var(--dtk-chrome-…, <old magic-name lookup>)` fallback chain takes over —
    // this is what makes an unmigrated theme render unchanged until its owner sets these explicitly.
    const chrome = catalog.siteChrome
    if (chrome) {
        const colorRoles: Array<[string, string | undefined]> = [
            ["page-bg", chrome.pageBackground],
            ["body-text", chrome.bodyText],
            ["link", chrome.linkColor],
            ["link-hover", chrome.linkHoverColor],
            ["muted", chrome.mutedText],
            ["footer-bg", chrome.footerBackground]
        ]
        for (const [segment, name] of colorRoles) {
            if (name) lines.push(`--dtk-chrome-${segment}: ${tokenVar("colors", name)};`)
        }
        if (chrome.hairlineBorder) {
            const name = chrome.hairlineBorder
            lines.push(`--dtk-chrome-hairline-width: ${tokenVar("borders", name, "width")};`)
            lines.push(`--dtk-chrome-hairline-style: ${tokenVar("borders", name, "style")};`)
            lines.push(`--dtk-chrome-hairline-color: ${tokenVar("borders", name, "color")};`)
        }
        // Each split role falls back to the deprecated singular `horizontalSpace` when unset, so a
        // catalog saved before the split (§ SiteChromeRoles.horizontalSpace) keeps rendering identically
        // until its owner opens the editor and adjusts the roles independently.
        const horizontalSpaceRoles: Array<[string, string | undefined]> = [
            ["horizontal-space-inset", chrome.horizontalSpaceInset ?? chrome.horizontalSpace],
            ["horizontal-space-item-gap", chrome.horizontalSpaceItemGap ?? chrome.horizontalSpace],
            ["horizontal-space-control", chrome.horizontalSpaceControl ?? chrome.horizontalSpace]
        ]
        for (const [segment, name] of horizontalSpaceRoles) {
            if (name) lines.push(`--dtk-chrome-${segment}: ${tokenVar("space", name)};`)
        }
    }

    return `:root {\n${lines.map((line) => `    ${line}`).join("\n")}\n}`
}

/** The historical fixed cutoff (`compositor.css`'s old hardcoded rule) used when no theme designates a
 *  `layoutStackBreakpoint`, so an unmigrated/untouched theme keeps this exact prior behavior. */
const DEFAULT_COLUMNS_STACK_MAX_WIDTH = "767.98px"

/**
 * Just below a breakpoint token's own `minWidth`, matching the historical 767.98-for-768 idiom (a
 * `minWidth` of `N`px stacks below it, not at-or-above it). A `minWidth` this can't confidently do
 * arithmetic on (a non-`px` unit, `calc()`, …) is used as-is rather than risk an invalid media condition.
 */
function stackCutoff(minWidth: string): string {
    const match = /^(-?\d+(?:\.\d+)?)px$/.exec(minWidth.trim())
    if (!match) return minWidth.trim()
    return `${Number(match[1]) - 0.02}px`
}

/**
 * The `@media (max-width: …) { .cmp-columns { grid-template-columns: 1fr; } }` rule that drives `Columns`'
 * single-column stacking. Generated here rather than hardcoded in the static stylesheet (`compositor.css`)
 * because it is theme-authored: `layoutStackBreakpoint` names a `breakpoints` token, and custom properties
 * cannot appear in `@media` conditions, so the chosen breakpoint's literal pixel value must be baked
 * directly into this CSS text. Falls back to the historical fixed cutoff when the catalog doesn't
 * designate a breakpoint (unset, or naming a token that no longer exists) — preserving the exact
 * pre-existing behavior for a theme that predates this field, and for no theme at all.
 *
 * @param {TokenCatalog} catalog - the theme catalog
 * @returns {string} - the `@media { … }` rule
 */
export function columnsStackBreakpointCss(catalog: TokenCatalog): string {
    const target = catalog.layoutStackBreakpoint
    const token = target ? catalog.breakpoints.find((candidate) => candidate.name === target) : undefined
    const maxWidth = token ? stackCutoff(token.minWidth) : DEFAULT_COLUMNS_STACK_MAX_WIDTH
    return `@media (max-width: ${maxWidth}) {\n    .cmp-columns {\n        grid-template-columns: 1fr;\n    }\n}`
}

/**
 * The `@view-transition { navigation: auto; }` at-rule that crossfades between page navigations, or `""`
 * when the theme has explicitly disabled it. Generated here rather than hardcoded in the static
 * stylesheet (`styles/global.css`) because it is theme-authored, like `columnsStackBreakpointCss`.
 * Falls back to enabled (the historical always-on behavior) when the catalog doesn't set
 * `viewTransitions` at all — only an explicit `false` turns it off.
 *
 * Also overrides the UA default crossfade styling: the default's mix-blend-mode: plus-lighter additively
 * blends the old/new snapshots to avoid a black flash, which instead washes toward white on a light theme.
 * Giving the transition group a real backdrop (matching public-chrome.css's page-background fallback
 * chain) removes the need for that trick, so a plain mix-blend-mode: normal crossfade doesn't wash toward
 * white or dip toward black in either theme.
 *
 * @param {TokenCatalog} catalog - the theme catalog
 * @returns {string} - the `@view-transition { … }` rule (plus crossfade overrides), or `""` when disabled
 */
export function viewTransitionCss(catalog: TokenCatalog): string {
    if (catalog.viewTransitions === false) return ""
    return (
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
    )
}

/** Whether every element of an array passes a per-element guard. */
function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
    return Array.isArray(value) && value.every(guard)
}

function isValueToken(value: unknown): value is ValueToken {
    return isRecord(value) && typeof value.name === "string" && typeof value.value === "string"
}

/** The `text-transform` keywords offered by the theme editor's dropdown (see `TextTransform`). */
export const TEXT_TRANSFORMS: readonly TextTransform[] = ["none", "uppercase", "lowercase", "capitalize"]

function isTypographyToken(value: unknown): value is TypographyToken {
    return (
        isRecord(value) &&
        typeof value.name === "string" &&
        typeof value.family === "string" &&
        typeof value.size === "string" &&
        typeof value.weight === "string" &&
        typeof value.lineHeight === "string" &&
        (value.letterSpacing === undefined || typeof value.letterSpacing === "string") &&
        // OPTIONAL, trap A: absent on every field below means "not styled that way", matching behavior
        // before these fields existed.
        (value.italic === undefined || typeof value.italic === "boolean") &&
        (value.bold === undefined || typeof value.bold === "boolean") &&
        (value.underline === undefined || typeof value.underline === "boolean") &&
        (value.lineThrough === undefined || typeof value.lineThrough === "boolean") &&
        (value.overline === undefined || typeof value.overline === "boolean") &&
        (value.textTransform === undefined ||
            (typeof value.textTransform === "string" &&
                (TEXT_TRANSFORMS as readonly string[]).includes(value.textTransform)))
    )
}

function isBorderToken(value: unknown): value is BorderToken {
    return (
        isRecord(value) &&
        typeof value.name === "string" &&
        typeof value.width === "string" &&
        typeof value.style === "string" &&
        typeof value.colorRef === "string"
    )
}

function isBreakpointToken(value: unknown): value is BreakpointToken {
    return isRecord(value) && typeof value.name === "string" && typeof value.minWidth === "string"
}

function isButtonVariantToken(value: unknown): value is ButtonVariantToken {
    return (
        isRecord(value) &&
        typeof value.name === "string" &&
        typeof value.background === "string" &&
        typeof value.text === "string" &&
        typeof value.radius === "string" &&
        typeof value.paddingX === "string" &&
        typeof value.paddingY === "string" &&
        (value.border === undefined || typeof value.border === "string")
    )
}

function isSiteChromeRoles(value: unknown): value is SiteChromeRoles {
    return (
        isRecord(value) &&
        (value.pageBackground === undefined || typeof value.pageBackground === "string") &&
        (value.bodyText === undefined || typeof value.bodyText === "string") &&
        (value.linkColor === undefined || typeof value.linkColor === "string") &&
        (value.linkHoverColor === undefined || typeof value.linkHoverColor === "string") &&
        (value.mutedText === undefined || typeof value.mutedText === "string") &&
        (value.footerBackground === undefined || typeof value.footerBackground === "string") &&
        (value.hairlineBorder === undefined || typeof value.hairlineBorder === "string") &&
        (value.horizontalSpace === undefined || typeof value.horizontalSpace === "string") &&
        (value.horizontalSpaceInset === undefined || typeof value.horizontalSpaceInset === "string") &&
        (value.horizontalSpaceItemGap === undefined || typeof value.horizontalSpaceItemGap === "string") &&
        (value.horizontalSpaceControl === undefined || typeof value.horizontalSpaceControl === "string")
    )
}

function isWebFont(value: unknown): value is WebFont {
    return (
        isRecord(value) &&
        typeof value.family === "string" &&
        (value.weights === undefined ||
            (Array.isArray(value.weights) && value.weights.every((weight) => typeof weight === "number")))
    )
}

/**
 * Whether a value is a structurally valid TokenCatalog. Used to validate the stored `design_theme`
 * item before use (theme editor §6.5, build fetch §6.6). Structural only — it does not check that
 * values are legal CSS or that names are unique.
 *
 * @param {unknown} value - the candidate catalog (e.g. a parsed `tokens` field)
 * @returns {boolean} - true if the value matches the TokenCatalog shape
 */
export function isTokenCatalog(value: unknown): value is TokenCatalog {
    return (
        isRecord(value) &&
        typeof value.schemaVersion === "number" &&
        // Optional, trap-A: an older theme has no colorScheme and must still validate (defaults to
        // "adaptive" on read). Present-but-not-one-of the two literals is a rejection.
        (value.colorScheme === undefined || value.colorScheme === "adaptive" || value.colorScheme === "fixed") &&
        isArrayOf(value.colors, isValueToken) &&
        isArrayOf(value.typography, isTypographyToken) &&
        isArrayOf(value.space, isValueToken) &&
        isArrayOf(value.radius, isValueToken) &&
        isArrayOf(value.shadows, isValueToken) &&
        isArrayOf(value.borders, isBorderToken) &&
        isArrayOf(value.breakpoints, isBreakpointToken) &&
        // Optional (trap A): a theme predating buttonVariants must validate, or the whole catalog is
        // rejected and every design page renders unstyled. Present-but-malformed is still a rejection.
        (value.buttonVariants === undefined || isArrayOf(value.buttonVariants, isButtonVariantToken)) &&
        // Optional, same trap-A contract as buttonVariants.
        (value.fonts === undefined || isArrayOf(value.fonts, isWebFont)) &&
        // Optional, same trap-A contract as buttonVariants.
        (value.siteChrome === undefined || isSiteChromeRoles(value.siteChrome)) &&
        (value.layoutStackBreakpoint === undefined || typeof value.layoutStackBreakpoint === "string") &&
        // Optional, trap-A: a theme predating this field must still validate (defaults to enabled on read).
        (value.viewTransitions === undefined || typeof value.viewTransitions === "boolean")
    )
}

/** A Google Fonts family name: letters/digits in single-space-separated words. Anything else is untrusted. */
const WEB_FONT_FAMILY_PATTERN = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/

/**
 * Builds the Google Fonts css2 stylesheet URL for the given web fonts, or null when none is valid.
 *
 * Each family is validated against `WEB_FONT_FAMILY_PATTERN` and its weights are constrained to distinct
 * positive integers (≤ 1000), so a hand-edited theme cannot inject arbitrary text into the built URL. A
 * family that fails validation is skipped rather than aborting the whole URL. A family with no valid
 * weight loads weight 400.
 *
 * Not linked directly into a page — `theme-fonts.ts`'s `localizeThemeFonts` fetches this URL at build
 * time, downloads the font files it references, and rewrites them into locally self-hosted
 * `@font-face` rules (see that file for why: self-hosting is what makes `<link rel="preload">`, and so
 * a reliable first-paint, possible at all). No `display=` param: whatever this stylesheet says is
 * discarded and replaced by `localizeThemeFonts`'s own per-subset choice.
 *
 * @param {WebFont[]} fonts - the theme's declared web fonts
 * @returns {string | null} - the css2 stylesheet URL, or null if no font is valid
 */
export function webFontsHref(fonts: WebFont[]): string | null {
    const families: string[] = []
    for (const font of fonts) {
        if (typeof font?.family !== "string" || !WEB_FONT_FAMILY_PATTERN.test(font.family)) continue
        const weights = [...new Set(font.weights ?? [])]
            .filter((weight) => Number.isInteger(weight) && weight > 0 && weight <= 1000)
            .sort((a, b) => a - b)
        const list = weights.length > 0 ? weights : [400]
        families.push(`family=${font.family.replace(/ /g, "+")}:wght@${list.join(";")}`)
    }
    if (families.length === 0) return null
    return `https://fonts.googleapis.com/css2?${families.join("&")}`
}

/** One dangling reference from a button variant to a token that is not in the catalog. */
export interface TokenCatalogFinding {
    variant: string
    /** the variant field carrying the dangling reference (e.g. "background", "border") */
    field: string
    /** the referenced token name that does not exist */
    ref: string
    /** the kind the reference should have resolved against */
    kind: TokenKind
}

/**
 * Lints a theme's own internal references: each button variant references color/space/radius/border
 * tokens by name, and this reports any whose target is absent. This is the second-order dangle the
 * design-level `unknown-token` rule cannot see — that rule checks a `Button.variant` names a variant
 * that exists; this checks the variant's own refs. Structural only, like `isTokenCatalog`.
 *
 * @param {TokenCatalog} catalog - the theme catalog
 * @returns {TokenCatalogFinding[]} - one finding per dangling variant reference, in catalog order
 */
export function lintTokenCatalog(catalog: TokenCatalog): TokenCatalogFinding[] {
    const findings: TokenCatalogFinding[] = []
    for (const variant of catalog.buttonVariants ?? []) {
        const refs: Array<[field: string, ref: string, kind: TokenKind]> = [
            ["background", variant.background, "colors"],
            ["text", variant.text, "colors"],
            ["radius", variant.radius, "radius"],
            ["paddingX", variant.paddingX, "space"],
            ["paddingY", variant.paddingY, "space"]
        ]
        if (variant.border !== undefined && variant.border !== "") refs.push(["border", variant.border, "borders"])
        for (const [field, ref, kind] of refs) {
            if (!hasToken(catalog, kind, ref)) findings.push({ variant: variant.name, field, ref, kind })
        }
    }
    return findings
}
