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
 * Two deliberately honest limits, not bugs:
 *  - Typography tokens carry no color (see `tokens.ts` — `TypographyToken` has no color field); text
 *    color is always inherited from the page, never a `--dtk-*` value. `ColorReference` demonstrates
 *    exactly that — inherited text rendered over each color swatch — rather than implying a color→
 *    typography binding that does not exist in the schema.
 *  - Breakpoint tokens are NOT wired into any component's responsive behavior (`compositor.css`'s
 *    `.cmp-columns` hardcodes 768px, since custom properties cannot appear in `@media` conditions).
 *    `BreakpointScale` is a labeled magnitude comparison, not a working responsive preview, and says so.
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

import { renderButtonTag } from "../../lib/compositor/catalog"
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
 * Colors, in context: each swatch is the color as a background with inherited page text laid over it —
 * the same pairing a themed `Section` produces. This is the honest answer to "how do colors reach
 * typography": they don't, as a token-to-token binding (typography tokens carry no color, `tokens.ts`).
 * Whatever contrast you see here — good or bad — is exactly what visiting the site would show.
 */
export function ColorReference({ colors }: { colors: Row[] }) {
    const rows = colors.filter((color) => (color.name ?? "").trim() !== "" && (color.value ?? "").trim() !== "")
    if (rows.length === 0) return null
    return (
        <div className="theme-preview__grid">
            {rows.map((color) => (
                <div key={color.name} className="theme-preview__swatch-card">
                    <div className="theme-preview__swatch-face" style={{ background: tokenVar("colors", color.name) }}>
                        <span className="theme-preview__swatch-heading">Aa</span>
                        <p className="theme-preview__swatch-body">{SAMPLE_LINE}</p>
                    </div>
                    <span className="theme-preview__caption">{color.name}</span>
                </div>
            ))}
        </div>
    )
}

/**
 * One live specimen per typography token, set at its real family/size/weight/line-height/letter-spacing.
 * Google-hosted web fonts are not loadable inside the admin editor (its CSP has no `style-src` allowance
 * for `fonts.googleapis.com`), so a family naming one renders its CSS fallback here — the hint below says
 * so rather than silently showing the wrong typeface as if it were right.
 */
export function TypographySpecimen({ typography }: { typography: Row[] }) {
    const rows = typography.filter((token) => (token.name ?? "").trim() !== "")
    if (rows.length === 0) return null
    return (
        <div className="theme-preview__stack">
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
                            letterSpacing: tokenVar("typography", token.name, "letter-spacing")
                        }}
                    >
                        {SAMPLE_LINE}
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
 * can't appear in `@media` conditions), so there is no token var to resolve here. The hint makes explicit
 * that these values are documentary: no component currently reflows at them.
 */
export function BreakpointScale({ breakpoints }: { breakpoints: Row[] }) {
    const rows = breakpoints.filter((token) => (token.name ?? "").trim() !== "" && (token.minWidth ?? "").trim() !== "")
    if (rows.length === 0) return null
    return (
        <div className="theme-preview__stack">
            <div className="theme-preview__scale">
                {rows.map((token) => (
                    <div key={token.name} className="theme-preview__scale-row">
                        <span className="theme-preview__scale-label">{token.name}</span>
                        <span className="theme-preview__scale-track theme-preview__scale-track--wide">
                            <span className="theme-preview__scale-bar" style={{ width: token.minWidth }} />
                        </span>
                        <span className="theme-preview__scale-value">{token.minWidth}</span>
                    </div>
                ))}
            </div>
            <p className="theme-editor__hint">
                These values are documentary only — no design-page component currently reflows at them (the
                Columns component always stacks below a fixed 768px, not the breakpoints listed here).
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
