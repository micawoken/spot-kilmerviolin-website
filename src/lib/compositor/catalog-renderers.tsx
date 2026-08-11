/**
 * lib/compositor/catalog-renderers.tsx
 *
 * The markup bodies the catalog renders, and the entity-value formatting they consume. Split out of
 * catalog.tsx, which keeps the Puck config itself — field definitions, defaultProps, render wiring.
 *
 * The outlets are thin content-fed twins of existing components (pivot §4): same markup, same classes,
 * same token wiring — only where the value comes from differs. One render body each is what keeps them
 * twins, so those bodies belong together rather than beside the config that happens to call them.
 * `renderButtonTag` was already reused outside the catalog, by the theme editor's live preview
 * (ThemePreview.tsx); cross-file reuse out of a config builder is what signalled this seam.
 *
 * `vars`, `frameStyleVars`, `ImageSizePreset` and `DEFAULT_RELATED_LIMIT` live here and are imported
 * back by catalog.tsx: each describes rendered output, and the config only forwards it.
 *
 * Everything here obeys the catalog purity rule — no hooks, no state, no browser APIs, no fetching.
 * The one field render that needs those is the media picker (catalog-media-picker.tsx).
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

import type { CSSProperties, ReactNode } from "react"

import { tokenVar } from "./tokens"
import { opensInNewTab, sanitizeHref } from "./richtext"
import { isRecord } from "./types"
import { renderPublicationUri } from "../../scripts/publication"
import { renderCitationsList } from "../../scripts/citations"
import { countryCodeName, formatDeathYear, titleCaseRole } from "../../scripts/format"
import type { RelatedWork } from "../build/entity-records"

/** Where a `ContentField`'s value sits relative to its label. Declared here, with the render that acts
 *  on it, so `fieldPlacementClass` does not have to reach back into catalog.tsx's prop interfaces. */
export type ValuePlacement = "inline" | "below" | "auto"

/** Casts a token-var map to CSSProperties (React types omit custom-property keys). */
export function vars(map: Record<string, string | number>): CSSProperties {
    return map as CSSProperties
}

/** Optional radius/border/shadow local `--cmp-<prefix>-*` vars for a frame-styled container (Section,
 * Image/ContentImage, MediaText's media side). Skipped when its token name is "" (None), so
 * `compositor.css`'s own fallback (no rounding/border/shadow) applies. */
export function frameStyleVars(prefix: string, radius: string, border: string, shadow: string): Record<string, string> {
    const result: Record<string, string> = {}
    if (radius) result[`--cmp-${prefix}-radius`] = tokenVar("radius", radius)
    if (border) {
        result[`--cmp-${prefix}-border-width`] = tokenVar("borders", border, "width")
        result[`--cmp-${prefix}-border-style`] = tokenVar("borders", border, "style")
        result[`--cmp-${prefix}-border-color`] = tokenVar("borders", border, "color")
    }
    if (shadow) result[`--cmp-${prefix}-shadow`] = tokenVar("shadows", shadow)
    return result
}

/** Fixed rendered-size preset for `Image`/`ContentImage`/`MediaText`: NOT a theme token — a
 * per-placement layout choice, reuses the fixed-enum-select pattern `aspect` already uses rather than
 * a new `TokenKind`. "full" is `Image`/`ContentImage`'s pre-existing unstyled default, "medium" is
 * `MediaText`'s pre-existing fixed flex-basis — each `defaultProps` preserves its own old behavior. */
export type ImageSizePreset = "small" | "medium" | "large" | "full"

/** The `--cmp-heading-*` local vars driven by a `typography` token, shared by every element that carries
 *  the `.cmp-heading` class — `renderHeadingTag` below and `RelatedEntries`' own `<h2>`. `align` defaults
 *  to "start", `.cmp-heading`'s own CSS fallback, so a caller that doesn't expose alignment (RelatedEntries)
 *  can omit it without changing the rendered result. */
function headingStyleVars(typography: string, align: string = "start"): Record<string, string> {
    return {
        "--cmp-heading-family": tokenVar("typography", typography, "family"),
        "--cmp-heading-size": tokenVar("typography", typography, "size"),
        "--cmp-heading-weight": tokenVar("typography", typography, "weight"),
        "--cmp-heading-line-height": tokenVar("typography", typography, "line-height"),
        "--cmp-heading-letter-spacing": tokenVar("typography", typography, "letter-spacing"),
        "--cmp-heading-style": tokenVar("typography", typography, "style"),
        "--cmp-heading-decoration": tokenVar("typography", typography, "decoration"),
        "--cmp-heading-transform": tokenVar("typography", typography, "transform"),
        "--cmp-heading-align": align
    }
}

/** The Heading markup, shared by `Heading` (inline text) and `ContentText` (entry-fed text). Exported,
 * though not currently imported elsewhere — `renderButtonTag` below is the one actually reused by the
 * theme editor's live preview (`ThemePreview.tsx`). */
export function renderHeadingTag(text: string, level: "h1" | "h2" | "h3" | "h4", typography: string, align: string) {
    const Tag = level
    return (
        <Tag className="cmp-heading" style={vars(headingStyleVars(typography, align))}>
            {text}
        </Tag>
    )
}

/** The `sizes` attribute hint for each `ImageSizePreset`, mirroring compositor.css's
 * `.cmp-image[data-size]` max-width caps (12/24/40rem at the standard 16px root, small/medium/large) —
 * a rendered image is never wider than its preset's cap, so the browser's `srcset` selection can pick
 * the smallest candidate that still covers it instead of defaulting to the largest. "full" has no cap
 * (max-width: 100%), so its hint stays viewport-relative. Approximate by nature — `sizes` is a layout
 * hint, not a guarantee — and deliberately not themed: a custom root font size would only make the
 * browser fetch a slightly larger/smaller candidate than ideal, never a broken one. */
const IMAGE_SIZE_HINTS: Record<ImageSizePreset, string> = {
    small: "192px",
    medium: "384px",
    large: "640px",
    full: "100vw"
}

/** The Image markup, shared by `Image` (picked media) and `ContentImage` (entry-fed image field). Not
 * used by `MediaText`'s media side — its rendered size comes from its flex container, not the `<img>`
 * itself (see `.cmp-media-text__media` in compositor.css), so `size` drives `data-size` there instead.
 *
 * `priority` opts an above-the-fold image (typically at most one per page) into `fetchPriority="high"` +
 * `loading="eager"` — Lighthouse flagged every compositor image as loading with no fetch-priority signal
 * at all, so the browser's heuristic guess was the only thing ever prioritizing a hero image over
 * everything else competing for bandwidth. `false` (the default) renders neither attribute, byte-for-byte
 * the pre-existing markup — this only ever adds a priority hint, never removes the browser's own default
 * (eager) loading behavior for the common case.
 *
 * `sizes` is always emitted (from `IMAGE_SIZE_HINTS`) — inert on its own (the browser ignores `sizes`
 * without a matching `srcset`), but it is the attribute the build-time responsive-image integration
 * (optimize-emdash-media.mjs) looks for when deciding whether/how to inject a `srcset` of width variants
 * into the already-rendered HTML, since a per-request build has no direct hook into this render path
 * (see that file's header for why it operates as a post-build HTML pass). Emitting it here, unconditionally,
 * means the two stay in sync without either module needing to duplicate the `ImageSizePreset` → width
 * mapping. */
export function renderImageTag(
    url: string,
    alt: string,
    width: number | undefined,
    height: number | undefined,
    aspect: string,
    size: ImageSizePreset,
    radius: string,
    border: string,
    shadow: string,
    priority: boolean
) {
    return (
        <img
            className="cmp-image"
            data-aspect={aspect}
            data-size={size}
            src={url}
            sizes={IMAGE_SIZE_HINTS[size]}
            alt={alt}
            width={width}
            height={height}
            {...(priority ? { fetchPriority: "high" as const, loading: "eager" as const } : {})}
            style={vars(frameStyleVars("image", radius, border, shadow))}
        />
    )
}

/** The Button markup. Exported so the theme editor's live preview (`ThemePreview.tsx`) renders a
 * button variant with the exact same class/var wiring as the real component, never a hand-rolled copy. */
export function renderButtonTag(label: string, href: string, variant: string, shadow = "", target = "") {
    const safeHref = sanitizeHref(href)
    const newTab = opensInNewTab(safeHref, target)
    return (
        <a
            className="cmp-button"
            href={safeHref}
            target={newTab ? "_blank" : undefined}
            rel={newTab ? "noopener noreferrer" : undefined}
            style={vars({
                "--cmp-button-bg": tokenVar("buttonVariants", variant, "bg"),
                "--cmp-button-text": tokenVar("buttonVariants", variant, "text"),
                "--cmp-button-radius": tokenVar("buttonVariants", variant, "radius"),
                "--cmp-button-pad-x": tokenVar("buttonVariants", variant, "pad-x"),
                "--cmp-button-pad-y": tokenVar("buttonVariants", variant, "pad-y"),
                "--cmp-button-border-width": tokenVar("buttonVariants", variant, "border-width"),
                "--cmp-button-border-style": tokenVar("buttonVariants", variant, "border-style"),
                "--cmp-button-border-color": tokenVar("buttonVariants", variant, "border-color"),
                ...(shadow ? { "--cmp-button-shadow": tokenVar("shadows", shadow) } : {})
            })}
        >
            {label}
        </a>
    )
}

/** `RelatedEntries`' default `limit`, and the fallback used when an authored `limit` isn't a positive
 *  finite number (e.g. cleared in the editor). */
export const DEFAULT_RELATED_LIMIT = 6

/** Illustrative canvas-only tiles, shown when there is no route context at all (mirrors
 *  `Breadcrumbs`' fallback trail) — `href: null` so they render as plain, non-navigating tiles. */
const ILLUSTRATIVE_RELATED_WORKS: RelatedWork[] = [
    { id: -1, name: "Example Work", href: null, composer: "Example Composer" },
    { id: -2, name: "Another Example Work", href: null, composer: "Example Composer" }
]

function RelatedWorkTileBody({ work }: { work: RelatedWork }) {
    return (
        <>
            <span className="cmp-related__name">{work.name}</span>
            {work.composer && <span className="cmp-related__sub">{work.composer}</span>}
        </>
    )
}

/** The `RelatedEntries` tile grid: works related to the routed record, sliced to `limit`. With no
 * route context (editor previewing a template, not a fixed record), illustrative tiles stand in. On
 * build, `entries` is always defined — an empty list renders nothing, same auto-omit as the outlets.
 *
 * `typography` is a `typography` token name, or "" for the pre-existing unstyled (browser default `h2`)
 * look — defaults to "" here, not just in `defaultProps`, so a design saved before this field existed
 * (whose stored props lack it entirely) renders byte-for-byte as before. */
export function renderRelatedEntriesTag(
    entries: RelatedWork[] | undefined,
    heading: string,
    limit: number,
    isEditorPreview: boolean,
    typography: string = ""
) {
    const isIllustrative = entries === undefined && isEditorPreview
    const source = isIllustrative ? ILLUSTRATIVE_RELATED_WORKS : entries
    if (!source || source.length === 0) return null // pages/posts template, or a record with no related works

    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_RELATED_LIMIT
    const tiles = source.slice(0, safeLimit)

    return (
        <div className="cmp-related">
            {heading && (
                <h2 className="cmp-related__heading cmp-heading" style={vars(headingStyleVars(typography))}>
                    {heading}
                </h2>
            )}
            <ul className="cmp-related__grid">
                {tiles.map((work) => (
                    <li key={work.id}>
                        {work.href ? (
                            <a className="cmp-related__tile" href={work.href}>
                                <RelatedWorkTileBody work={work} />
                            </a>
                        ) : (
                            <span className="cmp-related__tile">
                                <RelatedWorkTileBody work={work} />
                            </span>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    )
}

// --- ContentField / MediaText (unified field-outlet rewrite) ----------------------------------------
// Replaces the old dedicated CompositionDetail block: every entity field, of any kind, is bindable
// through these two generic, collection-agnostic outlets — no per-noun render code lives here.

/** A resolved foreign-key reference, as `entity-records.ts`'s normalizer attaches it to an entry. */
interface ResolvedReferenceLike {
    id?: unknown
    name?: unknown
    href?: unknown
    /** composer references only (see `ReferenceLinkListWithRole`) */
    role?: unknown
}

function isResolvedReferenceLike(value: unknown): value is ResolvedReferenceLike {
    return isRecord(value) && ("name" in value || "href" in value)
}

/** One resolved reference: linked to its public page when it has one, plain text otherwise (owner note:
 * an empty/unresolvable reference renders as an empty value, not a placeholder string). `plain` skips
 * the anchor even when `href` is present — used by `ContentField`'s forced link, which replaces this
 * kind's own anchor rather than nesting inside it. */
function ReferenceLink({ value, plain = false }: { value: ResolvedReferenceLike; plain?: boolean }) {
    const name = typeof value.name === "string" ? value.name.trim() : ""
    const href = typeof value.href === "string" ? value.href : null
    if (name === "") return null
    return href && !plain ? <a href={href}>{name}</a> : <>{name}</>
}

/** A comma-separated list of resolved references (see {@link ReferenceLink}). */
function ReferenceLinkList({ values, plain = false }: { values: unknown[]; plain?: boolean }) {
    const items = values.filter(isResolvedReferenceLike)
    if (items.length === 0) return null
    return (
        <>
            {items.map((item, index) => (
                <span key={index}>
                    {index > 0 ? ", " : ""}
                    <ReferenceLink value={item} plain={plain} />
                </span>
            ))}
        </>
    )
}

/** `ReferenceLinkList`, but each resolved composer also shows its `role` (e.g. "arranger") in
 *  parentheses after its name — `author_secondary` only (see `EntityFieldKind`'s "referenceListWithRole"
 *  doc in entity-fields.ts). Lower-cased (owner decision), unlike the composer's own `role` field, which
 *  title-cases for its standalone display. */
function ReferenceLinkListWithRole({ values, plain = false }: { values: unknown[]; plain?: boolean }) {
    const items = values.filter(isResolvedReferenceLike)
    if (items.length === 0) return null
    return (
        <>
            {items.map((item, index) => {
                const role = typeof item.role === "string" ? item.role.trim().toLowerCase() : ""
                return (
                    <span key={index}>
                        {index > 0 ? ", " : ""}
                        <ReferenceLink value={item} plain={plain} />
                        {role !== "" && <> ({role})</>}
                    </span>
                )
            })}
        </>
    )
}

/** The composition publication-uri composite (`{ uriType, uri }`) `entity-records.ts` synthesizes. */
function PublicationUriValue({ value }: { value: ResolvedReferenceLike & { uriType?: unknown; uri?: unknown } }) {
    const uriType = typeof value.uriType === "string" ? value.uriType : null
    const uri = typeof value.uri === "string" ? value.uri : null
    return <span dangerouslySetInnerHTML={{ __html: renderPublicationUri(uriType, uri, "") }} />
}

/** A composer/composition's citations map, rendered as comma-separated hyperlinks (see citations.ts). */
function CitationsValue({ value }: { value: Record<string, unknown> }) {
    const citations: Record<string, string> = {}
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === "string") citations[key] = entry
    }
    return <span dangerouslySetInnerHTML={{ __html: renderCitationsList(citations, "") }} />
}

/** Long-form date formatting for `entry_date`/`change_date` (fixed locale/options — build output must
 * be deterministic, never reads the reader's locale). `timeZone: "UTC"` is load-bearing: D1 stores
 * these as epoch-millisecond instants — formatting in the build machine's local timezone would shift
 * the displayed date/time depending on where the build runs. */
const ENTITY_DATE_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" })

/** The `.cmp-field` modifier for a `ContentField`'s `valuePlacement`, or "" for the inline default. Both
 * modifiers are defined in compositor.css (the "Value placement" rules) — the only place either one has
 * any effect, so the two must be renamed together.
 *
 * Matches by value rather than indexing a lookup so that anything else — undefined on a design stored
 * before the prop existed, or a hand-edited design doc carrying a stale value — falls back to inline
 * instead of emitting a dangling class name. */
export function fieldPlacementClass(placement: ValuePlacement | undefined): string {
    if (placement === "below") return " cmp-field--below"
    if (placement === "auto") return " cmp-field--auto"
    return ""
}

/** Kinds whose value is injected HTML carrying its own anchors (`renderPublicationUri`/
 *  `renderCitationsList`, via `dangerouslySetInnerHTML`) — `ContentField`'s forced link cannot wrap
 *  them without nesting an `<a>` inside one, so the option is inert there (lint flags it). A field with
 *  no declared kind falls through `formatFieldValue`'s shape-inference `default` branch, which only
 *  infers the `uri` shape — mirrored here so the inert check agrees with what actually renders. */
export function rendersOwnAnchors(value: unknown, kind: string | undefined): boolean {
    if (kind === "uri" || kind === "citations") return true
    return kind === undefined && isRecord(value) && ("uriType" in value || "uri" in value)
}

/** Formats a resolved entity-field value for display, kind-aware when `kind` (`EntityField.type`) is
 * known, falling back to shape-based inference otherwise (pages/posts fields, or a pre-schema editor
 * render). Owner decision: null/empty/unresolvable ALWAYS formats to an empty value, never a
 * placeholder string, so `ContentField` keeps rendering its row.
 *
 * `plain` renders a kind's value without its own anchor — for `ContentField`'s forced link, which
 * replaces that anchor rather than nesting inside it. The caller is expected to have already checked
 * {@link rendersOwnAnchors}; `plain` has no effect on `uri`/`citations`, whose anchors are baked into
 * injected HTML this function does not control. */
export function formatFieldValue(value: unknown, kind: string | undefined, plain = false): ReactNode {
    if (value === null || value === undefined) return ""

    switch (kind) {
        case "date": {
            if (typeof value !== "number") return ""
            const date = new Date(value)
            return Number.isNaN(date.getTime()) ? String(value) : ENTITY_DATE_FORMAT.format(date)
        }
        case "reference":
            return isResolvedReferenceLike(value) ? <ReferenceLink value={value} plain={plain} /> : ""
        case "referenceList":
            return Array.isArray(value) ? <ReferenceLinkList values={value} plain={plain} /> : ""
        case "referenceListWithRole":
            return Array.isArray(value) ? <ReferenceLinkListWithRole values={value} plain={plain} /> : ""
        case "uri":
            return isRecord(value) ? <PublicationUriValue value={value} /> : ""
        case "citations":
            return isRecord(value) ? <CitationsValue value={value} /> : ""
        case "list":
            return Array.isArray(value)
                ? value.filter((item) => item !== null && item !== undefined && item !== "").join(", ")
                : ""
        case "number":
            return typeof value === "number" ? String(value) : ""
        case "yearOrLiving":
            // A composer's death_year: -1 is the "still living" sentinel (mirrors ComposerInfo.astro).
            return typeof value === "number" ? formatDeathYear(value) : ""
        case "countryCode":
            // A composer's ISO 3166-1 alpha-2 country code, rendered as its English display name.
            return typeof value === "string" && value.trim() !== "" ? countryCodeName(value) : ""
        case "email":
            return typeof value === "string" && value.trim() !== "" ? (
                plain ? value : <a href={`mailto:${value}`}>{value}</a>
            ) : (
                ""
            )
        case "titleCase":
            return typeof value === "string" ? titleCaseRole(value) : ""
        case "string":
        case "text":
            return typeof value === "string" ? value : ""
        default: {
            // Shape-based fallback — no catalog kind available for this field (see header).
            if (typeof value === "string") return value
            if (typeof value === "number") return String(value)
            if (Array.isArray(value)) {
                if (value.length > 0 && value.every(isResolvedReferenceLike)) {
                    return <ReferenceLinkList values={value} plain={plain} />
                }
                return value.filter((item) => item !== null && item !== undefined && item !== "").join(", ")
            }
            if (isResolvedReferenceLike(value)) return <ReferenceLink value={value} plain={plain} />
            if (isRecord(value) && ("uriType" in value || "uri" in value)) return <PublicationUriValue value={value} />
            return ""
        }
    }
}
