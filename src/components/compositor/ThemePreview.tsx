/**
 * components/compositor/ThemePreview.tsx
 *
 * Live, per-section previews for the theme editor (`ThemeEditor.tsx`): small focused specimens, not one
 * master canvas — answers what a spacing value actually looks like, what a color/text pairing looks like,
 * neither obvious from a flat token table. Every specimen resolves through `tokenVar`/`tokenVarName`
 * (`lib/compositor/tokens.ts`) exactly as real components do (`catalog.tsx`) — same `--dtk-*` custom
 * properties `tokensToCss` emits, never a hand-rolled approximation that could drift from the published
 * site. The caller (`ThemeEditor.tsx`) injects that `:root { --dtk-*: … }` block plus `compositor.css`
 * once, live, from its in-progress unsaved state — a preview reflects the current edit, not the last save.
 *
 * Button variants reuse `renderButtonTag`, typography-adjacent headings could reuse `renderHeadingTag`
 * (both exported from `catalog.tsx`) instead of duplicating their JSX — same no-drift reason.
 *
 * Honest limit, not a bug: breakpoint tokens aren't wired into any component's responsive behavior
 * (`compositor.css`'s `.cmp-columns` hardcodes 768px — custom properties can't appear in `@media`
 * conditions). `BreakpointScale` is a labeled magnitude comparison, not a working responsive preview, and
 * says so.
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
 * One editable token row — same generic (kind → bag of string fields) shape `ThemeEditor.tsx` edits
 * every kind in. Every field read defensively (`row.x ?? ""`), matching that file's `toEditable`/
 * `toCatalog`, instead of a per-kind interface.
 */
type Row = Record<string, string>

/** A short, realistic sample line — not lorem ipsum — so a specimen reads like real site copy. */
const SAMPLE_LINE = "Handcrafted violins, violas, and cellos — sales, restoration, and setup."

/**
 * Colors, in context: each swatch is the color as a background with sample text laid over it. Typography
 * tokens carry no color (`tokens.ts`'s `TypographyToken` has no color field) — no real background→text
 * binding to reproduce, so swatch text is set to whichever of black/white gives better WCAG contrast
 * against the swatch's own resolved value (`bestTextColorFor`, `theme-controls.ts`) — locked to the
 * selected light/dark side, flipping away from that side's usual convention only when the author's color
 * demands it (e.g. an unusually light color on the dark channel). A color this module can't parse (named
 * color, `var()`, `oklch()`, …) falls back to the ambient inherited page text color rather than guessing.
 *
 * A color stored as `light-dark(L, D)` (adaptive scheme) resolves against the `color-scheme` CSS
 * property of the element or ancestor, not the OS/browser preference once an element declares its own —
 * so the Light/Dark toggle is pure CSS: flip local state, set `style={{ colorScheme: mode }}` on the
 * wrapping div. Only shown for `colorScheme === "adaptive"`; in `"fixed"` mode there's no dark variant to
 * reveal, stored value used as-is.
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
                    // Resolve to the side being previewed (light-dark() pair split by mode, else value
                    // as-is) — contrast judged against what this swatch shows, not the pair's other side.
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
 * Site Chrome color roles this check measures, by name (each a `colors` token name, or `""` if unset) —
 * narrow slice of `ThemeEditor.tsx`'s `SiteChromeRow`, kept local so this module doesn't import that
 * editor-only type.
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
 * Foreground/background role pairings the public site frame actually renders together
 * (`styles/public-chrome.css`), checked by `SiteChromeContrastCheck`: body/link/link-hover text against
 * page background (`html body`, `main a`, `main a:hover`), muted nav/footer text against each of its two
 * backgrounds. Real rendered pairings only, not every combination — e.g. not muted-text-on-page-
 * background's hover state, which repaints as body text (already covered above), not a new color.
 */
const CONTRAST_TARGETS: ReadonlyArray<{ id: string; label: string; fg: keyof ChromeColorRoles; bg: keyof ChromeColorRoles }> = [
    { id: "body", label: "Body text on page background", fg: "bodyText", bg: "pageBackground" },
    { id: "link", label: "Link color on page background", fg: "linkColor", bg: "pageBackground" },
    { id: "link-hover", label: "Link hover color on page background", fg: "linkHoverColor", bg: "pageBackground" },
    { id: "nav", label: "Muted text (nav links) on page background", fg: "mutedText", bg: "pageBackground" },
    { id: "footer", label: "Muted text (footer links/copy) on footer background", fg: "mutedText", bg: "footerBackground" }
]

/** One color role resolved to what it renders: raw CSS string (post light/dark split, for the swatch's
 *  inline style) plus parsed RGB (for contrast math) — either may be null independently, since a browser
 *  can render a color (named color, `var()`, `oklch()`, …) this module's parser can't measure. */
interface ResolvedChromeColor {
    value: string | null
    rgb: RgbColor | null
}

/** Unresolved/unset color — a pairing with an empty role name still renders ("not assigned") instead of
 *  silently vanishing. */
const UNRESOLVED_CHROME_COLOR: ResolvedChromeColor = { value: null, rgb: null }

/**
 * Resolves a Site Chrome role's token name to what it renders, split to the given light/dark mode — same
 * as `ColorReference`'s swatches ("resolve to the side being previewed"). Contrast check always measures
 * the shown mode, not the pair's other side.
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

/** Why a pairing has no ratio: distinguishes an unset/dangling role (fixable from the Site Chrome table
 *  above) from an unparseable color format (not fixable here). */
function unresolvedReason(fgName: string, bgName: string, fg: ResolvedChromeColor, bg: ResolvedChromeColor): string {
    if (!fgName || !bgName) return "Assign both roles above to check this pairing."
    if (fg.value === null || bg.value === null) return "One of the assigned tokens no longer exists."
    return "This color's format (e.g. a named color or var()) can't be measured here."
}

/**
 * WCAG AA/AAA contrast for every fg/bg pairing the Site Chrome roles actually render together on the
 * public site (`CONTRAST_TARGETS`), each with a live swatch on its real background. Reuses
 * `ColorReference`'s Light/Dark toggle — an adaptive pairing can pass one mode and fail the other, both
 * checkable one at a time. Unset role, dangling token, or unparseable color format shows why instead of
 * a ratio — never a guessed pass/fail.
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
 * Google-hosted web fonts don't load inside the admin editor (CSP has no `style-src` for
 * `fonts.googleapis.com`) — a family naming one renders its CSS fallback here, hint below says so rather
 * than silently showing the wrong typeface.
 *
 * `usedBy` (Puck "Component.field" strings, from `TOKEN_PROPS` — see `catalog.tsx`'s `tokenKindUsers`)
 * answers "which Puck components use this" — not obvious from a flat token table. Custom preview-text
 * input lets an author see their own copy at each size/weight; blank keeps the sample line.
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
 * Comparative bar per space token, one shared scale — relative magnitude visible at a glance (a flat
 * "1.5rem" alone conveys no size). Bar width is `var(--dtk-space-<name>)` itself, not re-derived —
 * exactly what the token resolves to, in its authored unit (rem/px/%/vw/…). Track scrolls rather than
 * clips, so an unusually large value (`%`/`vw` token) stays honest instead of silently capped.
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

/** Grid of boxes, each rounded by its radius token, against a visible fill so the curve reads. */
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

/** Grid of boxes, each cast with its shadow token, on a surface with enough contrast to show it. */
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
 * Grid of boxes bordered by each border token, resolved through the same
 * `--dtk-border-<name>-{width,style,color}` properties `tokensToCss` emits (`colorRef` indirection
 * included) — a dangling `colorRef` shows here exactly as on the site: an unset border color.
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
 * Comparative bar per breakpoint, same idea as `SpacingScale` but using the raw stored `minWidth`
 * directly — breakpoints are never emitted as `--dtk-*` custom properties (can't appear in `@media`
 * conditions), so no token var to resolve; the one real consumer (`Columns`' stack point, via
 * `columnsStackBreakpointCss`) reads the value directly at CSS-generation time. `activeName` (editor's
 * "Columns stacks below" selection) is highlighted, rest stay documentary.
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
 * Wraps a preview specimen in a width-constrained container with preset-width buttons — an author sees a
 * specimen at common widths without resizing the browser window.
 *
 * Honest limit, not a bug: resizes an inner `<div>`, not the viewport. `compositor.css`'s Columns
 * breakpoint is a real `@media (max-width: 767.98px)` query, and any `vw`-based token is viewport-
 * relative — neither responds to this container shrinking. Only a `%`-based value responds correctly.
 * Caption says so; resizing the real window is the only way to see actual responsive behavior.
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
 * Real `Button` component rendered once per variant, labeled with the variant's name — pixel-identical
 * to a page's Button via the same exported `renderButtonTag`. `href="#"` never navigates: wrapper
 * swallows the click.
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
