/**
 * components/compositor/ThemePreview.tsx
 *
 * Live, per-section previews for the theme editor (`ThemeEditor.tsx`): small, focused specimens — not
 * one master canvas — answering the two questions a flat token table can't: what does this spacing value
 * actually look like, and what happens when this color sits behind this text? Every specimen resolves
 * through `tokenVar`/`tokenVarName` (`lib/compositor/tokens.ts`) exactly as the real components do
 * (`catalog.tsx`), so it renders from the SAME `--dtk-*` custom properties `tokensToCss` emits — never a
 * hand-rolled approximation that could drift from what the published site actually renders. The caller
 * (`ThemeEditor.tsx`) injects that `:root { --dtk-*: … }` block plus `compositor.css` once, live, from the
 * editor's in-progress (unsaved) state — so a preview reflects the current edit, not just the last save.
 *
 * Button variants reuse `renderButtonTag` and typography-adjacent headings could reuse `renderHeadingTag`
 * (both exported from `catalog.tsx` for this purpose) rather than duplicating their JSX, for the same
 * no-drift reason.
 *
 * One deliberately honest limit, not a bug:
 *  - Breakpoint tokens are NOT wired into any component's responsive behavior (`compositor.css`'s
 *    `.cmp-columns` hardcodes 768px, since custom properties cannot appear in `@media` conditions).
 *    `BreakpointScale` is a labeled magnitude comparison, not a working responsive preview, and says so.
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

import { useState } from "react"
import type { CSSProperties, ReactNode } from "react"

import { renderButtonTag } from "../../lib/compositor/catalog"
import {
    bestTextColorFor,
    contrastRatio,
    parseCssColorToRgb,
    parseLightDark,
    WCAG_AA_MIN_CONTRAST,
    WCAG_AAA_MIN_CONTRAST,
    type RgbColor
} from "../../lib/compositor/theme-controls"
import { tokenVar } from "../../lib/compositor/tokens"

/**
 * One editable token row, in the same generic (kind → bag of string fields) shape `ThemeEditor.tsx`
 * edits every token kind in — every field is read defensively (`row.x ?? ""`), same convention as that
 * file's own `toEditable`/`toCatalog`, rather than a per-kind interface the caller would have to satisfy.
 */
type Row = Record<string, string>

/** A short, realistic sample line — not lorem ipsum — so a specimen reads like real site copy. */
const SAMPLE_LINE = "Handcrafted violins, violas, and cellos — sales, restoration, and setup."

/**
 * Colors, in context: each swatch is the color as a background with sample text laid over it. Typography
 * tokens carry no color (`tokens.ts` — `TypographyToken` has no color field), so there is no real
 * background→text binding to reproduce here; instead the swatch text is set to whichever of black/white
 * gives the better WCAG contrast against the swatch's OWN resolved value (`bestTextColorFor`,
 * `theme-controls.ts`) — locked to the currently selected light/dark side, flipping away from that
 * side's usual convention only when the author's actual color demands it (e.g. an unusually light color
 * on the "dark" channel). A color this module can't parse (a named color, `var()`, `oklch()`, …) falls
 * back to the ambient inherited page text color rather than guessing.
 *
 * A color stored as `light-dark(L, D)` (adaptive scheme) resolves against the `color-scheme` CSS
 * property of the element or its ancestor, not the OS/browser preference directly once an element
 * declares its own — so the Light/Dark toggle is pure CSS: flip local state and set
 * `style={{ colorScheme: mode }}` on the wrapping div. Only shown for `colorScheme === "adaptive"`;
 * in `"fixed"` mode there is no dark variant to reveal, and the stored value is used as-is.
 */
export function ColorReference({ colors, colorScheme }: { colors: Row[]; colorScheme?: "adaptive" | "fixed" }) {
    const rows = colors.filter((color) => (color.name ?? "").trim() !== "" && (color.value ?? "").trim() !== "")
    const [mode, setMode] = useState<"light" | "dark">("light")
    if (rows.length === 0) return null
    const showToggle = colorScheme === "adaptive"
    return (
        <div className="theme-preview__color-scope" style={showToggle ? { colorScheme: mode } : undefined}>
            {showToggle && (
                <div className="theme-preview__toggle" role="group" aria-label="Preview color scheme">
                    <button
                        type="button"
                        aria-pressed={mode === "light"}
                        className="theme-preview__toggle-btn"
                        onClick={() => setMode("light")}
                    >
                        Light
                    </button>
                    <button
                        type="button"
                        aria-pressed={mode === "dark"}
                        className="theme-preview__toggle-btn"
                        onClick={() => setMode("dark")}
                    >
                        Dark
                    </button>
                </div>
            )}
            <div className="theme-preview__grid">
                {rows.map((color) => {
                    // Resolve to the side currently being previewed (light-dark() pair split by mode, or
                    // the value as-is in fixed mode / for a plain color), so contrast is judged against
                    // exactly what this swatch is showing, not the other side of an adaptive pair.
                    const pair = showToggle ? parseLightDark(color.value) : null
                    const resolved = pair ? (mode === "light" ? pair.light : pair.dark) : color.value
                    const textColor = bestTextColorFor(resolved)
                    return (
                        <div key={color.name} className="theme-preview__swatch-card">
                            <div
                                className="theme-preview__swatch-face"
                                style={{
                                    background: tokenVar("colors", color.name),
                                    ...(textColor ? { color: textColor } : {})
                                }}
                            >
                                <span className="theme-preview__swatch-heading">Aa</span>
                                <p className="theme-preview__swatch-body">{SAMPLE_LINE}</p>
                            </div>
                            <span className="theme-preview__caption">{color.name}</span>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

/**
 * The Site Chrome color roles this check measures, by name (each is a `colors` token name, or `""` when
 * the role is unset) — a narrow slice of `ThemeEditor.tsx`'s `SiteChromeRow`, kept local here so this
 * module doesn't import that editor-only type.
 */
export interface ChromeColorRoles {
    pageBackground: string
    bodyText: string
    linkColor: string
    linkHoverColor: string
    mutedText: string
    footerBackground: string
}

/**
 * A foreground/background role pairing the public site frame actually renders together
 * (`styles/public-chrome.css`), checked by `SiteChromeContrastCheck`: body text, link, and link-hover
 * colors against the page background (`html body`, `main a`, `main a:hover`), and the muted nav/footer
 * text against each of its own two backgrounds. Deliberately the real pairings the CSS renders, not every
 * combinatorial one — e.g. not muted-text-on-page-background's hover state, which repaints as body text
 * (already covered by the first row) rather than a new color.
 */
const CONTRAST_TARGETS: ReadonlyArray<{ id: string; label: string; fg: keyof ChromeColorRoles; bg: keyof ChromeColorRoles }> = [
    { id: "body", label: "Body text on page background", fg: "bodyText", bg: "pageBackground" },
    { id: "link", label: "Link color on page background", fg: "linkColor", bg: "pageBackground" },
    { id: "link-hover", label: "Link hover color on page background", fg: "linkHoverColor", bg: "pageBackground" },
    { id: "nav", label: "Muted text (nav links) on page background", fg: "mutedText", bg: "pageBackground" },
    { id: "footer", label: "Muted text (footer links/copy) on footer background", fg: "mutedText", bg: "footerBackground" }
]

/** One color role resolved to what it actually renders: the raw CSS string (post light/dark split, for
 *  the preview swatch's inline style) and its parsed RGB (for the contrast math) — either may be `null`
 *  independently, since a browser can render a color (a named color, `var()`, `oklch()`, …) this module's
 *  parser still can't measure. */
interface ResolvedChromeColor {
    value: string | null
    rgb: RgbColor | null
}

/** The unresolved/unset color, so a pairing with an empty role name still renders (as "not assigned")
 *  instead of the row silently vanishing. */
const UNRESOLVED_CHROME_COLOR: ResolvedChromeColor = { value: null, rgb: null }

/**
 * Resolves a Site Chrome role's token name to what it renders, split to the given light/dark mode exactly
 * as `ColorReference`'s own swatches do (same "resolve to the side being previewed" rationale) — so the
 * contrast check always measures the mode currently shown, not the other side of an adaptive pair.
 */
function resolveChromeColor(name: string, colors: Row[], colorScheme: "adaptive" | "fixed", mode: "light" | "dark"): ResolvedChromeColor {
    if (!name) return UNRESOLVED_CHROME_COLOR
    const token = colors.find((color) => color.name === name)
    if (!token) return UNRESOLVED_CHROME_COLOR
    const raw = token.value ?? ""
    const pair = colorScheme === "adaptive" ? parseLightDark(raw) : null
    const value = pair ? (mode === "light" ? pair.light : pair.dark) : raw
    return { value, rgb: parseCssColorToRgb(value) }
}

/** Why a pairing has no ratio to show: distinguishes an unset/dangling role from a color format this
 *  module's parser can't measure, since only the former is fixable from the Site Chrome table above. */
function unresolvedReason(fgName: string, bgName: string, fg: ResolvedChromeColor, bg: ResolvedChromeColor): string {
    if (!fgName || !bgName) return "Assign both roles above to check this pairing."
    if (fg.value === null || bg.value === null) return "One of the assigned tokens no longer exists."
    return "This color's format (e.g. a named color or var()) can't be measured here."
}

/**
 * WCAG AA/AAA contrast for every foreground/background pairing the Site Chrome roles above actually
 * render together on the public site (`CONTRAST_TARGETS`), each with a live swatch of sample text on its
 * real background. Reuses `ColorReference`'s Light/Dark toggle pattern for an adaptive color scheme —
 * an adaptive pairing can pass in one mode and fail in the other, so both are checkable, one at a time.
 * A pairing with an unset role, a dangling token reference, or a color format `theme-controls.ts` can't
 * parse (a named color, `var()`, `oklch()`, …) shows why instead of a ratio — never a guessed pass/fail.
 */
export function SiteChromeContrastCheck({
    colors,
    colorScheme,
    roles
}: {
    colors: Row[]
    colorScheme?: "adaptive" | "fixed"
    roles: ChromeColorRoles
}) {
    const [mode, setMode] = useState<"light" | "dark">("light")
    const showToggle = colorScheme === "adaptive"
    return (
        <div className="theme-preview__contrast">
            {showToggle && (
                <div className="theme-preview__toggle" role="group" aria-label="Contrast check color scheme">
                    <button
                        type="button"
                        aria-pressed={mode === "light"}
                        className="theme-preview__toggle-btn"
                        onClick={() => setMode("light")}
                    >
                        Light
                    </button>
                    <button
                        type="button"
                        aria-pressed={mode === "dark"}
                        className="theme-preview__toggle-btn"
                        onClick={() => setMode("dark")}
                    >
                        Dark
                    </button>
                </div>
            )}
            <div className="theme-preview__contrast-list">
                {CONTRAST_TARGETS.map((target) => {
                    const fgName = roles[target.fg]
                    const bgName = roles[target.bg]
                    const fg = resolveChromeColor(fgName, colors, colorScheme ?? "adaptive", mode)
                    const bg = resolveChromeColor(bgName, colors, colorScheme ?? "adaptive", mode)
                    const ratio = fg.rgb && bg.rgb ? contrastRatio(fg.rgb, bg.rgb) : null
                    const passesAA = ratio !== null && ratio >= WCAG_AA_MIN_CONTRAST
                    const passesAAA = ratio !== null && ratio >= WCAG_AAA_MIN_CONTRAST
                    return (
                        <div key={target.id} className="theme-preview__contrast-row">
                            {fg.value !== null && bg.value !== null ? (
                                <div
                                    className="theme-preview__contrast-swatch"
                                    style={{ background: bg.value, color: fg.value }}
                                >
                                    <span className="theme-preview__contrast-swatch-heading">Aa</span>
                                    <p className="theme-preview__contrast-swatch-body">Sample rendered text</p>
                                </div>
                            ) : (
                                <div className="theme-preview__contrast-swatch" data-empty="true">
                                    No preview
                                </div>
                            )}
                            <div className="theme-preview__contrast-info">
                                <span className="theme-preview__caption">{target.label}</span>
                                {ratio === null ? (
                                    <span className="theme-preview__contrast-unknown">
                                        {unresolvedReason(fgName, bgName, fg, bg)}
                                    </span>
                                ) : (
                                    <span className="theme-preview__contrast-ratio">{ratio.toFixed(2)}:1</span>
                                )}
                            </div>
                            {ratio !== null && (
                                <div className="theme-preview__contrast-badges">
                                    <span className="theme-preview__contrast-badge" data-pass={passesAA}>
                                        AA {passesAA ? "Pass" : "Fail"}
                                    </span>
                                    <span className="theme-preview__contrast-badge" data-pass={passesAAA}>
                                        AAA {passesAAA ? "Pass" : "Fail"}
                                    </span>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

/**
 * One live specimen per typography token, set at its real family/size/weight/line-height/letter-spacing.
 * Google-hosted web fonts are not loadable inside the admin editor (its CSP has no `style-src` allowance
 * for `fonts.googleapis.com`), so a family naming one renders its CSS fallback here — the hint below says
 * so rather than silently showing the wrong typeface as if it were right.
 *
 * `usedBy` (Puck "Component.field" strings, derived from `TOKEN_PROPS` — see `catalog.tsx`'s
 * `tokenKindUsers`) answers "which Puck components use this": every row below is a text style any of
 * those fields' dropdowns can select, which is otherwise not obvious from a flat token table. A custom
 * preview-text input lets an author see their own copy at each size/weight instead of only the fixed
 * sample line; leaving it blank keeps the sample.
 */
export function TypographySpecimen({ typography, usedBy }: { typography: Row[]; usedBy?: string[] }) {
    const rows = typography.filter((token) => (token.name ?? "").trim() !== "")
    const [sampleText, setSampleText] = useState("")
    if (rows.length === 0) return null
    const sample = sampleText.trim() !== "" ? sampleText : SAMPLE_LINE
    return (
        <div className="theme-preview__stack">
            {usedBy && usedBy.length > 0 && (
                <p className="theme-editor__hint">
                    Each row below is a text style a Puck component's typography field can select from —
                    currently used by {usedBy.join(", ")}.
                </p>
            )}
            <label className="theme-preview__text-input">
                Preview text
                <input
                    type="text"
                    value={sampleText}
                    placeholder={SAMPLE_LINE}
                    onChange={(event) => setSampleText(event.target.value)}
                />
            </label>
            {rows.map((token) => (
                <div key={token.name} className="theme-preview__specimen">
                    <span className="theme-preview__caption">{token.name}</span>
                    <p
                        className="theme-preview__specimen-sample"
                        style={{
                            fontFamily: tokenVar("typography", token.name, "family"),
                            fontSize: tokenVar("typography", token.name, "size"),
                            fontWeight: tokenVar("typography", token.name, "weight"),
                            lineHeight: tokenVar("typography", token.name, "line-height"),
                            letterSpacing: tokenVar("typography", token.name, "letter-spacing"),
                            fontStyle: tokenVar("typography", token.name, "style"),
                            textDecoration: tokenVar("typography", token.name, "decoration"),
                            textTransform: tokenVar("typography", token.name, "transform") as CSSProperties["textTransform"]
                        }}
                    >
                        {sample}
                    </p>
                </div>
            ))}
            <p className="theme-editor__hint">
                Web fonts (Google Fonts) can’t load inside this editor, so a family that names one shows its
                fallback typeface here. The real typeface appears on the published site.
            </p>
        </div>
    )
}

/**
 * A comparative bar per space token, all sharing one scale, so relative magnitude is visible at a glance
 * (a flat text value like "1.5rem" alone conveys no size). Each bar's width is `var(--dtk-space-<name>)`
 * itself — not a re-derived number — so it is exactly the length the token resolves to, in whatever unit
 * it is authored in (rem/px/%/vw/…). The track scrolls rather than clips, so an unusually large value
 * (e.g. a `%`/`vw` token) stays honest instead of being silently capped.
 */
export function SpacingScale({ space }: { space: Row[] }) {
    const rows = space.filter((token) => (token.name ?? "").trim() !== "" && (token.value ?? "").trim() !== "")
    if (rows.length === 0) return null
    return (
        <div className="theme-preview__scale">
            {rows.map((token) => (
                <div key={token.name} className="theme-preview__scale-row">
                    <span className="theme-preview__scale-label">{token.name}</span>
                    <span className="theme-preview__scale-track">
                        <span className="theme-preview__scale-bar" style={{ width: tokenVar("space", token.name) }} />
                    </span>
                    <span className="theme-preview__scale-value">{token.value}</span>
                </div>
            ))}
        </div>
    )
}

/** A small grid of boxes, each rounded by its radius token, against a visible fill so the curve reads. */
export function RadiusSwatches({ radius }: { radius: Row[] }) {
    const rows = radius.filter((token) => (token.name ?? "").trim() !== "" && (token.value ?? "").trim() !== "")
    if (rows.length === 0) return null
    return (
        <div className="theme-preview__grid theme-preview__grid--tight">
            {rows.map((token) => (
                <div key={token.name} className="theme-preview__box-card">
                    <span className="theme-preview__box" style={{ borderRadius: tokenVar("radius", token.name) }} />
                    <span className="theme-preview__caption">{token.name}</span>
                </div>
            ))}
        </div>
    )
}

/** A small grid of boxes, each cast with its shadow token, on a surface with enough contrast to show it. */
export function ShadowSwatches({ shadows }: { shadows: Row[] }) {
    const rows = shadows.filter((token) => (token.name ?? "").trim() !== "" && (token.value ?? "").trim() !== "")
    if (rows.length === 0) return null
    return (
        <div className="theme-preview__grid theme-preview__grid--tight theme-preview__grid--shadow">
            {rows.map((token) => (
                <div key={token.name} className="theme-preview__box-card">
                    <span className="theme-preview__box theme-preview__box--flat" style={{ boxShadow: tokenVar("shadows", token.name) }} />
                    <span className="theme-preview__caption">{token.name}</span>
                </div>
            ))}
        </div>
    )
}

/**
 * A small grid of boxes bordered by each border token, resolved through the same
 * `--dtk-border-<name>-{width,style,color}` properties `tokensToCss` emits (the `colorRef` indirection
 * included), so a dangling `colorRef` shows here exactly as it would on the site: an unset border color.
 */
export function BorderSwatches({ borders }: { borders: Row[] }) {
    const rows = borders.filter((token) => (token.name ?? "").trim() !== "")
    if (rows.length === 0) return null
    return (
        <div className="theme-preview__grid theme-preview__grid--tight">
            {rows.map((token) => (
                <div key={token.name} className="theme-preview__box-card">
                    <span
                        className="theme-preview__box theme-preview__box--flat"
                        style={{
                            borderWidth: tokenVar("borders", token.name, "width"),
                            borderStyle: tokenVar("borders", token.name, "style"),
                            borderColor: tokenVar("borders", token.name, "color")
                        }}
                    />
                    <span className="theme-preview__caption">
                        {token.name} → {token.colorRef || "—"}
                    </span>
                </div>
            ))}
        </div>
    )
}

/**
 * A comparative bar per breakpoint, same idea as `SpacingScale` but using the raw stored `minWidth`
 * directly — breakpoints are never emitted as `--dtk-*` custom properties (`tokens.ts`: custom properties
 * can't appear in `@media` conditions), so there is no token var to resolve here; the one real consumer
 * (`Columns`' stack point, via `columnsStackBreakpointCss`) reads the designated breakpoint's value
 * directly at CSS-generation time instead. `activeName` (the editor's "Columns stacks below" selection,
 * `ThemeEditor.tsx`) is highlighted; the rest remain documentary.
 */
export function BreakpointScale({ breakpoints, activeName }: { breakpoints: Row[]; activeName?: string }) {
    const rows = breakpoints.filter((token) => (token.name ?? "").trim() !== "" && (token.minWidth ?? "").trim() !== "")
    if (rows.length === 0) return null
    return (
        <div className="theme-preview__stack">
            <p className="theme-editor__hint">
                {activeName
                    ? `"${activeName}" drives Columns' single-column stacking point; the other breakpoints below are documentary.`
                    : "None of these drive Columns' stacking yet (set “Columns stacks below” above) — it stacks below a fixed 768px."}
            </p>
            <div className="theme-preview__scale">
                {rows.map((token) => (
                    <div key={token.name} className="theme-preview__scale-row" data-active={token.name === activeName || undefined}>
                        <span className="theme-preview__scale-label">{token.name}</span>
                        <span className="theme-preview__scale-track theme-preview__scale-track--wide">
                            <span className="theme-preview__scale-bar" style={{ width: token.minWidth }} />
                        </span>
                        <span className="theme-preview__scale-value">{token.minWidth}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

/** Preset container widths offered by `ResponsivePreviewFrame`; `null` means "no constraint" (full width). */
const PREVIEW_WIDTHS: ReadonlyArray<{ label: string; width: number | null }> = [
    { label: "Mobile", width: 375 },
    { label: "Tablet", width: 768 },
    { label: "Desktop", width: 1200 },
    { label: "Full", width: null }
]

/**
 * Wraps a preview specimen in a width-constrained container with preset-width buttons, so an author can
 * see a spacing/typography specimen at a few common widths without resizing the actual browser window.
 *
 * Deliberately honest about a real limit, not a bug: this resizes an inner `<div>`, not the browser's
 * viewport. `compositor.css`'s Columns breakpoint is a real `@media (max-width: 767.98px)` query, and any
 * `vw`-based token value is viewport-relative — neither responds to this container shrinking. Only a
 * `%`-based value would respond correctly here. The caption says so; resizing the real window is still the
 * only way to see the site's actual responsive behavior.
 */
export function ResponsivePreviewFrame({ children }: { children: ReactNode }) {
    const [width, setWidth] = useState<number | null>(null)
    return (
        <div className="theme-preview__width-wrap">
            <div className="theme-preview__width-controls" role="group" aria-label="Preview container width">
                {PREVIEW_WIDTHS.map((preset) => (
                    <button
                        key={preset.label}
                        type="button"
                        aria-pressed={width === preset.width}
                        className="theme-preview__width-btn"
                        onClick={() => setWidth(preset.width)}
                    >
                        {preset.label}
                    </button>
                ))}
            </div>
            <div className="theme-preview__width-frame" style={{ width: width ?? undefined }}>
                {children}
            </div>
            <p className="theme-editor__hint">
                This resizes a container, not the real browser window — it only previews %-based values
                correctly. A vw-based value or the site's actual @media breakpoint (Columns stacks below
                768px) won't respond here; resize the real browser window to test those.
            </p>
        </div>
    )
}

/**
 * The real `Button` component rendered once per variant, labeled with the variant's own name — pixel-
 * identical to how a page's Button renders that variant, via the same exported `renderButtonTag`.
 * `href="#"` never actually navigates: the wrapper swallows the click.
 */
export function ButtonVariantSamples({ variants }: { variants: Row[] }) {
    const rows = variants.filter((token) => (token.name ?? "").trim() !== "")
    if (rows.length === 0) return null
    return (
        <div className="theme-preview__button-row">
            {rows.map((token) => (
                <span key={token.name} className="theme-preview__button-sample" onClick={(event) => event.preventDefault()}>
                    {renderButtonTag(token.name, "#", token.name)}
                </span>
            ))}
        </div>
    )
}
