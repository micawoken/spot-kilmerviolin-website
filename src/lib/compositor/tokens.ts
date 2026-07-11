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

import { isRecord } from "./types"

/** A named CSS value token (colors, space, radius, shadows). `value` is any CSS value string. */
export interface ValueToken {
    name: string
    value: string
}

/** A typography token: emitted as one custom property per sub-value (impl §4.3). */
export interface TypographyToken {
    name: string
    family: string
    size: string
    weight: string
    lineHeight: string
    letterSpacing?: string
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
 * The theme's token catalog — the value of the single `design_theme` item's `tokens` field
 * (impl §4.3). A closed set of token types (plan decision 7); `modes` is a documented schema
 * door for dark mode, intentionally not built in Phase 1.
 */
export interface TokenCatalog {
    /** Catalog schema version, independent of the design-doc `schemaVersion`. */
    schemaVersion: number
    colors: ValueToken[]
    typography: TypographyToken[]
    space: ValueToken[]
    radius: ValueToken[]
    shadows: ValueToken[]
    borders: BorderToken[]
    breakpoints: BreakpointToken[]
}

/**
 * A catalog with no tokens in any kind. Used by the build when no theme is published (§6.6): the design
 * still renders structurally, every token select is empty, and no `--dtk-*` property is declared, so
 * token-backed declarations fall back to their initial values rather than breaking the page.
 */
export const EMPTY_TOKEN_CATALOG: TokenCatalog = Object.freeze({
    schemaVersion: 1,
    colors: [],
    typography: [],
    space: [],
    radius: [],
    shadows: [],
    borders: [],
    breakpoints: []
})

/** The catalog keys a component field can select from. Drives `tokenVar` / `tokenSelectOptions`. */
export type TokenKind = "colors" | "typography" | "space" | "radius" | "shadows" | "borders" | "breakpoints"

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
    breakpoints: "breakpoint"
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
    return catalog[kind].some((token) => token.name === name)
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
    return catalog[kind].map((token) => ({ label: token.name, value: token.name }))
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
export function tokensToCss(catalog: TokenCatalog): string {
    const lines: string[] = []

    for (const token of catalog.colors) {
        if (isValidTokenName(token.name)) lines.push(`${tokenVarName("colors", token.name)}: ${token.value};`)
    }
    for (const token of catalog.typography) {
        if (!isValidTokenName(token.name)) continue
        lines.push(`${tokenVarName("typography", token.name, "family")}: ${token.family};`)
        lines.push(`${tokenVarName("typography", token.name, "size")}: ${token.size};`)
        lines.push(`${tokenVarName("typography", token.name, "weight")}: ${token.weight};`)
        lines.push(`${tokenVarName("typography", token.name, "line-height")}: ${token.lineHeight};`)
        if (token.letterSpacing !== undefined) {
            lines.push(`${tokenVarName("typography", token.name, "letter-spacing")}: ${token.letterSpacing};`)
        }
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

    return `:root {\n${lines.map((line) => `    ${line}`).join("\n")}\n}`
}

/** Whether every element of an array passes a per-element guard. */
function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
    return Array.isArray(value) && value.every(guard)
}

function isValueToken(value: unknown): value is ValueToken {
    return isRecord(value) && typeof value.name === "string" && typeof value.value === "string"
}

function isTypographyToken(value: unknown): value is TypographyToken {
    return (
        isRecord(value) &&
        typeof value.name === "string" &&
        typeof value.family === "string" &&
        typeof value.size === "string" &&
        typeof value.weight === "string" &&
        typeof value.lineHeight === "string" &&
        (value.letterSpacing === undefined || typeof value.letterSpacing === "string")
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
        isArrayOf(value.colors, isValueToken) &&
        isArrayOf(value.typography, isTypographyToken) &&
        isArrayOf(value.space, isValueToken) &&
        isArrayOf(value.radius, isValueToken) &&
        isArrayOf(value.shadows, isValueToken) &&
        isArrayOf(value.borders, isBorderToken) &&
        isArrayOf(value.breakpoints, isBreakpointToken)
    )
}
