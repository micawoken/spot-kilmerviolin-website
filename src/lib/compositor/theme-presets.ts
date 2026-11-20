/**
 * lib/compositor/theme-presets.ts
 *
 * Alternative design systems the theme editor can load as a starting point
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

import type { TokenCatalog, TokenKind, TypographyToken, ValueToken } from "./tokens"

/**
 * Every preset defines this core vocabulary, so a design authored against one preset keeps resolving
 * after switching to another. Names the public CSS reads directly (outside Site Chrome roles) are in
 * here too: typography `body`/`display`/`label`, space `xs`/`sm`/`md`/`section`, radius `sm`, border
 * `hairline`.
 */
export const PRESET_CORE_NAMES: Readonly<Record<Exclude<TokenKind, "breakpoints">, readonly string[]>> = {
    colors: ["paper", "ink", "muted", "accent", "accent-strong", "surface", "rule", "on-accent", "transparent"],
    typography: ["body", "display", "heading", "label", "small"],
    space: ["xs", "sm", "md", "lg", "section"],
    radius: ["sm", "md"],
    shadows: ["md"],
    borders: ["hairline", "default", "accent"],
    buttonVariants: ["primary", "secondary", "ghost"]
}

/** One loadable design system */
export interface ThemePreset {
    /** stable kebab-case id */
    id: string
    label: string
    /** one-sentence description shown under the picker */
    summary: string
    catalog: TokenCatalog
}

/** A `light-dark()` pair */
const ld = (light: string, dark: string): string => `light-dark(${light}, ${dark})`

/** The per-preset palette: every core color as a light/dark pair, plus any extra named colors */
interface Palette {
    paper: [string, string]
    ink: [string, string]
    muted: [string, string]
    accent: [string, string]
    accentStrong: [string, string]
    surface: [string, string]
    rule: [string, string]
    onAccent: [string, string]
    extra?: Array<[name: string, light: string, dark: string]>
}

function colors(palette: Palette): ValueToken[] {
    return [
        { name: "paper", value: ld(...palette.paper) },
        { name: "ink", value: ld(...palette.ink) },
        { name: "muted", value: ld(...palette.muted) },
        { name: "accent", value: ld(...palette.accent) },
        { name: "accent-strong", value: ld(...palette.accentStrong) },
        { name: "surface", value: ld(...palette.surface) },
        { name: "rule", value: ld(...palette.rule) },
        { name: "on-accent", value: ld(...palette.onAccent) },
        { name: "transparent", value: "transparent" },
        ...(palette.extra ?? []).map(([name, light, dark]) => ({ name, value: ld(light, dark) }))
    ]
}

/** Space scale from five values, in core-name order */
function space(xs: string, sm: string, md: string, lg: string, section: string): ValueToken[] {
    return [
        { name: "xs", value: xs },
        { name: "sm", value: sm },
        { name: "md", value: md },
        { name: "lg", value: lg },
        { name: "section", value: section }
    ]
}

const BREAKPOINTS = [
    { name: "sm", minWidth: "640px" },
    { name: "md", minWidth: "768px" },
    { name: "lg", minWidth: "1024px" }
]

/** Site Chrome wiring shared by every preset: all roles point at core names */
const SITE_CHROME = {
    pageBackground: "paper",
    bodyText: "ink",
    linkColor: "accent",
    linkHoverColor: "accent-strong",
    mutedText: "muted",
    footerBackground: "surface",
    hairlineBorder: "hairline",
    headingTypography: "display",
    paragraphTypography: "body",
    horizontalSpaceInset: "md",
    horizontalSpaceContentInset: "md",
    horizontalSpaceItemGap: "sm",
    horizontalSpaceControl: "sm",
    verticalSpaceSection: "section",
    verticalSpaceHeader: "md",
    verticalSpaceFooter: "lg",
    verticalSpaceItemGap: "sm",
    verticalSpaceControl: "xs",
    verticalSpaceStatic: "md"
} as const

/** Assembles a full catalog; `chrome` overrides individual Site Chrome roles */
function catalog(parts: {
    palette: Palette
    typography: TypographyToken[]
    space: ValueToken[]
    radius: [sm: string, md: string]
    shadow: string
    borders: { hairline: string; default: string; accent: string }
    buttons: { radius: "sm" | "md"; paddingX: string; paddingY: string; secondaryBorder: "default" | "accent" }
    fonts: TokenCatalog["fonts"]
    chrome?: Partial<Record<keyof typeof SITE_CHROME, string>>
}): TokenCatalog {
    const { buttons } = parts
    return {
        schemaVersion: 1,
        colorScheme: "adaptive",
        colors: colors(parts.palette),
        typography: parts.typography,
        space: parts.space,
        radius: [
            { name: "sm", value: parts.radius[0] },
            { name: "md", value: parts.radius[1] }
        ],
        shadows: [{ name: "md", value: parts.shadow }],
        borders: [
            { name: "hairline", width: parts.borders.hairline, style: "solid", colorRef: "rule" },
            { name: "default", width: parts.borders.default, style: "solid", colorRef: "ink" },
            { name: "accent", width: parts.borders.accent, style: "solid", colorRef: "accent" }
        ],
        breakpoints: BREAKPOINTS,
        buttonVariants: [
            {
                name: "primary",
                background: "accent",
                text: "on-accent",
                border: "accent",
                radius: buttons.radius,
                paddingX: buttons.paddingX,
                paddingY: buttons.paddingY
            },
            {
                name: "secondary",
                background: "transparent",
                text: buttons.secondaryBorder === "accent" ? "accent" : "ink",
                border: buttons.secondaryBorder,
                radius: buttons.radius,
                paddingX: buttons.paddingX,
                paddingY: buttons.paddingY
            },
            {
                name: "ghost",
                background: "transparent",
                text: "accent",
                radius: buttons.radius,
                paddingX: buttons.paddingX,
                paddingY: buttons.paddingY
            }
        ],
        fonts: parts.fonts,
        siteChrome: { ...SITE_CHROME, ...parts.chrome },
        layoutStackBreakpoint: "md",
        viewTransitions: true
    }
}

const CASLON = '"Libre Caslon Text", "Iowan Old Style", Georgia, serif'
const CASLON_DISPLAY = '"Libre Caslon Display", "Libre Caslon Text", Georgia, serif'

/** Scholarly sheet-music edition: printed-page restraint, hairlines instead of boxes, one ink color */
const ENGRAVED_EDITION = catalog({
    palette: {
        paper: ["#fbfaf6", "#161514"],
        ink: ["#1b1a17", "#e9e5dc"],
        muted: ["#5f5a52", "#a8a196"],
        accent: ["#7a1f1f", "#e29a8e"],
        accentStrong: ["#561313", "#f2c0b6"],
        surface: ["#f2efe7", "#1f1d1b"],
        rule: ["#cdc6b8", "#3d3833"],
        onAccent: ["#fbfaf6", "#161514"]
    },
    typography: [
        {
            name: "body",
            family: CASLON,
            size: "1.0625rem",
            weight: "400",
            lineHeight: "1.6",
            paragraphSpacing: "0.9em"
        },
        {
            name: "display",
            family: CASLON_DISPLAY,
            size: "clamp(2rem, 1.4rem + 2.4vw, 3rem)",
            weight: "400",
            lineHeight: "1.12",
            letterSpacing: "0"
        },
        {
            name: "heading",
            family: CASLON,
            size: "1.25rem",
            weight: "700",
            lineHeight: "1.3",
            paragraphSpacing: "0.5em"
        },
        // Letterspaced capitals stand in for true small caps, which a typography token cannot request.
        {
            name: "label",
            family: CASLON,
            size: "0.75rem",
            weight: "400",
            lineHeight: "1.3",
            letterSpacing: "0.12em",
            textTransform: "uppercase"
        },
        { name: "small", family: CASLON, size: "0.875rem", weight: "400", lineHeight: "1.45" }
    ],
    space: space("0.375rem", "0.75rem", "1.5rem", "3rem", "3.5rem"),
    radius: ["0", "0"],
    shadow: "none",
    borders: { hairline: "1px", default: "1px", accent: "1px" },
    buttons: { radius: "sm", paddingX: "md", paddingY: "xs", secondaryBorder: "default" },
    fonts: [
        { family: "Libre Caslon Text", weights: [400, 700] },
        { family: "Libre Caslon Display", weights: [400] }
    ]
})

const PLEX_SANS = '"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif'
const PLEX_MONO = '"IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace'

/** Library/RISM-style reference database: dense, ruled, built to be scanned rather than read */
const REFERENCE_CATALOG = catalog({
    palette: {
        paper: ["#ffffff", "#121212"],
        ink: ["#161616", "#e4e4e4"],
        muted: ["#555555", "#a0a0a0"],
        accent: ["#0a5c7a", "#6cc4e2"],
        accentStrong: ["#063f54", "#a3dcef"],
        surface: ["#f3f3f1", "#1b1b1b"],
        rule: ["#c9c9c6", "#383838"],
        onAccent: ["#ffffff", "#0b1a20"]
    },
    typography: [
        {
            name: "body",
            family: PLEX_SANS,
            size: "0.9375rem",
            weight: "400",
            lineHeight: "1.45",
            paragraphSpacing: "0.75em"
        },
        {
            name: "display",
            family: PLEX_SANS,
            size: "1.75rem",
            weight: "600",
            lineHeight: "1.2",
            letterSpacing: "-0.01em"
        },
        {
            name: "heading",
            family: PLEX_SANS,
            size: "1.125rem",
            weight: "600",
            lineHeight: "1.3",
            paragraphSpacing: "0.4em"
        },
        {
            name: "label",
            family: PLEX_MONO,
            size: "0.75rem",
            weight: "500",
            lineHeight: "1.3",
            letterSpacing: "0.03em",
            textTransform: "uppercase"
        },
        { name: "small", family: PLEX_SANS, size: "0.8125rem", weight: "400", lineHeight: "1.4" },
        // Identifiers, catalogue numbers, dates: tabular figures come free with a monospace face.
        { name: "data", family: PLEX_MONO, size: "0.875rem", weight: "400", lineHeight: "1.4" }
    ],
    space: space("0.25rem", "0.5rem", "1rem", "2rem", "2rem"),
    radius: ["2px", "2px"],
    shadow: "none",
    borders: { hairline: "1px", default: "1px", accent: "1px" },
    buttons: { radius: "sm", paddingX: "sm", paddingY: "xs", secondaryBorder: "default" },
    fonts: [
        { family: "IBM Plex Sans", weights: [400, 600] },
        { family: "IBM Plex Mono", weights: [400, 500] }
    ],
    chrome: { verticalSpaceHeader: "sm", verticalSpaceFooter: "md", horizontalSpaceContentInset: "sm" }
})

const BODONI = '"Bodoni Moda", "Didot", "Bodoni 72", serif'
const SPECTRAL = 'Spectral, "Iowan Old Style", Georgia, serif'

/** Printed recital program: high-contrast Didone titles over a calm text face, wide margins */
const CONCERT_PROGRAM = catalog({
    palette: {
        paper: ["#faf8f2", "#111613"],
        ink: ["#1d2621", "#e6e3d8"],
        muted: ["#58635c", "#9ea89f"],
        accent: ["#1f5c40", "#8fd0ab"],
        accentStrong: ["#123b29", "#bce6cc"],
        surface: ["#f0ede3", "#18201b"],
        rule: ["#d3cdbd", "#33403a"],
        onAccent: ["#faf8f2", "#0f1712"]
    },
    typography: [
        {
            name: "body",
            family: SPECTRAL,
            size: "1.0625rem",
            weight: "400",
            lineHeight: "1.65",
            paragraphSpacing: "1em"
        },
        // Didones fall apart small; Bodoni Moda is only ever set at display/heading sizes here.
        {
            name: "display",
            family: BODONI,
            size: "clamp(2.25rem, 1.5rem + 3vw, 3.5rem)",
            weight: "500",
            lineHeight: "1.08",
            letterSpacing: "0"
        },
        {
            name: "heading",
            family: BODONI,
            size: "1.5rem",
            weight: "500",
            lineHeight: "1.2",
            paragraphSpacing: "0.5em"
        },
        {
            name: "label",
            family: SPECTRAL,
            size: "0.75rem",
            weight: "500",
            lineHeight: "1.3",
            letterSpacing: "0.18em",
            textTransform: "uppercase"
        },
        { name: "small", family: SPECTRAL, size: "0.875rem", weight: "400", lineHeight: "1.5" }
    ],
    space: space("0.5rem", "1rem", "2rem", "4rem", "5rem"),
    radius: ["0", "0"],
    shadow: "none",
    borders: { hairline: "1px", default: "1px", accent: "1px" },
    buttons: { radius: "sm", paddingX: "md", paddingY: "xs", secondaryBorder: "accent" },
    fonts: [
        { family: "Bodoni Moda", weights: [500] },
        { family: "Spectral", weights: [400, 500] }
    ],
    chrome: { horizontalSpaceContentInset: "lg", verticalSpaceStatic: "lg" }
})

const ATKINSON = '"Atkinson Hyperlegible", Verdana, "Segoe UI", sans-serif'

/** Teaching studio: legibility first, for teachers and students reading on any device */
const TEACHING_STUDIO = catalog({
    palette: {
        paper: ["#ffffff", "#0f0f0f"],
        ink: ["#111111", "#f4f4f4"],
        muted: ["#454545", "#c4c4c4"],
        accent: ["#a3330c", "#ff9f7a"],
        accentStrong: ["#76240a", "#ffc4ad"],
        surface: ["#f4f1ec", "#1a1a1a"],
        rule: ["#8a8a8a", "#6e6e6e"],
        onAccent: ["#ffffff", "#140600"],
        // Categorical colors for the three record types, for designs to color-code entity pages.
        extra: [
            ["composer", "#0f5f8c", "#7cc3ef"],
            ["work", "#7d2e68", "#e8a3d6"],
            ["contributor", "#2e6b1f", "#9bd88a"]
        ]
    },
    typography: [
        { name: "body", family: ATKINSON, size: "1.125rem", weight: "400", lineHeight: "1.6", paragraphSpacing: "1em" },
        {
            name: "display",
            family: ATKINSON,
            size: "clamp(2rem, 1.6rem + 1.6vw, 2.625rem)",
            weight: "700",
            lineHeight: "1.15",
            letterSpacing: "-0.005em"
        },
        {
            name: "heading",
            family: ATKINSON,
            size: "1.375rem",
            weight: "700",
            lineHeight: "1.3",
            paragraphSpacing: "0.5em"
        },
        {
            name: "label",
            family: ATKINSON,
            size: "0.875rem",
            weight: "700",
            lineHeight: "1.3",
            letterSpacing: "0.02em"
        },
        { name: "small", family: ATKINSON, size: "1rem", weight: "400", lineHeight: "1.5" }
    ],
    space: space("0.5rem", "0.875rem", "1.5rem", "2.5rem", "3rem"),
    radius: ["4px", "4px"],
    shadow: "0 1px 0 rgba(0, 0, 0, 0.25)",
    borders: { hairline: "1px", default: "2px", accent: "2px" },
    buttons: { radius: "sm", paddingX: "md", paddingY: "sm", secondaryBorder: "default" },
    fonts: [{ family: "Atkinson Hyperlegible", weights: [400, 700] }]
})

export const THEME_PRESETS: readonly ThemePreset[] = [
    {
        id: "engraved-edition",
        label: "Engraved edition",
        summary:
            "Modeled on scholarly sheet-music editions. Caslon serif, oxblood ink, hairline rules, square corners, no shadows.",
        catalog: ENGRAVED_EDITION
    },
    {
        id: "reference-catalog",
        label: "Reference catalog",
        summary:
            "Modeled on library and RISM-style databases. Dense IBM Plex Sans with Plex Mono for data, grayscale plus a petrol-blue signal.",
        catalog: REFERENCE_CATALOG
    },
    {
        id: "concert-program",
        label: "Concert program",
        summary:
            "Modeled on a printed recital program. Bodoni Moda titles over Spectral text, deep green on ivory, generous margins.",
        catalog: CONCERT_PROGRAM
    },
    {
        id: "teaching-studio",
        label: "Teaching studio",
        summary:
            "Accessibility-first. Atkinson Hyperlegible at a larger size, high contrast, 2px borders, a color per record type.",
        catalog: TEACHING_STUDIO
    }
]

/** A token identified by kind and name */
export interface TokenRef {
    kind: TokenKind
    name: string
}

export interface AppliedPreset {
    catalog: TokenCatalog
    /** tokens designs reference that the preset lacks, copied over from the current theme */
    carried: TokenRef[]
    /** tokens designs reference that neither the preset nor the current theme defines */
    missing: TokenRef[]
}

/**
 * Applies a preset on top of the current theme without stranding any design: every token some design
 * references (`usage` keys are `"<kind>:<name>"`, as `collectTokenUsage` builds them) that the preset
 * does not define is carried over from the current theme unchanged.
 */
export function applyThemePreset(
    preset: TokenCatalog,
    current: TokenCatalog,
    usage: ReadonlyMap<string, readonly string[]> | null
): AppliedPreset {
    const next = structuredClone(preset)
    const carried: TokenRef[] = []
    const missing: TokenRef[] = []

    /** Ensures (kind, name) resolves in `next`, copying it (and whatever it references) from `current` */
    const carry = (kind: TokenKind, name: string): void => {
        if (!name) return
        const target = (next[kind] ??= []) as Array<{ name: string }>
        if (target.some((token) => token.name === name)) return
        const source = (current[kind] as Array<{ name: string }> | undefined)?.find((token) => token.name === name)
        if (!source) {
            if (!missing.some((ref) => ref.kind === kind && ref.name === name)) missing.push({ kind, name })
            return
        }
        target.push(structuredClone(source))
        carried.push({ kind, name })
        // A carried border or button names other tokens; those must resolve too.
        if (kind === "borders") carry("colors", (source as unknown as { colorRef: string }).colorRef)
        if (kind === "buttonVariants") {
            const variant = source as NonNullable<TokenCatalog["buttonVariants"]>[number]
            carry("colors", variant.background)
            carry("colors", variant.text)
            carry("radius", variant.radius)
            carry("space", variant.paddingX)
            carry("space", variant.paddingY)
            if (variant.border) carry("borders", variant.border)
        }
    }

    for (const key of usage?.keys() ?? []) {
        const separator = key.indexOf(":")
        carry(key.slice(0, separator) as TokenKind, key.slice(separator + 1))
    }
    return { catalog: next, carried, missing }
}
