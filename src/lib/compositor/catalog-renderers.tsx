/**
 * lib/compositor/catalog-renderers.tsx
 *
 * The markup bodies the catalog renders, and the entity-value formatting they consume
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

/** Where a `ContentField`'s value sits relative to its label. */
export type ValuePlacement = "inline" | "below" | "auto"

/** Casts a token-var map to CSSProperties (React types omit custom-property keys). */
export function vars(map: Record<string, string | number>): CSSProperties {
    return map as CSSProperties
}

/** Optional radius/border/shadow local `--cmp-<prefix>-*` vars for a frame-styled container */
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

/** Fixed rendered-size preset for `Image`/`ContentImage`/`MediaText`: NOT a theme token */
export type ImageSizePreset = "small" | "medium" | "large" | "full"

/** The `--cmp-heading-*` local vars driven by a `typography` token, shared by every element that carries
 *  the `.cmp-heading` class */
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

/** Excludes heading tags from indexing */
export function renderHeadingTag(text: string, level: "h1" | "h2" | "h3" | "h4", typography: string, align: string) {
    const Tag = level
    return (
        <Tag className="cmp-heading" data-pagefind-ignore="all" style={vars(headingStyleVars(typography, align))}>
            {text}
        </Tag>
    )
}

/** The `sizes` attribute hint for each `ImageSizePreset` */
const IMAGE_SIZE_HINTS: Record<ImageSizePreset, string> = {
    small: "192px",
    medium: "384px",
    large: "640px",
    full: "100vw"
}

/** The Image markup, shared by `Image` (picked media) and `ContentImage` (entry-fed image field) */
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
 * button variant with the exact same class/var wiring as the real component, never a hand-rolled copy */
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
                "--cmp-button-hover-brightness": tokenVar("buttonVariants", variant, "hover-brightness"),
                ...(shadow ? { "--cmp-button-shadow": tokenVar("shadows", shadow) } : {})
            })}
        >
            {label}
        </a>
    )
}

/** `RelatedEntries`' default `limit`, and the fallback used when an authored `limit` isn't a positive
 *  finite number (e.g. cleared in the editor) */
export const DEFAULT_RELATED_LIMIT = 6

/** Illustrative canvas-only tiles, shown when there is no route context at all (mirrors
 *  `Breadcrumbs`' fallback trail) - `href: null` so they render as plain, non-navigating tiles */
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

/** The `RelatedEntries` tile grid: works related to the routed record, sliced to `limit` */
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
                <h2
                    className="cmp-related__heading cmp-heading"
                    data-pagefind-ignore="all"
                    style={vars(headingStyleVars(typography))}
                >
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
// through these two generic, collection-agnostic outlets - no per-noun render code lives here

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

/** 
 * One resolved reference: linked to its public page when it has one, plain text otherwise
 */
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
 *  parentheses after its name */
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

/** 
 * The composition publication-uri composite (`{ uriType, uri }`) `entity-records.ts` synthesizes
 */
function PublicationUriValue({ value }: { value: ResolvedReferenceLike & { uriType?: unknown; uri?: unknown } }) {
    const uriType = typeof value.uriType === "string" ? value.uriType : null
    const uri = typeof value.uri === "string" ? value.uri : null
    return <span dangerouslySetInnerHTML={{ __html: renderPublicationUri(uriType, uri, "") }} />
}

/**
 * A composer/composition's citations map, rendered as comma-separated hyperlinks (see citations.ts)
 */
function CitationsValue({ value }: { value: Record<string, unknown> }) {
    const citations: Record<string, string> = {}
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === "string") citations[key] = entry
    }
    return <span dangerouslySetInnerHTML={{ __html: renderCitationsList(citations, "") }} />
}

/** 
 * Long-form date formatting for `entry_date`/`change_date`
 */
const ENTITY_DATE_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" })

/**
 * The `.cmp-field` modifier for a `ContentField`'s `valuePlacement`, or "" for the inline default 
 */
export function fieldPlacementClass(placement: ValuePlacement | undefined): string {
    if (placement === "below") return " cmp-field--below"
    if (placement === "auto") return " cmp-field--auto"
    return ""
}

/** 
 * Kinds whose value is injected HTML carrying its own anchors
 */
export function rendersOwnAnchors(value: unknown, kind: string | undefined): boolean {
    if (kind === "uri" || kind === "citations") return true
    return kind === undefined && isRecord(value) && ("uriType" in value || "uri" in value)
}

/** Formats a resolved entity-field value for display, kind-aware when `kind` (`EntityField.type`) is
 * known, falling back to shape-based inference otherwise */
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
            // Shape-based fallback - no catalog kind available for this field (see header).
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
