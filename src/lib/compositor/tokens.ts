/**
 * lib/compositor/tokens.ts
 *
 * Design token catalog
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
import { buttonHoverBrightness } from "./theme-controls"

/** A named CSS value token (colors, space, radius, shadows). `value` is any CSS value string. */
export interface ValueToken {
    name: string
    value: string
}

/**
 * CSS `text-transform` keywords a typography token may default to
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
    /** The gap AFTER a block set in this style */
    paragraphSpacing?: string
    /** `font-style: italic` when true */
    italic?: boolean
    /** Forces the emitted weight to `"bold"`, overriding `weight` for that one property only (the
     * field itself is untouched — unchecking restores it) */
    bold?: boolean
    /** `text-decoration-line` components — independent flags since CSS allows combining them (e.g.
     * underline + line-through) */
    underline?: boolean
    lineThrough?: boolean
    overline?: boolean
    textTransform?: TextTransform
}

/** A border token */
export interface BorderToken {
    name: string
    width: string
    style: string
    colorRef: string
}

/** A responsive breakpoint */
export interface BreakpointToken {
    name: string
    minWidth: string
}

/**
 * A named button style: a bundle of references to other tokens (mirrors `BorderToken.colorRef`)
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

export interface WebFont {
    /** the family name exactly as Google Fonts lists it, e.g. "Inter" or "Playfair Display" */
    family: string
    /** the weights to load; defaults to [400] when empty. Non-integer or out-of-range weights are dropped. */
    weights?: number[]
}

/**
 * Public site frame's fixed semantic color/border/spacing roles
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
    /** names a `typography` token; page-title `<h1>` on static pages and Portable Text (Puck pages
     * bind their own heading separately). Unset falls back to `display` by magic name. */
    headingTypography?: string
    paragraphTypography?: string
    horizontalSpace?: string
    horizontalSpaceInset?: string
    horizontalSpaceContentInset?: string
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
    /** names a `space` token; vertical rhythm separating major page blocks — `main > article`/unwrapped
     * `main` top/bottom padding, NavTiles/entity-list grid margins, search-page form margin. Header/
     * footer have their own split-out roles below rather than sharing this one. */
    verticalSpaceSection?: string
    /** names a `space` token; the header nav's own top/bottom padding, independent of the footer's. */
    verticalSpaceHeader?: string
    /** names a `space` token; the footer's own top/bottom padding and the margin above it, independent of the header's. */
    verticalSpaceFooter?: string
    /**
     * names a `space` token; the vertical gap between repeated/stacked items — header nav's title/toggle
     * row vs. its nav row (below the header breakpoint), the footer's own link-row/copy stack, the
     * and the NavTiles/entity-list grids' row gap.
     */
    verticalSpaceItemGap?: string
    /**
     * names a `space` token; vertical padding inside interactive controls, and small margins tied to a
     * control's own content — the header/search-page search boxes, NavTiles tiles, entity list-result
     * cards (and their corner ID badge), and the search pages' scope note / result rows / result excerpts.
     */
    verticalSpaceControl?: string
    verticalSpaceStatic?: string
}

export interface TokenCatalog {
    /** Catalog schema version, independent of the design-doc `schemaVersion`. */
    schemaVersion: number
    /** How colors are authored. `"adaptive"` (default when absent) means values carry a
     * `light-dark(L, D)` pair following viewer color scheme; `"fixed"` means a single value.
     * Authoring metadata only — theme editor picks one color picker or two; `tokensToCss` never reads
     * it, emits `value` verbatim. Trap A: a pre-field theme must still validate. */
    colorScheme?: "adaptive" | "fixed"
    colors: ValueToken[]
    typography: TypographyToken[]
    space: ValueToken[]
    radius: ValueToken[]
    shadows: ValueToken[]
    borders: BorderToken[]
    breakpoints: BreakpointToken[]
    buttonVariants?: ButtonVariantToken[]
    /** Site-wide web fonts (Google Fonts). Trap A, normalized to `[]`. Consumed by `webFontsHref`, not
     * `tokensToCss`. */
    fonts?: WebFont[]
    /** Public site frame's semantic color/border role mapping. Trap A; every role within is
     * independently optional too — partial adoption (e.g. only `pageBackground`) is valid. */
    siteChrome?: SiteChromeRoles
    layoutStackBreakpoint?: string
    /** Whether cross-document view transitions are enabled site-wide. Like `layoutStackBreakpoint`, a
     * real `@view-transition` at-rule read at CSS-generation time, not emitted by `tokensToCss`. Trap
     * A: absent means enabled (the site's original always-on behavior); only `false` changes anything. */
    viewTransitions?: boolean
}

/**
 * A catalog with no tokens in any kind
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
    "colors" | "typography" | "space" | "radius" | "shadows" | "borders" | "breakpoints" | "buttonVariants"

/**
 * Registry mapping a component `type` to each of its token-select props and the token kind that prop
 * draws from
 */
export type TokenPropRegistry = Record<string, Record<string, TokenKind>>

/**
 * Kind -> the `--dtk-<segment>-…` name segment. Deliberately terse and stable: these strings are
 * baked into stored/emitted CSS, so renaming a segment is a breaking change to every design page
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
 * Token names are kebab-case slugs
 */
export const TOKEN_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Whether a string is a valid kebab-case token name (see TOKEN_NAME_PATTERN). */
export function isValidTokenName(name: string): boolean {
    return TOKEN_NAME_PATTERN.test(name)
}

/**
 * Characters a token VALUE may never contain, because `tokensToCss`'s output is injected with `set:html`
 * into a `<style>` in the head of every public page (PublicPage.astro)
 */
const UNSAFE_CSS_VALUE_PATTERN = /[<>;{}@\\]/

/** Upper bound on a token value, so a pathological theme cannot bloat every page's head. */
const MAX_TOKEN_VALUE_LENGTH = 512

/**
 * Whether a theme-authored value is safe to interpolate into emitted CSS
 */
export function isSafeTokenValue(value: unknown): value is string {
    return typeof value === "string" && value.length <= MAX_TOKEN_VALUE_LENGTH && !UNSAFE_CSS_VALUE_PATTERN.test(value)
}

/** A custom property that is deliberately never defined, so an invalid reference resolves to unset */
const INVALID_REF_VAR = "--dtk-invalid-ref"

/** CSS custom-property name for a token, e.g. `--dtk-color-accent`, `--dtk-type-body-size`. `sub`
 * names a typography/border sub-value */
export function tokenVarName(kind: TokenKind, name: string, sub?: string): string {
    if (!isValidTokenName(name)) return INVALID_REF_VAR
    const base = `--dtk-${KIND_SEGMENT[kind]}-${name}`
    return sub ? `${base}-${sub}` : base
}

/** A `var(--dtk-…)` reference to a token, for a component's rendered CSS */
export function tokenVar(kind: TokenKind, name: string, sub?: string): string {
    return `var(${tokenVarName(kind, name, sub)})`
}

/** Whether a token of the given kind/name exists in the catalog */
export function hasToken(catalog: TokenCatalog, kind: TokenKind, name: string): boolean {
    return (catalog[kind] ?? []).some((token) => token.name === name)
}

/** Puck select options for a token kind: `{label, value}` both set to the token name. Order follows
 * the catalog. */
export function tokenSelectOptions(catalog: TokenCatalog, kind: TokenKind): { label: string; value: string }[] {
    return (catalog[kind] ?? []).map((token) => ({ label: token.name, value: token.name }))
}

/** `text-decoration-line` value for a typography token's underline/lineThrough/overline flags — CSS
 * allows combining these on one element, so each flag contributes independently */
function textDecorationLine(token: TypographyToken): string {
    const lines: string[] = []
    if (token.underline) lines.push("underline")
    if (token.overline) lines.push("overline")
    if (token.lineThrough) lines.push("line-through")
    return lines.length > 0 ? lines.join(" ") : "none"
}

/** Emits the theme as `--dtk-*` custom properties in a `:root { … }` block */
export function tokensToCss(catalog: TokenCatalog): string {
    const lines: string[] = []

    /** Emits one declaration, dropping it when the value is unsafe */
    function emit(property: string, value: string): void {
        if (isSafeTokenValue(value)) lines.push(`${property}: ${value};`)
    }

    for (const token of catalog.colors) {
        if (isValidTokenName(token.name)) emit(tokenVarName("colors", token.name), token.value)
    }
    for (const token of catalog.typography) {
        if (!isValidTokenName(token.name)) continue
        emit(tokenVarName("typography", token.name, "family"), token.family)
        emit(tokenVarName("typography", token.name, "size"), token.size)
        // `bold` overrides the emitted weight only; `weight` itself is untouched, so unchecking restores it.
        emit(tokenVarName("typography", token.name, "weight"), token.bold ? "bold" : token.weight)
        emit(tokenVarName("typography", token.name, "line-height"), token.lineHeight)
        if (token.letterSpacing !== undefined) {
            emit(tokenVarName("typography", token.name, "letter-spacing"), token.letterSpacing)
        }
        if (token.paragraphSpacing !== undefined) {
            emit(tokenVarName("typography", token.name, "paragraph-spacing"), token.paragraphSpacing)
        }
        // style/decoration/transform are chosen from fixed keyword sets, never free text
        emit(tokenVarName("typography", token.name, "style"), token.italic ? "italic" : "normal")
        emit(tokenVarName("typography", token.name, "decoration"), textDecorationLine(token))
        emit(tokenVarName("typography", token.name, "transform"), token.textTransform ?? "none")
    }
    for (const token of catalog.space) {
        if (isValidTokenName(token.name)) emit(tokenVarName("space", token.name), token.value)
    }
    for (const token of catalog.radius) {
        if (isValidTokenName(token.name)) emit(tokenVarName("radius", token.name), token.value)
    }
    for (const token of catalog.shadows) {
        if (isValidTokenName(token.name)) emit(tokenVarName("shadows", token.name), token.value)
    }
    for (const token of catalog.borders) {
        if (!isValidTokenName(token.name)) continue
        emit(tokenVarName("borders", token.name, "width"), token.width)
        emit(tokenVarName("borders", token.name, "style"), token.style)
        // colorRef resolves to the color token's own property; a dangling ref yields an unset var.
        emit(tokenVarName("borders", token.name, "color"), tokenVar("colors", token.colorRef))
    }
    // Each variant field is a var() to another token's property (like borders' colorRef) — a dangling
    // ref yields an unset var, not a crash. Border sub-values emit only when `border` names a token.
    for (const variant of catalog.buttonVariants ?? []) {
        if (!isValidTokenName(variant.name)) continue
        emit(tokenVarName("buttonVariants", variant.name, "bg"), tokenVar("colors", variant.background))
        emit(tokenVarName("buttonVariants", variant.name, "text"), tokenVar("colors", variant.text))
        emit(tokenVarName("buttonVariants", variant.name, "radius"), tokenVar("radius", variant.radius))
        emit(tokenVarName("buttonVariants", variant.name, "pad-x"), tokenVar("space", variant.paddingX))
        emit(tokenVarName("buttonVariants", variant.name, "pad-y"), tokenVar("space", variant.paddingY))
        if (variant.border !== undefined && variant.border !== "") {
            const border = variant.border
            emit(tokenVarName("buttonVariants", variant.name, "border-width"), tokenVar("borders", border, "width"))
            emit(tokenVarName("buttonVariants", variant.name, "border-style"), tokenVar("borders", border, "style"))
            emit(tokenVarName("buttonVariants", variant.name, "border-color"), tokenVar("borders", border, "color"))
        }
        // Hover cue: a `filter: brightness()` multiplier computed from the variant's own resolved
        // colors (not its var() references — brightness() needs real RGB to simulate), emitted only
        // when it actually helps
        const bgColor = catalog.colors.find((token) => token.name === variant.background)?.value
        const textColor = catalog.colors.find((token) => token.name === variant.text)?.value
        if (bgColor !== undefined && textColor !== undefined) {
            const brightness = buttonHoverBrightness(textColor, bgColor)
            if (brightness !== 1) {
                emit(tokenVarName("buttonVariants", variant.name, "hover-brightness"), String(brightness))
            }
        }
    }
    // Site Chrome roles: emitted only when set, as `--dtk-chrome-<role>` pointing at the chosen
    // token's property (like buttonVariants' refs)
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
            if (name) emit(`--dtk-chrome-${segment}`, tokenVar("colors", name))
        }
        if (chrome.hairlineBorder) {
            const name = chrome.hairlineBorder
            emit("--dtk-chrome-hairline-width", tokenVar("borders", name, "width"))
            emit("--dtk-chrome-hairline-style", tokenVar("borders", name, "style"))
            emit("--dtk-chrome-hairline-color", tokenVar("borders", name, "color"))
        }
        if (chrome.headingTypography) {
            const name = chrome.headingTypography
            emit("--dtk-chrome-heading-family", tokenVar("typography", name, "family"))
            emit("--dtk-chrome-heading-size", tokenVar("typography", name, "size"))
            emit("--dtk-chrome-heading-weight", tokenVar("typography", name, "weight"))
            emit("--dtk-chrome-heading-line-height", tokenVar("typography", name, "line-height"))
            emit("--dtk-chrome-heading-letter-spacing", tokenVar("typography", name, "letter-spacing"))
        }
        if (chrome.paragraphTypography) {
            emit(
                "--dtk-chrome-paragraph-spacing",
                tokenVar("typography", chrome.paragraphTypography, "paragraph-spacing")
            )
        }
        // Each split role falls back to the deprecated singular `horizontalSpace` when unset
        const horizontalSpaceRoles: Array<[string, string | undefined]> = [
            ["horizontal-space-inset", chrome.horizontalSpaceInset ?? chrome.horizontalSpace],
            // No legacy singular fallback: this role didn't exist before the split either
            ["horizontal-space-content-inset", chrome.horizontalSpaceContentInset],
            ["horizontal-space-item-gap", chrome.horizontalSpaceItemGap ?? chrome.horizontalSpace],
            ["horizontal-space-control", chrome.horizontalSpaceControl ?? chrome.horizontalSpace]
        ]
        for (const [segment, name] of horizontalSpaceRoles) {
            if (name) emit(`--dtk-chrome-${segment}`, tokenVar("space", name))
        }
        // Vertical counterpart: independently settable, no legacy singular fallback
        const verticalSpaceRoles: Array<[string, string | undefined]> = [
            ["vertical-space-section", chrome.verticalSpaceSection],
            ["vertical-space-header", chrome.verticalSpaceHeader],
            ["vertical-space-footer", chrome.verticalSpaceFooter],
            ["vertical-space-item-gap", chrome.verticalSpaceItemGap],
            ["vertical-space-control", chrome.verticalSpaceControl],
            ["vertical-space-static", chrome.verticalSpaceStatic]
        ]
        for (const [segment, name] of verticalSpaceRoles) {
            if (name) emit(`--dtk-chrome-${segment}`, tokenVar("space", name))
        }
    }

    return `:root {\n${lines.map((line) => `    ${line}`).join("\n")}\n}`
}

const DEFAULT_COLUMNS_STACK_MAX_WIDTH = "767.98px"

/** A CSS length this may safely place in an `@media` prelude: a number and a known unit, nothing else. */
const BREAKPOINT_LENGTH_PATTERN = /^(-?\d+(?:\.\d+)?)(px|rem|em|ch|ex|vw|vh|vmin|vmax|pt|pc|cm|mm|in|Q)$/

function stackCutoff(minWidth: string): string {
    const match = BREAKPOINT_LENGTH_PATTERN.exec(minWidth.trim())
    if (!match) return DEFAULT_COLUMNS_STACK_MAX_WIDTH
    if (match[2] !== "px") return `${match[1]}${match[2]}`
    return `${Number(match[1]) - 0.02}px`
}

/** The `@media (max-width: …) { .cmp-columns { grid-template-columns: 1fr; } }` rule driving `Columns`'
 * single-column stacking */
export function columnsStackBreakpointCss(catalog: TokenCatalog): string {
    const target = catalog.layoutStackBreakpoint
    const token = target ? catalog.breakpoints.find((candidate) => candidate.name === target) : undefined
    const maxWidth = token ? stackCutoff(token.minWidth) : DEFAULT_COLUMNS_STACK_MAX_WIDTH
    return `@media (max-width: ${maxWidth}) {\n    .cmp-columns {\n        grid-template-columns: 1fr;\n    }\n}`
}

/** The `@view-transition { navigation: auto; }` at-rule crossfading page navigations */
export function viewTransitionCss(catalog: TokenCatalog): string {
    if (catalog.viewTransitions === false) return ""
    return "@view-transition {\n" + "    navigation: auto;\n" + "}"
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
        (value.paragraphSpacing === undefined || typeof value.paragraphSpacing === "string") &&
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
        (value.headingTypography === undefined || typeof value.headingTypography === "string") &&
        (value.paragraphTypography === undefined || typeof value.paragraphTypography === "string") &&
        (value.horizontalSpace === undefined || typeof value.horizontalSpace === "string") &&
        (value.horizontalSpaceInset === undefined || typeof value.horizontalSpaceInset === "string") &&
        (value.horizontalSpaceContentInset === undefined || typeof value.horizontalSpaceContentInset === "string") &&
        (value.horizontalSpaceItemGap === undefined || typeof value.horizontalSpaceItemGap === "string") &&
        (value.horizontalSpaceControl === undefined || typeof value.horizontalSpaceControl === "string") &&
        (value.verticalSpaceSection === undefined || typeof value.verticalSpaceSection === "string") &&
        (value.verticalSpaceHeader === undefined || typeof value.verticalSpaceHeader === "string") &&
        (value.verticalSpaceFooter === undefined || typeof value.verticalSpaceFooter === "string") &&
        (value.verticalSpaceItemGap === undefined || typeof value.verticalSpaceItemGap === "string") &&
        (value.verticalSpaceControl === undefined || typeof value.verticalSpaceControl === "string") &&
        (value.verticalSpaceStatic === undefined || typeof value.verticalSpaceStatic === "string")
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

/** Whether a value is a structurally valid TokenCatalog — validates the stored `design_theme` item
 * before use. Structural only, doesn't check values are legal CSS or names are unique. */
export function isTokenCatalog(value: unknown): value is TokenCatalog {
    return (
        isRecord(value) &&
        typeof value.schemaVersion === "number" &&
        // Trap A: an older theme has no colorScheme, must still validate (defaults "adaptive" on read).
        (value.colorScheme === undefined || value.colorScheme === "adaptive" || value.colorScheme === "fixed") &&
        isArrayOf(value.colors, isValueToken) &&
        isArrayOf(value.typography, isTypographyToken) &&
        isArrayOf(value.space, isValueToken) &&
        isArrayOf(value.radius, isValueToken) &&
        isArrayOf(value.shadows, isValueToken) &&
        isArrayOf(value.borders, isBorderToken) &&
        isArrayOf(value.breakpoints, isBreakpointToken) &&
        // Trap A: a theme predating buttonVariants must validate, or the whole catalog is rejected and
        // every design page renders unstyled. Present-but-malformed is still a rejection.
        (value.buttonVariants === undefined || isArrayOf(value.buttonVariants, isButtonVariantToken)) &&
        (value.fonts === undefined || isArrayOf(value.fonts, isWebFont)) &&
        (value.siteChrome === undefined || isSiteChromeRoles(value.siteChrome)) &&
        (value.layoutStackBreakpoint === undefined || typeof value.layoutStackBreakpoint === "string") &&
        (value.viewTransitions === undefined || typeof value.viewTransitions === "boolean")
    )
}

/** A Google Fonts family name: letters/digits in single-space-separated words. Anything else is untrusted. */
const WEB_FONT_FAMILY_PATTERN = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/

/** Builds the Google Fonts css2 stylesheet URL for the given web fonts */
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

/** Maps a CSS `font-weight` value to the numeric form Google's `@font-face` blocks use. */
function numericFontWeight(weight: string): string {
    const trimmed = weight.trim().toLowerCase()
    if (trimmed === "bold") return "700"
    if (trimmed === "normal") return "400"
    return trimmed
}

/** Stable `family|weight` key for one font face */
export function fontFaceKey(family: string, weight: string): string {
    const primary = family
        .split(",")[0]
        .trim()
        .replace(/^["']|["']$/g, "")
    return `${primary.toLowerCase()}|${numericFontWeight(weight)}`
}

/** Every (family, weight) face some typography token actually asks for
 *
 * @param {TokenCatalog} catalog - the published theme
 * @returns {Set<string>} `fontFaceKey` values; empty when the theme has no typography tokens
 */
export function referencedFontFaces(catalog: TokenCatalog): Set<string> {
    const faces = new Set<string>()
    for (const token of catalog.typography ?? []) {
        if (typeof token?.family !== "string" || typeof token.weight !== "string") continue
        faces.add(fontFaceKey(token.family, token.bold ? "700" : token.weight))
    }
    return faces
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

/** Lints a theme's own internal references */
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

/** One token whose value `tokensToCss` will refuse to emit (see {@link isSafeTokenValue}). */
export interface TokenValueFinding {
    /** the token kind the value belongs to */
    kind: TokenKind
    /** the token's name */
    name: string
    /** the field carrying the value (e.g. "value", "family", "minWidth") */
    field: string
}

/**
 * Reports every theme value `tokensToCss` (or `columnsStackBreakpointCss`) will drop as unsafe
 */
export function lintTokenValues(catalog: TokenCatalog): TokenValueFinding[] {
    const findings: TokenValueFinding[] = []
    const check = (kind: TokenKind, name: string, field: string, value: string | undefined): void => {
        if (value !== undefined && !isSafeTokenValue(value)) findings.push({ kind, name, field })
    }
    for (const kind of ["colors", "space", "radius", "shadows"] as const) {
        for (const token of catalog[kind]) check(kind, token.name, "value", token.value)
    }
    for (const token of catalog.typography) {
        check("typography", token.name, "family", token.family)
        check("typography", token.name, "size", token.size)
        check("typography", token.name, "weight", token.weight)
        check("typography", token.name, "lineHeight", token.lineHeight)
        check("typography", token.name, "letterSpacing", token.letterSpacing)
        check("typography", token.name, "paragraphSpacing", token.paragraphSpacing)
    }
    for (const token of catalog.borders) {
        check("borders", token.name, "width", token.width)
        check("borders", token.name, "style", token.style)
    }
    // A breakpoint's minWidth reaches CSS through stackCutoff, which falls back rather than emitting it.
    for (const token of catalog.breakpoints) {
        if (!BREAKPOINT_LENGTH_PATTERN.test(token.minWidth.trim())) {
            findings.push({ kind: "breakpoints", name: token.name, field: "minWidth" })
        }
    }
    return findings
}
