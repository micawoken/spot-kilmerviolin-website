/**
 * lib/compositor/theme-controls.ts
 *
 * Pure parse/format helpers behind the theme editor's friendly (CSS-less) controls. Each token cell
 * stores a raw CSS value string (the single source of truth, `tokens.ts`); a friendly control *parses*
 * that string on render and *formats* the edited pieces back on change. These functions are that seam,
 * and the entire risk surface — so they are pure, dependency-free, and unit-tested (`theme-controls.test.ts`).
 *
 * The contract every parser holds: return `null` for any input it cannot round-trip confidently, so the
 * control can fall back to a raw text input for that one cell rather than clobber a value it did not
 * understand (plan decision "never lossy" — this matters most for the load-bearing `md` centering clamp).
 * A parser never throws.
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
 * Splits a CSS value on a single-character separator, but only at the top nesting level — a separator
 * inside `(...)` is kept, so `rgb(0, 0, 0)` inside a larger value is not mis-split. Shared by every
 * parser here (comma-splitting function args, space-splitting shadow layers) so they agree on nesting.
 *
 * @param {string} input - the CSS value to split
 * @param {string} separator - a single character to split on at depth 0
 * @returns {string[]} - the top-level segments, in order (never trimmed; callers trim as needed)
 */
export function splitTopLevel(input: string, separator: string): string[] {
    const parts: string[] = []
    let depth = 0
    let current = ""
    for (const ch of input) {
        if (ch === "(") depth++
        else if (ch === ")") depth = Math.max(0, depth - 1)
        if (ch === separator && depth === 0) {
            parts.push(current)
            current = ""
        } else {
            current += ch
        }
    }
    parts.push(current)
    return parts
}

/** The two channels of a `light-dark()` color: the value shown in a light scheme and in a dark one. */
export interface LightDarkPair {
    light: string
    dark: string
}

/**
 * Parses a `light-dark(L, D)` color into its two channels, or `null` if the string is not exactly one
 * top-level `light-dark()` call with two non-empty arguments (e.g. a plain `#fff`, or trailing text).
 *
 * @param {string} input - the candidate color value
 * @returns {LightDarkPair | null} - the light/dark channels (trimmed), or null
 */
export function parseLightDark(input: string): LightDarkPair | null {
    const match = /^light-dark\(([\s\S]*)\)$/.exec(input.trim())
    if (!match) return null
    const parts = splitTopLevel(match[1], ",").map((part) => part.trim())
    if (parts.length !== 2 || parts[0] === "" || parts[1] === "") return null
    return { light: parts[0], dark: parts[1] }
}

/**
 * Formats a light/dark channel pair back into a `light-dark(L, D)` string.
 *
 * @param {LightDarkPair} pair - the two channels
 * @returns {string} - the `light-dark(L, D)` value
 */
export function formatLightDark(pair: LightDarkPair): string {
    return `light-dark(${pair.light}, ${pair.dark})`
}

/**
 * Whether a string is a hex color (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`). Gates the native
 * `<input type="color">`, which only round-trips hex; a non-hex channel (a named color, `rgb()`,
 * `var(...)`) falls back to a text input.
 *
 * @param {string} input - the candidate color value
 * @returns {boolean} - true if the trimmed value is a hex color
 */
export function isHexColor(input: string): boolean {
    return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(input.trim())
}

/** The length units the number+unit control offers; `""` is the unitless option (e.g. a `0` or a line-height). */
export const LENGTH_UNITS = ["", "rem", "px", "em", "%", "vw", "vh", "ch"] as const

/** A length unit offered by `LengthControl`; `""` means unitless. */
export type LengthUnit = (typeof LENGTH_UNITS)[number]

/** A length split into its numeric part (kept as a string to round-trip exactly) and its unit. */
export interface LengthParts {
    number: string
    unit: LengthUnit
}

/**
 * Parses a `<number><unit>` length into its parts, or `null` for anything that is not a single plain
 * number with a known unit — `clamp(...)`, `calc(...)`, `var(...)`, or an unrecognized unit all return
 * null so the caller shows a raw or clamp control instead. `number` is kept verbatim (not reparsed to a
 * float) so `.5`, `0`, and `2.50` round-trip unchanged.
 *
 * @param {string} input - the candidate length value
 * @returns {LengthParts | null} - the number and unit, or null
 */
export function parseLength(input: string): LengthParts | null {
    const match = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i.exec(input.trim())
    if (!match) return null
    const unit = match[2].toLowerCase()
    if (!LENGTH_UNITS.includes(unit as LengthUnit)) return null
    return { number: match[1], unit: unit as LengthUnit }
}

/**
 * Formats length parts back into a `<number><unit>` string.
 *
 * @param {LengthParts} parts - the number and unit
 * @returns {string} - the length value
 */
export function formatLength(parts: LengthParts): string {
    return `${parts.number}${parts.unit}`
}

/** The three sub-values of a responsive `clamp(min, preferred, max)`, each an arbitrary length expression. */
export interface ClampParts {
    min: string
    preferred: string
    max: string
}

/**
 * Parses a `clamp(min, preferred, max)` into its three sub-values, or `null` if the string is not
 * exactly one top-level `clamp()` call with three non-empty arguments. The sub-values are returned
 * verbatim (they may themselves be `calc(...)` etc.), so the builder edits them as lengths where it can
 * and as raw text otherwise.
 *
 * @param {string} input - the candidate clamp value
 * @returns {ClampParts | null} - the three sub-values (trimmed), or null
 */
export function parseClamp(input: string): ClampParts | null {
    const match = /^clamp\(([\s\S]*)\)$/.exec(input.trim())
    if (!match) return null
    const parts = splitTopLevel(match[1], ",").map((part) => part.trim())
    if (parts.length !== 3 || parts.some((part) => part === "")) return null
    return { min: parts[0], preferred: parts[1], max: parts[2] }
}

/**
 * Formats clamp sub-values back into a `clamp(min, preferred, max)` string.
 *
 * @param {ClampParts} parts - the three sub-values
 * @returns {string} - the clamp value
 */
export function formatClamp(parts: ClampParts): string {
    return `clamp(${parts.min}, ${parts.preferred}, ${parts.max})`
}

/**
 * One `box-shadow` layer. `blur`/`spread`/`color` may be empty when the source omitted them; `x` and `y`
 * are always present (a layer without both offsets does not parse). Lengths are kept as strings to
 * round-trip exactly.
 */
export interface ShadowLayer {
    inset: boolean
    x: string
    y: string
    blur: string
    spread: string
    color: string
}

/** A single space-separated shadow token that reads as a length (offset/blur/spread), not a color. */
const SHADOW_LENGTH_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)(?:[a-z%]+)?$/i

/**
 * Parses one `box-shadow` layer (no top-level commas) into structured parts, or `null` if it is
 * ambiguous. Recognizes the `inset` keyword anywhere, 2–4 length values (offset-x, offset-y, then
 * optional blur and spread, in order), and at most one color token (anything not a length or `inset`,
 * including `rgb(...)`, kept whole because `splitTopLevel` does not split inside its parens).
 */
function parseShadowLayer(layer: string): ShadowLayer | null {
    const tokens = splitTopLevel(layer.trim(), " ")
        .map((token) => token.trim())
        .filter((token) => token !== "")
    if (tokens.length === 0) return null

    let inset = false
    const lengths: string[] = []
    const colors: string[] = []
    for (const token of tokens) {
        if (token.toLowerCase() === "inset") inset = true
        else if (SHADOW_LENGTH_PATTERN.test(token)) lengths.push(token)
        else colors.push(token)
    }
    if (lengths.length < 2 || lengths.length > 4 || colors.length > 1) return null

    return {
        inset,
        x: lengths[0],
        y: lengths[1],
        blur: lengths[2] ?? "",
        spread: lengths[3] ?? "",
        color: colors[0] ?? ""
    }
}

/**
 * Parses a `box-shadow` value into its layers, or `null` if any layer is ambiguous (so the whole cell
 * falls back to raw text rather than a partial builder). `"none"` parses to an empty layer list.
 *
 * @param {string} input - the candidate box-shadow value
 * @returns {ShadowLayer[] | null} - the layers (possibly empty for "none"), or null
 */
export function parseShadow(input: string): ShadowLayer[] | null {
    const trimmed = input.trim()
    if (trimmed === "") return null
    if (trimmed.toLowerCase() === "none") return []

    const layers = splitTopLevel(trimmed, ",")
        .map((layer) => layer.trim())
        .filter((layer) => layer !== "")
    if (layers.length === 0) return null

    const parsed: ShadowLayer[] = []
    for (const layer of layers) {
        const one = parseShadowLayer(layer)
        if (one === null) return null
        parsed.push(one)
    }
    return parsed
}

/** Formats one layer in the canonical `[inset] x y [blur] [spread] [color]` order. */
function formatShadowLayer(layer: ShadowLayer): string {
    const parts: string[] = []
    if (layer.inset) parts.push("inset")
    parts.push(layer.x, layer.y)
    // CSS reads a lone third length as blur and a fourth as spread, so a spread with no blur needs an
    // explicit 0 blur to keep spread in the right position.
    if (layer.blur !== "" || layer.spread !== "") parts.push(layer.blur || "0")
    if (layer.spread !== "") parts.push(layer.spread)
    if (layer.color !== "") parts.push(layer.color)
    return parts.join(" ")
}

/**
 * Formats shadow layers back into a `box-shadow` value; an empty list formats to `"none"`. Emits the
 * canonical token order, so a re-parsed value is semantically identical though not necessarily
 * byte-identical to an oddly-ordered original (only ever written when the user edits the layer).
 *
 * @param {ShadowLayer[]} layers - the layers to format
 * @returns {string} - the box-shadow value
 */
export function formatShadow(layers: ShadowLayer[]): string {
    if (layers.length === 0) return "none"
    return layers.map(formatShadowLayer).join(", ")
}

/** An opaque RGB triple, 0–255 per channel. */
export interface RgbColor {
    r: number
    g: number
    b: number
}

function hexToRgb(input: string): RgbColor | null {
    const match = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(input.trim())
    if (!match) return null
    const digits = match[1].length <= 4 ? [...match[1]].map((digit) => digit + digit).join("") : match[1]
    return { r: Number.parseInt(digits.slice(0, 2), 16), g: Number.parseInt(digits.slice(2, 4), 16), b: Number.parseInt(digits.slice(4, 6), 16) }
}

/** One `rgb()`/`rgba()` channel: a plain number (0–255) or a percentage of it. */
function parseRgbChannel(token: string): number | null {
    if (token.endsWith("%")) {
        const percent = Number.parseFloat(token)
        return Number.isNaN(percent) ? null : Math.round((percent / 100) * 255)
    }
    const value = Number.parseFloat(token)
    return Number.isNaN(value) ? null : Math.round(value)
}

function rgbFunctionToRgb(input: string): RgbColor | null {
    const match = /^rgba?\(([\s\S]*)\)$/i.exec(input.trim())
    if (!match) return null
    // Only the comma-separated legacy syntax is supported (`rgb(r, g, b[, a])`); the modern
    // space-separated `rgb(r g b / a)` form is rarer in hand-authored themes and falls back to null,
    // same as any other value this module cannot confidently parse.
    const parts = splitTopLevel(match[1], ",").map((part) => part.trim())
    if (parts.length < 3) return null
    const channels = parts.slice(0, 3).map(parseRgbChannel)
    if (channels.some((channel) => channel === null)) return null
    const [r, g, b] = channels as number[]
    return { r, g, b }
}

/** Converts an `hsl()`/`hsla()` triple (degrees, percent, percent) to RGB via the standard formula. */
function hslToRgb(h: number, s: number, l: number): RgbColor {
    const hue = ((h % 360) + 360) % 360
    const chroma = (1 - Math.abs(2 * l - 1)) * s
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
    const m = l - chroma / 2
    const [r1, g1, b1] =
        hue < 60
            ? [chroma, x, 0]
            : hue < 120
              ? [x, chroma, 0]
              : hue < 180
                ? [0, chroma, x]
                : hue < 240
                  ? [0, x, chroma]
                  : hue < 300
                    ? [x, 0, chroma]
                    : [chroma, 0, x]
    return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) }
}

function hslFunctionToRgb(input: string): RgbColor | null {
    const match = /^hsla?\(([\s\S]*)\)$/i.exec(input.trim())
    if (!match) return null
    const parts = splitTopLevel(match[1], ",").map((part) => part.trim())
    if (parts.length < 3) return null
    const h = Number.parseFloat(parts[0])
    const s = Number.parseFloat(parts[1]) / 100
    const l = Number.parseFloat(parts[2]) / 100
    if ([h, s, l].some((value) => Number.isNaN(value))) return null
    return hslToRgb(h, s, l)
}

/**
 * Parses a CSS color into an RGB triple, or `null` if it is not hex, `rgb()`/`rgba()`, or `hsl()`/`hsla()`
 * (a named color, `var()`, `color-mix()`, `oklch()`, etc. all return null — the caller falls back to its
 * pre-contrast-aware behavior for those, same "never guess" contract as every parser in this module).
 *
 * @param {string} input - the candidate CSS color
 * @returns {RgbColor | null} - the color's RGB triple, or null if unparseable
 */
export function parseCssColorToRgb(input: string): RgbColor | null {
    const trimmed = input.trim()
    return hexToRgb(trimmed) ?? rgbFunctionToRgb(trimmed) ?? hslFunctionToRgb(trimmed)
}

/**
 * WCAG relative luminance of an sRGB color (0 = black, 1 = white).
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 *
 * @param {RgbColor} rgb - the color
 * @returns {number} - the relative luminance, in [0, 1]
 */
export function relativeLuminance({ r, g, b }: RgbColor): number {
    const channel = (value: number) => {
        const s = value / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * The legible text color (`#000000` or `#ffffff`) to lay over a background color, chosen by whichever
 * gives the higher WCAG contrast ratio — or `null` if the background can't be parsed (see
 * `parseCssColorToRgb`), in which case the caller should keep its existing (ambient/inherited) text color
 * rather than guess.
 *
 * @param {string} background - the CSS background color
 * @returns {"#000000" | "#ffffff" | null} - the higher-contrast text color, or null if unparseable
 */
export function bestTextColorFor(background: string): "#000000" | "#ffffff" | null {
    const rgb = parseCssColorToRgb(background)
    if (!rgb) return null
    const luminance = relativeLuminance(rgb)
    const contrastWithBlack = (luminance + 0.05) / 0.05
    const contrastWithWhite = 1.05 / (luminance + 0.05)
    return contrastWithBlack >= contrastWithWhite ? "#000000" : "#ffffff"
}
