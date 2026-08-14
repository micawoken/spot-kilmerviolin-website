/**
 * lib/compositor/tokens.ts
 *
 * Design token catalog (impl §4.3): the closed set of theme values a design page may use. Owns the
 * `TokenCatalog` type, structural guards, CSS custom-property emission (`tokensToCss`), the
 * `var(--dtk-…)` reference builder (`tokenVar`), and the Puck select-option builder
 * (`tokenSelectOptions`).
 *
 * Every visual control stores a token *name*, resolved to `var(--dtk-…)` at render — raw CSS values
 * never appear in component fields (plan decision 4). A stored name absent from the current theme
 * resolves to an unset custom property (rendering never throws on drift); lint surfaces the dangle.
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
    /** The gap AFTER a block set in this style, when it sits directly above another block of the same
     * kind of content — RichText's own paragraphs/headings/code-blocks, and (via the `paragraphTypography`
     * site-chrome role) the gap between stacked components generally. Deliberately distinct from
     * `lineHeight`: line-height spaces WRAPPED LINES within one block, this spaces SEPARATE blocks placed
     * adjacent to each other — conflating the two was the "unusual structure" this field exists to fix.
     * Trap A: absent means the consuming CSS's own literal fallback applies (no token-name assumption). */
    paragraphSpacing?: string
    /** `font-style: italic` when true. Trap A: absent means not italic. */
    italic?: boolean
    /** Forces the emitted weight to `"bold"`, overriding `weight` for that one property only (the
     * field itself is untouched — unchecking restores it). Trap A: absent = pre-field behavior. */
    bold?: boolean
    /** `text-decoration-line` components — independent flags since CSS allows combining them (e.g.
     * underline + line-through). Trap A: absent means no decoration. */
    underline?: boolean
    lineThrough?: boolean
    overline?: boolean
    /** Trap A: absent means no transform. */
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
 * Public site frame's fixed semantic color/border/spacing roles (page background, body text, links,
 * horizontal spacing, …), each naming a token authored elsewhere in the catalog. Closed,
 * non-removable role set; which token fills each is the owner's choice, resolved like
 * `Section.background`/`Divider.color`.
 *
 * Replaces the earlier convention of `public-chrome.css`/`search.astro` hardcoding specific color
 * names (`ink`, `paper`, `garnet`, `slate`, `surface`), a `hairline` border name, and a hand-picked
 * `--dtk-space-*` name per declaration — undiscoverable from the editor UI, silently falling back to
 * generic defaults when unset. Every role is OPTIONAL (trap A): unset falls back to the old
 * magic-name lookup in the consuming CSS, so an unmigrated theme renders unchanged until its owner
 * sets these explicitly.
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
    /** names a `typography` token; its `paragraphSpacing` sub-value governs the gap between paragraphs/
     * headings/code-blocks inside RichText, and the gap between stacked components generally (Section's
     * content slot, a Columns column, MediaText's text side) — `compositor.css`'s single
     * `--dtk-chrome-paragraph-spacing` property. Unlike the space roles below, unset does NOT fall back
     * to any specific named token — the consuming CSS's own `var(…, <literal>)` fallback applies instead,
     * so this role introduces no new magic-name assumption (mirrors `headingTypography`'s indirection,
     * deliberately without its "old magic-name lookup" fallback tier: there was no prior per-declaration
     * name to preserve here, `.cmp-root`/`.cmp-section`/`.cmp-columns__col` previously hardcoded
     * `--dtk-space-md` and RichText's own paragraphs had no themed value at all). Never applies inside
     * `ContentField`'s own label/value row — that row's `row-gap: 0` is intentionally untouched so a
     * stacked label never gains a gap from its value. */
    paragraphTypography?: string
    /** names a `space` token; DEPRECATED, superseded by the three split roles below. Kept only so a
     * pre-split catalog has a value to migrate from — `toEditable` seeds the three split roles from
     * this one time when unset, `tokensToCss` falls back to it per-role the same way, so an
     * already-configured theme doesn't revert to the built-in fallback the moment the split ships.
     * Never written by a save going forward. */
    horizontalSpace?: string
    /**
     * names a `space` token; how far the header nav and footer sit from the viewport edge. Main
     * content's own inset is the separate {@link horizontalSpaceContentInset} role below — split out so
     * a theme can shrink the content column on phones without also collapsing the header/footer gutter.
     */
    horizontalSpaceInset?: string
    /**
     * names a `space` token; how far MAIN CONTENT sits from the viewport edge — `main > article`,
     * unwrapped `main` content (including NavTiles' outer padding-inline, and static pages' own wrapper
     * — both share the same `main > :not(.cmp-section, article)` rule, so there is no separate static-page
     * inset to author), and `.cmp-section`. Independent of `horizontalSpaceInset`
     * (header/footer): unset falls back to that role in the header/footer-shared rules (`main > article`,
     * unwrapped `main`), so an already-configured theme doesn't lose main-content theming
     * the moment this role ships — but `.cmp-section` falls back straight to the built-in `--dtk-space-md`
     * default instead, since it never read `horizontalSpaceInset` in the first place (it hardcoded
     * `--dtk-space-md` directly). No legacy singular (`horizontalSpace`) fallback: this role didn't exist
     * before the split either. Author the referenced space token's value as a `clamp()`/`calc()`
     * expression (e.g. `clamp(0px, 4vw, 1.5rem)`) to shrink the content inset toward zero on phones —
     * token values are arbitrary CSS length expressions, so no separate breakpoint mechanism is needed.
     */
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
    /**
     * names a `space` token; extra top/bottom padding ADDED on top of {@link verticalSpaceSection},
     * scoped only to the pre-generated "static" pages (entity/database index, search, search/advanced —
     * see public-chrome.css's `.entity-index-body`/`.search-page` rule) via those pages' own existing
     * wrapper classes, not a dedicated marker class. Unlike the horizontal inset, which a shared rule now
     * computes identically for every unwrapped `main` child (Puck's `.cmp-root` and a static page's
     * wrapper alike — see public-chrome.css), a static page still has no equivalent of a Puck top-level
     * `Section`'s own `paddingY` dropdown (catalog.tsx SectionProps): every such Section can pick ANY
     * space token for its vertical padding, while a static page always renders at the fixed
     * `verticalSpaceSection` role. This role is the owner-operated, additive correction for whatever
     * vertical drift results — unset (0) by default.
     */
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
    /** Theme-authored button styles. Trap A, normalized to `[]` on read — a pre-field theme must still
     * validate or `fetchPublishedTheme` rejects the whole catalog and unstyles every page. New keys
     * added here must follow the same pattern. */
    buttonVariants?: ButtonVariantToken[]
    /** Site-wide web fonts (Google Fonts). Trap A, normalized to `[]`. Consumed by `webFontsHref`, not
     * `tokensToCss`. */
    fonts?: WebFont[]
    /** Public site frame's semantic color/border role mapping. Trap A; every role within is
     * independently optional too — partial adoption (e.g. only `pageBackground`) is valid. */
    siteChrome?: SiteChromeRoles
    /** Names a `breakpoints` token whose `minWidth` drives the one real breakpoint-consuming rule
     * (`Columns` stacking below this width). Site-wide: custom properties can't appear in `@media`
     * conditions, so read at CSS-generation time (`theme-head.ts`) and baked in as a literal pixel
     * value, replacing the old hardcoded 768px. Trap A: unset (or a dangling name) preserves 768px. */
    layoutStackBreakpoint?: string
    /** Whether cross-document view transitions are enabled site-wide. Like `layoutStackBreakpoint`, a
     * real `@view-transition` at-rule read at CSS-generation time, not emitted by `tokensToCss`. Trap
     * A: absent means enabled (the site's original always-on behavior); only `false` changes anything. */
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
    "colors" | "typography" | "space" | "radius" | "shadows" | "borders" | "breakpoints" | "buttonVariants"

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

/** Whether a string is a valid kebab-case token name (see TOKEN_NAME_PATTERN). */
export function isValidTokenName(name: string): boolean {
    return TOKEN_NAME_PATTERN.test(name)
}

/**
 * Characters a token VALUE may never contain, because `tokensToCss`'s output is injected with `set:html`
 * into a `<style>` in the head of every public page (PublicPage.astro) — unescaped, as `<style>` content
 * must be. `<` and `>` are what close the element and open a `<script>`; `;`, `{` and `}` are what append
 * a declaration or open a new rule (attribute-selector exfiltration, defacement); `@` opens an at-rule;
 * `\` opens a CSS escape sequence, which exists only to obscure the rest.
 *
 * None of these appear in a legitimate value — the emitter supplies the `;` itself, and real values are
 * colors, lengths, `calc()`/`clamp()` expressions, font stacks and shadow lists.
 */
const UNSAFE_CSS_VALUE_PATTERN = /[<>;{}@\\]/

/** Upper bound on a token value, so a pathological theme cannot bloat every page's head. */
const MAX_TOKEN_VALUE_LENGTH = 512

/**
 * Whether a theme-authored value is safe to interpolate into emitted CSS. Values are validated at
 * EMISSION, where every authoring path converges — the theme editor is not the only writer, since a
 * `design_editor` may PUT the `design_theme` item over the API directly.
 */
export function isSafeTokenValue(value: unknown): value is string {
    return typeof value === "string" && value.length <= MAX_TOKEN_VALUE_LENGTH && !UNSAFE_CSS_VALUE_PATTERN.test(value)
}

/** A custom property that is deliberately never defined, so an invalid reference resolves to unset —
 * the same fail-soft a dangling (but well-formed) reference already gets. */
const INVALID_REF_VAR = "--dtk-invalid-ref"

/** CSS custom-property name for a token, e.g. `--dtk-color-accent`, `--dtk-type-body-size`. `sub`
 * names a typography/border sub-value.
 *
 * A malformed `name` collapses to {@link INVALID_REF_VAR} rather than being interpolated: names reach
 * here from theme-authored REFERENCES too (a border's `colorRef`, a button variant's `background`, a
 * site-chrome role), not just from a token's own pre-validated name, and those land in the value half of
 * an emitted declaration — the same `<style set:html>` sink the value guard above covers. */
export function tokenVarName(kind: TokenKind, name: string, sub?: string): string {
    if (!isValidTokenName(name)) return INVALID_REF_VAR
    const base = `--dtk-${KIND_SEGMENT[kind]}-${name}`
    return sub ? `${base}-${sub}` : base
}

/** A `var(--dtk-…)` reference to a token, for a component's rendered CSS. Returns the reference
 * regardless of whether the token currently exists — a missing token resolves to an unset custom
 * property, not a throw; lint reports the dangle. */
export function tokenVar(kind: TokenKind, name: string, sub?: string): string {
    return `var(${tokenVarName(kind, name, sub)})`
}

/** Whether a token of the given kind/name exists in the catalog. Used by lint and the unknown-token
 * tests; rendering itself never needs it (missing tokens fail soft to unset vars). */
export function hasToken(catalog: TokenCatalog, kind: TokenKind, name: string): boolean {
    return (catalog[kind] ?? []).some((token) => token.name === name)
}

/** Puck select options for a token kind: `{label, value}` both set to the token name. Order follows
 * the catalog. */
export function tokenSelectOptions(catalog: TokenCatalog, kind: TokenKind): { label: string; value: string }[] {
    return (catalog[kind] ?? []).map((token) => ({ label: token.name, value: token.name }))
}

/** `text-decoration-line` value for a typography token's underline/lineThrough/overline flags — CSS
 * allows combining these on one element, so each flag contributes independently. */
function textDecorationLine(token: TypographyToken): string {
    const lines: string[] = []
    if (token.underline) lines.push("underline")
    if (token.overline) lines.push("overline")
    if (token.lineThrough) lines.push("line-through")
    return lines.length > 0 ? lines.join(" ") : "none"
}

/** Emits the theme as `--dtk-*` custom properties in a `:root { … }` block — one property per simple
 * value token, one per typography/border sub-value. Injected as a `<style>` into the build head and
 * the Puck canvas iframe. Malformed-name tokens are skipped; breakpoints aren't emitted (custom
 * properties can't be used in `@media` conditions — the catalog references breakpoint values
 * directly). */
export function tokensToCss(catalog: TokenCatalog): string {
    const lines: string[] = []

    /** Emits one declaration, dropping it when the value is unsafe — matching how a malformed NAME is
     * already dropped. Omission is the only safe rejection here: a substituted placeholder would be a
     * silent, invisible restyle, whereas a missing custom property falls back to the consuming CSS's own
     * `var(…, <fallback>)` and lint reports the value (see lintTokenCatalog). */
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
        // when it actually helps. Unresolvable colors or no safe direction leave this unset, so
        // compositor.css's `var(…, 1)` fallback is a no-op hover — fail-soft, never a guess.
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
    // token's property (like buttonVariants' refs). Unset emits nothing, so the consuming CSS's own
    // `var(--dtk-chrome-…, <old magic-name lookup>)` fallback takes over — an unmigrated theme renders
    // unchanged until its owner sets these explicitly.
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
        // Each split role falls back to the deprecated singular `horizontalSpace` when unset, so a
        // pre-split catalog keeps rendering identically until its owner adjusts the roles independently.
        const horizontalSpaceRoles: Array<[string, string | undefined]> = [
            ["horizontal-space-inset", chrome.horizontalSpaceInset ?? chrome.horizontalSpace],
            // No legacy singular fallback: this role didn't exist before the split either. The
            // header/footer-shared consuming rules add their own CSS-level fallback to
            // --dtk-chrome-horizontal-space-inset when this is unset (see public-chrome.css); .cmp-section
            // (compositor.css) falls back straight to --dtk-space-md instead, matching its prior behavior.
            ["horizontal-space-content-inset", chrome.horizontalSpaceContentInset],
            ["horizontal-space-item-gap", chrome.horizontalSpaceItemGap ?? chrome.horizontalSpace],
            ["horizontal-space-control", chrome.horizontalSpaceControl ?? chrome.horizontalSpace]
        ]
        for (const [segment, name] of horizontalSpaceRoles) {
            if (name) emit(`--dtk-chrome-${segment}`, tokenVar("space", name))
        }
        // Vertical counterpart: independently settable, no legacy singular fallback — unlike
        // horizontalSpace, ships split from the start. Header/footer split from verticalSpaceSection so
        // their rhythms tune independently of each other and of main-content/grid rhythm.
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

/** The historical fixed cutoff (`compositor.css`'s old hardcoded rule) used when no theme designates a
 *  `layoutStackBreakpoint`, so an unmigrated/untouched theme keeps this exact prior behavior. */
const DEFAULT_COLUMNS_STACK_MAX_WIDTH = "767.98px"

/** A CSS length this may safely place in an `@media` prelude: a number and a known unit, nothing else. */
const BREAKPOINT_LENGTH_PATTERN = /^(-?\d+(?:\.\d+)?)(px|rem|em|ch|ex|vw|vh|vmin|vmax|pt|pc|cm|mm|in|Q)$/

/**
 * Just below a breakpoint token's own `minWidth`, matching the historical 767.98-for-768 idiom (a
 * `minWidth` of `N`px stacks below it, not at-or-above it). A non-`px` unit is used as-is, since the
 * 0.02 nudge is meaningful only in pixels.
 *
 * The pattern is a VALIDATION GATE, not a formatting convenience: the result is interpolated into an
 * `@media` prelude that `columnsStackBreakpointCss` emits into a `<style set:html>` on every public page,
 * so anything that is not a plain length — `calc()`, or a payload closing the `<style>` element — falls
 * back to the historical cutoff rather than reaching the page. Returning unmatched input verbatim was the
 * same defect as an unvalidated token value, through a different function.
 */
function stackCutoff(minWidth: string): string {
    const match = BREAKPOINT_LENGTH_PATTERN.exec(minWidth.trim())
    if (!match) return DEFAULT_COLUMNS_STACK_MAX_WIDTH
    if (match[2] !== "px") return `${match[1]}${match[2]}`
    return `${Number(match[1]) - 0.02}px`
}

/** The `@media (max-width: …) { .cmp-columns { grid-template-columns: 1fr; } }` rule driving `Columns`'
 * single-column stacking. Generated here, not hardcoded in `compositor.css`, because it's
 * theme-authored: `layoutStackBreakpoint` names a `breakpoints` token, and custom properties can't
 * appear in `@media` conditions — the chosen breakpoint's literal pixel value must be baked directly
 * into this CSS text. Falls back to the historical fixed cutoff when unset or dangling. */
export function columnsStackBreakpointCss(catalog: TokenCatalog): string {
    const target = catalog.layoutStackBreakpoint
    const token = target ? catalog.breakpoints.find((candidate) => candidate.name === target) : undefined
    const maxWidth = token ? stackCutoff(token.minWidth) : DEFAULT_COLUMNS_STACK_MAX_WIDTH
    return `@media (max-width: ${maxWidth}) {\n    .cmp-columns {\n        grid-template-columns: 1fr;\n    }\n}`
}

/** The `@view-transition { navigation: auto; }` at-rule crossfading page navigations, or `""` when
 * the theme explicitly disabled it. Generated here, not hardcoded, because it's theme-authored like
 * `columnsStackBreakpointCss`. Falls back to enabled — only explicit `false` turns it off.
 *
 * Deliberately does not restyle the UA crossfade. The UA drives it with complementary opacity keyframes
 * under `mix-blend-mode: plus-lighter` inside an `isolation: isolate` image pair, so the two snapshots
 * sum to exactly `(1-t)·old + t·new` at alpha 1 — an exact crossfade. Overriding the blend to `normal`
 * instead stacks them, dropping content to 0.75 alpha at the midpoint and visibly dimming every
 * navigation; a DevTools trace measured that dip to the decimal. Leave the UA default alone. */
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

/** Builds the Google Fonts css2 stylesheet URL for the given web fonts, or null when none is valid.
 * Each family is validated against `WEB_FONT_FAMILY_PATTERN`, weights constrained to distinct positive
 * integers (≤1000), so a hand-edited theme can't inject arbitrary text into the URL. A family failing
 * validation is skipped, not fatal; no valid weight loads 400.
 *
 * Not linked directly into a page — `theme-fonts.ts`'s `localizeThemeFonts` fetches this at build time,
 * downloads the fonts, rewrites them into self-hosted `@font-face` rules (self-hosting is what makes
 * `<link rel="preload">`, and reliable first-paint, possible). No `display=` param — discarded and
 * replaced by `localizeThemeFonts`'s own per-subset choice. */
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

/** Stable `family|weight` key for one font face. Family is the first entry of a CSS font stack (the web
 *  font itself; the rest are local fallbacks, never fetched), compared case-insensitively. */
export function fontFaceKey(family: string, weight: string): string {
    const primary = family
        .split(",")[0]
        .trim()
        .replace(/^["']|["']$/g, "")
    return `${primary.toLowerCase()}|${numericFontWeight(weight)}`
}

/** Every (family, weight) face some typography token actually asks for — the set worth preloading.
 *
 * A theme authors a font's weights independently of the tokens that use them, so a catalog routinely
 * self-hosts faces nothing references; preloading those spends first-paint bandwidth on a file that is
 * never painted. `bold` requests 700 in place of the token's own weight, not alongside it (see
 * {@link TypographyToken}).
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

/** Lints a theme's own internal references: each button variant references color/space/radius/border
 * tokens by name, reports any whose target is absent. The second-order dangle the design-level
 * `unknown-token` rule can't see — that rule checks a `Button.variant` names a variant that exists,
 * this checks the variant's own refs. */
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
 * Reports every theme value `tokensToCss` (or `columnsStackBreakpointCss`) will drop as unsafe.
 *
 * Emission-time rejection is silent by design — a dropped custom property simply falls back — so without
 * this a theme owner would see a styling change with no explanation. Pairs with the emitter rather than
 * replacing it: this is the report, the guard in `tokensToCss` is the control.
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
