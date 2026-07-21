/**
 * lib/compositor/catalog.tsx
 *
 * The single, frozen component catalog (impl §4.5 / §6.3). `buildConfig(theme, target, context?)` is a
 * factory — select options depend on the live theme, outlet renders on the routed entry (pivot D7) —
 * producing the Puck `Config` that drives BOTH the editor island and the static build renderer. Component render functions are pure (catalog purity rule,
 * §4.5): no hooks, no state, no browser APIs, no data fetching; every visual control stores a token
 * *name* resolved to `var(--dtk-…)` at render (decision 4), and all real styling lives in the
 * co-located `compositor.css` (class-per-component, consuming only `--dtk-*` and local `--cmp-*` vars).
 * Inline styles carry token-var lookups only — they map a chosen token into a local custom property
 * that `compositor.css` then applies. No freeform CSS is generated at render.
 *
 * Editor vs build target (deliberate deviation from "one config feeds both"): Puck's `useRichtextProps`
 * intercepts every `richtext`-typed field in the RSC render path as well as the editor, and its
 * renderer normalizes a stored Portable Text array to an *empty* ProseMirror doc — so a `richtext`
 * field would silently blank every design page at build. The build target therefore exposes RichText's
 * `body` as a plain passthrough field: the render receives the raw Portable Text array and routes it
 * through `richtext.tsx` for `pages`-parity output (§6.4). The editor target uses the real `richtext`
 * field (value is the ProseMirror working form produced by `convert.ts`) and Puck renders it natively.
 * `RichText.render` distinguishes the two by `Array.isArray(body)` (§6.3). The media picker is likewise
 * editor-only and attached only in the editor target, keeping its browser code off the build path.
 *
 * Button `variant` (Phase D): `variant` is a token select over the theme's `buttonVariants` (§4.3), each
 * a bundle of color/radius/space/border references (impl §6.3/§7.4's deferred item, delivered). The
 * render maps the chosen variant name into `--cmp-button-*` locals that `compositor.css` applies; no
 * variant styling is hardcoded. The theme is authored with its variants BEFORE this code deploys, so a
 * `Button.variant` never dangles at build (see plan-compositor-phase-d.md §2.1 trap B).
 *
 * Flow invariant (unified field-outlet rewrite): every content-bearing container (`Section`, a `Columns`
 * column, `Row`, the document root) lays its children out as a `flex-direction: column` stack by
 * default (`compositor.css`) — a component's own intrinsic display (e.g. `Button`'s `inline-block`)
 * never causes it to silently sit beside its sibling. The ONLY way to place components side by side is
 * the explicit `Row` container (or `Columns`, for a fixed grid). This closes the flow ambiguity the
 * editor canvas doesn't otherwise show: two components that look "stacked" in the component tree could
 * previously still render on the same line depending on their own CSS `display`.
 *
 * Unified field-outlet rewrite (entity prerendering redesign): the old per-noun split — composer/
 * contributor rendering through loose `ContentText`/`ContentImage` outlets, composition rendering
 * through one dedicated `CompositionDetail` block — is gone. Every entity field (see entity-fields.ts)
 * is now bindable through `ContentField` (an optionally-labeled value row, kind-aware: text, number,
 * date, a resolved reference/referenceList, a joined list, or the composition publication-uri
 * composite) or `ContentImage`/`MediaText` for images. Foreign-key fields are pre-resolved to
 * `{id, name, href}` by `entity-records.ts`'s normalizer before they ever reach a render — no
 * composition-specific code lives in this catalog anymore.
 *
 * Known canvas-vs-build diffs (accepted, §8): canvas shows unoptimized R2 originals (identical URL in
 * Phase 1); site chrome (header/footer) is absent in the canvas; fonts may load differently.
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
import type { ComponentType, CSSProperties, ReactNode } from "react"
import type { Config, CustomFieldRender } from "@puckeditor/core"
import type { PortableTextBlock } from "emdash"

import { isEmptyFieldValue } from "./entity-fields"
import { RichTextView, sanitizeHref } from "./richtext"
import { tokenSelectOptions, tokenVar, type TokenCatalog, type TokenKind, type TokenPropRegistry } from "./tokens"
import { isRecord } from "./types"
import {
    isSafeStorageKey,
    mediaSource,
    proxyFileUrl,
    proxyMediaUrl,
    publicFileUrl,
    publicMediaUrl,
    type MediaSource
} from "./media"
// scripts/publication.ts is framework-agnostic (only imports ./escape) and returns markup-safe HTML
// (every value escapeHtml-encoded); ContentField's "uri" kind reuses it for the composition publication
// link, the one composite field this catalog still knows the shape of. Safe to import into both the
// editor (browser) and build (Node) targets.
import { renderPublicationUri } from "../../scripts/publication"
// scripts/citations.ts is likewise framework-agnostic (only imports ./escape and lib/api/validation, which
// itself carries no server-only bindings) — ContentField's "citations" kind reuses it so the public render
// matches the admin Info cards' rendering exactly.
import { renderCitationsList } from "../../scripts/citations"
// scripts/format.ts is likewise framework-agnostic (only Intl + a consts import) — reused here so the
// composer death_year/country special cases render identically to the admin's ComposerInfo.astro/
// format.ts treatment, rather than a second hand-written copy of the same "-1 => Present" / code=>name logic.
import { countryCodeName, formatDeathYear, titleCaseRole } from "../../scripts/format"
// Type-only: erased at compile, so the editor bundle never pulls in the build-side reader module.
import type { CollectionField } from "../build/design-api"
// Same type-only split as CollectionField above — RelatedEntries reads this from context, never imports
// entity-records.ts's build-side functions.
import type { RelatedWork } from "../build/entity-records"

/** Which config a `buildConfig` call produces: the editor island's or the static build renderer's. */
export type CatalogTarget = "editor" | "build"

/**
 * The per-entry context a config is built against (pivot D7). `entry` is the routed content entry's
 * raw field record — outlet renders read `entry[field]` from this closure; null/absent means there is
 * no entry (a `design_page`, or the template editor before a preview entry is picked). `fields` is the
 * template's collection schema — populated for the editor's outlet field pickers, and (for entity
 * templates) also at BUILD time, since `ContentField` uses each field's declared kind (date formatting,
 * the default label) when rendering, not just when building picker options.
 */
export interface BuildConfigContext {
    entry?: Record<string, unknown> | null
    fields?: CollectionField[]
    /**
     * The public media origin (`EMDASH_MEDIA_PUBLIC_URL`), required on the **build** target whenever a
     * design renders media: a prerendered page is served to anonymous visitors, and the `/_emdash` media
     * proxy sits behind Cloudflare Access (see `media.ts`). The editor target ignores it and uses the
     * proxy, which is correct for an authenticated admin.
     */
    mediaBaseUrl?: string
    /**
     * The public origin for our own R2_FILES uploads (`FILES_PUBLIC_URL`), required on the **build**
     * target whenever a design renders a D1 entity's `image` field pointing at an `/api/v1/files/{key}`
     * upload: that route requires an authenticated identity in production, same gap `mediaBaseUrl`
     * closes for EmDash media (see `media.ts`'s `publicFileUrl`).
     */
    filesBaseUrl?: string
    /**
     * The current route's breadcrumb trail (docs/dev/miscellaneous.txt), split the same way as `entry`:
     * `breadcrumbs` is the *ancestor* crumbs only (Home is implicit — the `Breadcrumbs` component always
     * prepends it), and `pageTitle` is the current page's own display title — the trail's final, unlinked
     * crumb. Both are computed once per route at the page level (`route-authority.ts`'s
     * `breadcrumbAncestors`, or the noun's own index link for an entity page) — catalog.tsx has no access
     * to the full published route set needed to derive this itself. Absent in the editor (a template has
     * no single fixed route) and the `Breadcrumbs` render falls back to an illustrative preview.
     */
    breadcrumbs?: { label: string; href: string | null }[]
    pageTitle?: string
    /**
     * Bundled (src/files) image alt text, keyed by the /files/<key> suffix (lib/build/bundled-file-alt.ts's
     * loadBundledFileAlt) — resolves real alt text for a plain-string entity `image` field that points
     * at a bundled asset. R2-uploaded (/api/v1/files/<key>) and external images have no build-time alt
     * source (see catalog.tsx's ContentImage/MediaText renders) and still render alt="". A plain object,
     * not a Map — see loadBundledFileAlt's header for why.
     */
    bundledFileAlt?: Record<string, string>
    /**
     * This record's related works (docs/dev/miscellaneous.txt "related-entries tiles"), computed once per
     * route by `entity-records.ts`'s `buildRelatedWorksIndex` and passed in by `[id].astro` — the same
     * split as `breadcrumbs`/`pageTitle` above: catalog.tsx has no access to the full D1 read needed to
     * derive this itself. Absent in the editor (a template has no single fixed record) and the
     * `RelatedEntries` render falls back to an illustrative preview.
     */
    relatedEntries?: RelatedWork[]
}

/**
 * Outlet component type → the schema field types it accepts (pivot §4). Drives the editor's field
 * pickers and the pairing lint's dangling-outlet-field rule (which receives this as an argument, same
 * pattern as TOKEN_PROPS). Contributor rule: a new outlet MUST register here.
 *
 * `ContentField` accepts every non-image entity field kind (entity-fields.ts's `EntityFieldKind` minus
 * "image") plus EmDash's own "string"/"text" — it is collection-agnostic, so it works unmodified on
 * pages/posts fields too, just without the reference/date/list-aware formatting those collections never
 * produce. `MediaText` accepts only "image" — its non-image side is a slot, not a bound field.
 */
export const OUTLET_PROPS: Record<string, readonly string[]> = {
    ContentText: ["string", "text"],
    ContentRichText: ["portableText"],
    ContentImage: ["image"],
    ContentField: [
        "string",
        "text",
        "number",
        "date",
        "reference",
        "referenceList",
        "list",
        "uri",
        "yearOrLiving",
        "countryCode",
        "email",
        "titleCase",
        "citations"
    ],
    MediaText: ["image"]
}

/**
 * Component type → the names of its rich-text props (§4.4). Drives `convert.ts`'s PT ↔ ProseMirror
 * walks; a component absent here has no rich-text props. Phase 1 has exactly `RichText.body`.
 * Contributor rule 5: a new rich-text prop MUST be registered here.
 */
export const RICH_TEXT_PROPS: Record<string, readonly string[]> = { RichText: ["body"] }

/**
 * Component type → its token-select props and the kind each draws from (§4.5), kept beside the field
 * definitions below so the two cannot drift. The lint pass (§6.7) consumes this to flag a stored
 * token name absent from the theme; passing it in (rather than importing lint here) keeps lint free
 * of this module's React/Puck code and unit-testable. Optional token props (Section `background`,
 * Divider `color`) may hold "" (None), which lint skips. Contributor rule: a new token-select field
 * MUST be registered here.
 */
export const TOKEN_PROPS: TokenPropRegistry = {
    Section: { background: "colors", paddingY: "space", radius: "radius", border: "borders", shadow: "shadows" },
    Columns: { gap: "space" },
    Row: { gap: "space" },
    Heading: { typography: "typography" },
    ContentText: { typography: "typography" },
    ContentField: { typography: "typography" },
    Spacer: { size: "space" },
    Divider: { spaceAround: "space", color: "colors" },
    Button: { variant: "buttonVariants", shadow: "shadows" },
    Image: { radius: "radius", border: "borders", shadow: "shadows" },
    ContentImage: { radius: "radius", border: "borders", shadow: "shadows" },
    MediaText: { radius: "radius", border: "borders", shadow: "shadows" }
}

/**
 * Human-readable "where does this actually get used" prose for the theme editor's per-kind preview
 * captions. Hand-written, not derived from `TOKEN_PROPS`: the interesting facts here — a button
 * variant's indirect reference to `radius`/`borders`/`space`, and `shadows` currently being consumed
 * by nothing at all — can't be expressed by formatting `TOKEN_PROPS` as a string, so a short honest
 * sentence per kind beats generated text that would immediately need exceptions bolted on. Keep this
 * in step with real consumers; a wrong note is worse than no note. `colors`/`typography`/`buttonVariants`
 * are omitted — `TOKEN_PROPS` already answers "which component" clearly enough for those to not need
 * a separate note.
 */
export const TOKEN_USAGE_NOTES: Partial<Record<TokenKind, string>> = {
    space: "Used directly by Section's vertical padding, Columns' and Row's gap, Spacer's size, and " +
        "Divider's space around — plus indirectly by a button variant's own horizontal/vertical padding.",
    radius: "Used by a button variant's radius field, and directly by Section, Image, Content Image, and " +
        "Media + text's own optional Corner radius field (each defaults to None, the pre-existing look).",
    borders: "Used by a button variant's border field, and directly by Section, Image, Content Image, " +
        "and Media + text's own optional Border field (each defaults to None), plus the theme's Site " +
        "Chrome hairline border role.",
    shadows: "Used by Section, Image, Content Image, and Media + text's own optional Shadow field, and " +
        "Button's own optional Shadow field (none of these come from a button variant) — each defaults " +
        "to None, the pre-existing look.",
    breakpoints: "One breakpoint can be designated (the \"Columns stacks below\" control above) to drive " +
        "Columns' single-column stacking point; the rest are documentary. Unset, Columns stacks below a " +
        "fixed 768px."
}

/**
 * Puck components (and field) that draw from a token kind, formatted `"Component.field"`, in
 * `TOKEN_PROPS`'s own key order. Unlike `TOKEN_USAGE_NOTES`, typography's binding has no indirection
 * and no "consumed by nothing" case to explain — every `typography`-kind field is a direct, first-class
 * consumer — so a derived list is both correct and simpler than hand-written prose here.
 */
export function tokenKindUsers(kind: TokenKind): string[] {
    const users: string[] = []
    for (const [component, fields] of Object.entries(TOKEN_PROPS)) {
        for (const [field, fieldKind] of Object.entries(fields)) {
            if (fieldKind === kind) users.push(`${component}.${field}`)
        }
    }
    return users
}

/**
 * The media object an Image stores (§4.5). It holds the **storage key**, never a baked URL: the URL a
 * key resolves to differs by render target (public origin at build, Access-gated proxy in the editor),
 * so baking one in would hard-code the wrong answer for the other. See `media.ts`.
 */
export interface MediaValue {
    mediaId: string
    storageKey: string
    alt: string
    width: number
    height: number
}

/**
 * A slot prop's value in render: a Puck-supplied component that renders the slot's contents.
 * `className`/`style` land on the DOM element Puck wraps the slot's items in (a plain `<div>` by
 * default) — the only hook available for styling that wrapper, since its children render as direct
 * DOM children with no further nesting.
 */
type SlotRender = ComponentType<{ className?: string; style?: CSSProperties }>

/** Casts a token-var map to CSSProperties (React types omit custom-property keys). */
function vars(map: Record<string, string | number>): CSSProperties {
    return map as CSSProperties
}

/**
 * A token select field. Optional selects prepend a "None" option (value ""), letting the render skip
 * the local var so `compositor.css`'s fallback applies. Options come from the live theme.
 */
function tokenSelect(theme: TokenCatalog, kind: TokenKind, label: string, optional = false) {
    const options = tokenSelectOptions(theme, kind)
    return {
        type: "select" as const,
        label,
        options: optional ? [{ label: "None", value: "" }, ...options] : options
    }
}

/**
 * The optional radius/border/shadow local `--cmp-<prefix>-*` vars for a frame-styled container (Section,
 * Image/ContentImage, MediaText's media side). Each is skipped when its token name is "" (the "None"
 * option), so `compositor.css`'s own fallback (no rounding/border/shadow — the pre-existing look) applies.
 */
function frameStyleVars(prefix: string, radius: string, border: string, shadow: string): Record<string, string> {
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

// --- Media picker (editor-only custom field) -------------------------------------------------------
// Lives entirely inside the field render so its browser code (fetch + modal state) never runs on the
// build path; attached only in the editor target. Lists images from GET /_emdash/api/media, same-origin.

/** A media list row from GET /_emdash/api/media (subset of EmDash's MediaItem). */
interface MediaListItem {
    id: string
    storageKey: string
    filename: string
    alt: string | null
    width: number | null
    height: number | null
    mimeType: string
}

// Rendered by Puck as a React component (AutoField mounts `<FieldComponent />`), so hooks are valid.
// Never invoked by the static RSC renderer, and attached only in the editor target, so its browser
// code (fetch + modal state) stays off the build path.
const mediaPickerRender: CustomFieldRender<MediaValue | undefined> = ({ value, onChange }) => {
    const [open, setOpen] = useState(false)
    const [items, setItems] = useState<MediaListItem[]>([])
    const [query, setQuery] = useState("")
    const [error, setError] = useState<string | null>(null)

    const load = async (q: string) => {
        setError(null)
        const params = new URLSearchParams({ mimeType: "image/", limit: "50" })
        if (q) params.set("q", q)
        try {
            const res = await fetch(`/_emdash/api/media?${params.toString()}`, {
                headers: { Accept: "application/json" },
                credentials: "same-origin"
            })
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
            const body = (await res.json()) as { data?: { items?: MediaListItem[] } }
            setItems(body.data?.items ?? [])
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load media")
        }
    }

    const pick = (item: MediaListItem) => {
        onChange({
            mediaId: item.id,
            storageKey: item.storageKey,
            alt: item.alt ?? "",
            width: item.width ?? 0,
            height: item.height ?? 0
        })
        setOpen(false)
    }

    return (
        <div>
            <button
                type="button"
                onClick={() => {
                    setOpen(true)
                    void load(query)
                }}
                style={{ display: "block", width: "100%", padding: "0.5rem", cursor: "pointer" }}
            >
                {value ? `Change image (${value.alt || value.mediaId})` : "Choose image…"}
            </button>
            {value?.storageKey && isSafeStorageKey(value.storageKey) && (
                <img
                    src={proxyMediaUrl(value.storageKey)}
                    alt={value.alt}
                    style={{ marginTop: "0.5rem", maxWidth: "100%", height: "auto", display: "block" }}
                />
            )}
            {open && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.5)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 1000
                    }}
                    onClick={() => setOpen(false)}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: "#fff",
                            color: "#111",
                            width: "min(720px, 90vw)",
                            maxHeight: "80vh",
                            overflow: "auto",
                            padding: "1rem",
                            borderRadius: "0.5rem"
                        }}
                    >
                        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
                            <input
                                type="search"
                                placeholder="Search media…"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") void load(query)
                                }}
                                style={{ flex: 1, padding: "0.4rem" }}
                            />
                            <button type="button" onClick={() => void load(query)}>
                                Search
                            </button>
                            <button type="button" onClick={() => setOpen(false)}>
                                Close
                            </button>
                        </div>
                        {error && <p style={{ color: "#b00" }}>{error}</p>}
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                                gap: "0.5rem"
                            }}
                        >
                            {items.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => pick(item)}
                                    title={item.filename}
                                    style={{ padding: 0, border: "1px solid #ddd", cursor: "pointer", background: "none" }}
                                >
                                    <img
                                        src={proxyMediaUrl(item.storageKey)}
                                        alt={item.alt ?? item.filename}
                                        style={{ width: "100%", height: "90px", objectFit: "cover", display: "block" }}
                                    />
                                </button>
                            ))}
                        </div>
                        {items.length === 0 && !error && <p>No images found.</p>}
                    </div>
                </div>
            )}
        </div>
    )
}

// --- Component render props -----------------------------------------------------------------------

interface SectionProps {
    background: string
    paddingY: string
    /** a `radius` token name, or "" for no rounding (the pre-existing, unstyled default). */
    radius: string
    /** a `borders` token name, or "" for no border (the pre-existing default). */
    border: string
    /** a `shadows` token name, or "" for no shadow (the pre-existing default). */
    shadow: string
    content: SlotRender
}
interface ColumnsProps {
    count: number
    gap: string
    col1: SlotRender
    col2: SlotRender
    col3: SlotRender
    col4: SlotRender
}
interface RowProps {
    gap: string
    content: SlotRender
}
interface HeadingProps {
    text: string
    level: "h1" | "h2" | "h3" | "h4"
    typography: string
    align: "start" | "center" | "end"
}
interface RichTextProps {
    /** PT block array on the build path (stored form); a Puck-rendered ReactNode in the editor canvas. */
    body: PortableTextBlock[] | ReactNode
}
/**
 * A fixed rendered-size preset for `Image`/`ContentImage`/`MediaText` (D9): NOT a theme token — image
 * size is a per-placement layout choice, not a design-system value worth authoring in the theme editor,
 * so this reuses the same fixed-enum-select pattern `aspect` already uses rather than adding a new
 * `TokenKind`. "full" is the pre-existing (unstyled) behavior for `Image`/`ContentImage`, and "medium" is
 * the pre-existing fixed flex-basis for `MediaText`'s media column — each component's `defaultProps`
 * preserves its own old behavior so a design authored before this control existed renders unchanged.
 */
type ImageSizePreset = "small" | "medium" | "large" | "full"

/** The `size` select shared by `Image`, `ContentImage`, and `MediaText` — same options, different default. */
function imageSizeSelect() {
    return {
        type: "select" as const,
        label: "Size",
        options: [
            { label: "Small", value: "small" },
            { label: "Medium", value: "medium" },
            { label: "Large", value: "large" },
            { label: "Full width", value: "full" }
        ]
    }
}

interface ImageProps {
    media?: MediaValue
    alt: string
    aspect: "original" | "landscape" | "portrait"
    size: ImageSizePreset
    /** a `radius` token name, or "" for no rounding (the pre-existing, unstyled default). */
    radius: string
    /** a `borders` token name, or "" for no border (the pre-existing default). */
    border: string
    /** a `shadows` token name, or "" for no shadow (the pre-existing default). */
    shadow: string
}
interface ButtonProps {
    label: string
    href: string
    /** a `buttonVariants` token name (theme-authored), not a fixed union. */
    variant: string
    /** a `shadows` token name, or "" for no shadow (the pre-existing default) — variants don't carry one. */
    shadow: string
}
interface SpacerProps {
    size: string
}
interface DividerProps {
    spaceAround: string
    color: string
}
interface ContentTextProps {
    field: string
    level: "h1" | "h2" | "h3" | "h4"
    typography: string
    align: "start" | "center" | "end"
}
interface ContentRichTextProps {
    field: string
}
interface ContentImageProps {
    field: string
    aspect: "original" | "landscape" | "portrait"
    size: ImageSizePreset
    /** a `radius` token name, or "" for no rounding (the pre-existing, unstyled default). */
    radius: string
    /** a `borders` token name, or "" for no border (the pre-existing default). */
    border: string
    /** a `shadows` token name, or "" for no shadow (the pre-existing default). */
    shadow: string
}
interface ContentFieldProps {
    field: string
    /** blank = use the bound field's catalog label (entity-fields.ts). Non-blank overrides it. */
    label: string
    showLabel: "yes" | "no"
    typography: string
    /** What to render when the bound value is empty (see {@link isEmptyFieldValue}): leave the row as-is
     *  (label per `showLabel`, blank value — the pre-existing behavior, and the default so old designs
     *  are unaffected), hide just the label (blank value, no label), or substitute `emptyValue`. */
    onEmpty: "doNothing" | "hideLabel" | "placeholder"
    /** Shown in place of the value when empty and `onEmpty` is "placeholder". */
    emptyValue: string
}
interface PagefindSearchProps {
    /** "site" (the default, and search.astro's untagged behavior) searches every indexed public page;
     *  "database" restricts to pages carrying `data-pagefind-filter="scope:database"` (see search.astro
     *  and layouts/PublicPage.astro's `pagefindFilter` prop) — the three entity nouns' index/detail pages. */
    scope: "site" | "database"
}
interface RelatedEntriesProps {
    heading: string
    limit: number
}
interface MediaTextProps {
    field: string
    aspect: "original" | "landscape" | "portrait"
    imagePosition: "start" | "end"
    content: SlotRender
    size: ImageSizePreset
    /** a `radius` token name, or "" for no rounding (the pre-existing, unstyled default). Applies to the
     *  media side only (the text side has no frame to round). */
    radius: string
    /** a `borders` token name, or "" for no border (the pre-existing default). Media side only. */
    border: string
    /** a `shadows` token name, or "" for no shadow (the pre-existing default). Media side only. */
    shadow: string
}

// --- Shared render bodies ---------------------------------------------------------------------------
// The outlets are thin content-fed twins of existing components (pivot §4): same markup, same classes,
// same token wiring — only where the value comes from differs. One render body each keeps them twins.

/** The Heading markup, shared by `Heading` (inline text) and `ContentText` (entry-fed text). Also
 * reused by the theme editor's live preview (`ThemePreview.tsx`) so a typography specimen renders with
 * the exact same class/var wiring as the real component, never a hand-rolled approximation. */
export function renderHeadingTag(text: string, level: "h1" | "h2" | "h3" | "h4", typography: string, align: string) {
    const Tag = level
    return (
        <Tag
            className="cmp-heading"
            style={vars({
                "--cmp-heading-family": tokenVar("typography", typography, "family"),
                "--cmp-heading-size": tokenVar("typography", typography, "size"),
                "--cmp-heading-weight": tokenVar("typography", typography, "weight"),
                "--cmp-heading-line-height": tokenVar("typography", typography, "line-height"),
                "--cmp-heading-letter-spacing": tokenVar("typography", typography, "letter-spacing"),
                "--cmp-heading-style": tokenVar("typography", typography, "style"),
                "--cmp-heading-decoration": tokenVar("typography", typography, "decoration"),
                "--cmp-heading-transform": tokenVar("typography", typography, "transform"),
                "--cmp-heading-align": align
            })}
        >
            {text}
        </Tag>
    )
}

const BUNDLED_FILE_PREFIX = "/files/"

/**
 * Resolves a bundled (src/files) image source's alt text from the build-time sidecar index
 * (BuildConfigContext.bundledFileAlt). Returns undefined for an R2/EmDash `key` source or a non-bundled
 * `url` source (external https, or no index available — the editor target never has one).
 */
function bundledAlt(source: NonNullable<MediaSource>, index: Record<string, string> | undefined): string | undefined {
    if (source.kind !== "url" || !index || !source.url.startsWith(BUNDLED_FILE_PREFIX)) {
        return undefined
    }
    return index[source.url.slice(BUNDLED_FILE_PREFIX.length)]
}

/** The Image markup, shared by `Image` (picked media) and `ContentImage` (entry-fed image field). Not
 * used by `MediaText`'s media side — its rendered size comes from its flex container, not the `<img>`
 * itself (see `.cmp-media-text__media` in compositor.css), so `size` drives `data-size` there instead. */
function renderImageTag(
    url: string,
    alt: string,
    width: number | undefined,
    height: number | undefined,
    aspect: string,
    size: ImageSizePreset,
    radius: string,
    border: string,
    shadow: string
) {
    return (
        <img
            className="cmp-image"
            data-aspect={aspect}
            data-size={size}
            src={url}
            alt={alt}
            width={width}
            height={height}
            style={vars(frameStyleVars("image", radius, border, shadow))}
        />
    )
}

/** The Button markup. Exported (like `renderHeadingTag`) so the theme editor's live preview renders a
 * button variant with the exact same class/var wiring as the real component, never a hand-rolled copy. */
export function renderButtonTag(label: string, href: string, variant: string, shadow = "") {
    return (
        <a
            className="cmp-button"
            href={sanitizeHref(href)}
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

/** The pagefind search-box markup: a plain GET form to /search, same convention as entity/index.astro's
 * database-scoped search box — native browser navigation, no client JS required either here or on the
 * canvas (the catalog purity rule: no hooks, no state). Submitting with an empty query navigates to
 * /search with no `q`, which renders its own empty-state UI, matching that precedent exactly. */
function renderPagefindSearchTag(scope: "site" | "database") {
    return (
        <form className="cmp-search" action="/search" method="get">
            {scope === "database" && <input type="hidden" name="scope" value="database" />}
            <input type="search" name="q" placeholder="Search…" aria-label="Search" autoComplete="off" />
            <button type="submit">Search</button>
        </form>
    )
}

/**
 * The breadcrumb-trail markup: Home, then each ancestor crumb (linked, or plain text when `href` is
 * null — the "Posts" case, see route-authority.ts), then the current page's own title as the final,
 * unlinked crumb. With no route context at all (the editor, previewing a template rather than a fixed
 * route — see BuildConfigContext), an illustrative fallback trail stands in so the canvas still shows
 * what the component looks like.
 */
function renderBreadcrumbsTag(
    ancestors: { label: string; href: string | null }[] | undefined,
    pageTitle: string | undefined,
    isEditorPreview: boolean
) {
    if (ancestors === undefined && pageTitle === undefined && isEditorPreview) {
        return (
            <nav className="cmp-breadcrumbs" aria-label="Breadcrumb">
                <ol>
                    <li>
                        <a href="/">Home</a>
                    </li>
                    <li>
                        <span>Example section</span>
                    </li>
                    <li aria-current="page">Example page</li>
                </ol>
            </nav>
        )
    }
    return (
        <nav className="cmp-breadcrumbs" aria-label="Breadcrumb">
            <ol>
                <li>
                    <a href="/">Home</a>
                </li>
                {(ancestors ?? []).map((crumb, index) => (
                    <li key={index}>{crumb.href ? <a href={crumb.href}>{crumb.label}</a> : <span>{crumb.label}</span>}</li>
                ))}
                {pageTitle && <li aria-current="page">{pageTitle}</li>}
            </ol>
        </nav>
    )
}

/** `RelatedEntries`' default `limit`, and the fallback used when an authored `limit` isn't a positive
 *  finite number (e.g. cleared in the editor). */
const DEFAULT_RELATED_LIMIT = 6

/** Illustrative canvas-only tiles, shown when there is no route context at all (mirrors
 *  `renderBreadcrumbsTag`'s fallback trail) — `href: null` so they render as plain, non-navigating tiles. */
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

/**
 * The `RelatedEntries` tile grid: works related to the routed record (see `entity-records.ts`'s
 * `buildRelatedWorksIndex`), sliced to `limit`. With no route context at all (the editor, previewing a
 * template rather than a fixed record), illustrative tiles stand in so the canvas shows what the block
 * looks like. On the build target, `entries` is always defined (every entity record gets one, possibly
 * empty) — an empty list renders nothing, the same auto-omit behavior as the content outlets.
 */
function renderRelatedEntriesTag(entries: RelatedWork[] | undefined, heading: string, limit: number, isEditorPreview: boolean) {
    const isIllustrative = entries === undefined && isEditorPreview
    const source = isIllustrative ? ILLUSTRATIVE_RELATED_WORKS : entries
    if (!source || source.length === 0) return null // pages/posts template, or a record with no related works

    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_RELATED_LIMIT
    const tiles = source.slice(0, safeLimit)

    return (
        <div className="cmp-related">
            {heading && <h2 className="cmp-related__heading">{heading}</h2>}
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

/** Neutral editor-canvas placeholder for an outlet with no preview entry to resolve against (pivot §4). */
function OutletPlaceholder({ field }: { field: string }) {
    return <div className="cmp-outlet-placeholder">⟨ field: {field || "not bound"} ⟩</div>
}

/**
 * The `field` select for an outlet: options are the template collection's schema fields (from the
 * config context — editor-only; the build never renders field UIs), filtered to the types the outlet
 * accepts (D5), so a design cannot bind a field that does not exist or has the wrong type.
 */
function outletFieldSelect(fields: CollectionField[] | undefined, accepted: readonly string[]) {
    const options = (fields ?? [])
        .filter((candidate) => accepted.includes(candidate.type))
        .map((candidate) => ({ label: candidate.label, value: candidate.slug }))
    return {
        type: "select" as const,
        label: "Field",
        options: [{ label: "— choose a field —", value: "" }, ...options]
    }
}

// --- ContentField / MediaText (unified field-outlet rewrite) ----------------------------------------
// Replaces the old dedicated CompositionDetail block: every entity field, of any kind, is bindable
// through these two generic, collection-agnostic outlets — no per-noun render code lives here.

/** A resolved foreign-key reference, as `entity-records.ts`'s normalizer attaches it to an entry. */
interface ResolvedReferenceLike {
    id?: unknown
    name?: unknown
    href?: unknown
}

function isResolvedReferenceLike(value: unknown): value is ResolvedReferenceLike {
    return isRecord(value) && ("name" in value || "href" in value)
}

/** One resolved reference: linked to its public page when it has one, plain text otherwise (owner note:
 * an empty/unresolvable reference renders as an empty value, not a placeholder string). */
function ReferenceLink({ value }: { value: ResolvedReferenceLike }) {
    const name = typeof value.name === "string" ? value.name.trim() : ""
    const href = typeof value.href === "string" ? value.href : null
    if (name === "") return null
    return href ? <a href={href}>{name}</a> : <>{name}</>
}

/** A comma-separated list of resolved references (see {@link ReferenceLink}). */
function ReferenceLinkList({ values }: { values: unknown[] }) {
    const items = values.filter(isResolvedReferenceLike)
    if (items.length === 0) return null
    return (
        <>
            {items.map((item, index) => (
                <span key={index}>
                    {index > 0 ? ", " : ""}
                    <ReferenceLink value={item} />
                </span>
            ))}
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
 * be deterministic, so this never reads the reader's locale). `timeZone: "UTC"` is load-bearing: D1
 * stores these as epoch-millisecond instants; formatting in the build machine's local timezone would
 * shift the displayed date/time depending on where the build runs, so it is always rendered in UTC. */
const ENTITY_DATE_FORMAT = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" })

/**
 * Formats a resolved entity-field value for display, kind-aware when `kind` (the bound field's
 * `EntityField.type`, from entity-fields.ts) is known, and falling back to shape-based inference when
 * it isn't (pages/posts fields, or an editor render before a schema is loaded — pages/posts schemas
 * never produce a reference/date/list/uri-shaped value, so the inference path is exercised by entity
 * templates alone in practice).
 *
 * Owner decision: null/empty/unresolvable ALWAYS formats to an empty value here — never a placeholder
 * string — so `ContentField` can keep rendering its row (auto-omitting the row/label when empty is a
 * deferred, harder feature; see the plan).
 */
function formatFieldValue(value: unknown, kind: string | undefined): ReactNode {
    if (value === null || value === undefined) return ""

    switch (kind) {
        case "date": {
            if (typeof value !== "number") return ""
            const date = new Date(value)
            return Number.isNaN(date.getTime()) ? String(value) : ENTITY_DATE_FORMAT.format(date)
        }
        case "reference":
            return isResolvedReferenceLike(value) ? <ReferenceLink value={value} /> : ""
        case "referenceList":
            return Array.isArray(value) ? <ReferenceLinkList values={value} /> : ""
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
                <a href={`mailto:${value}`}>{value}</a>
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
                if (value.length > 0 && value.every(isResolvedReferenceLike)) return <ReferenceLinkList values={value} />
                return value.filter((item) => item !== null && item !== undefined && item !== "").join(", ")
            }
            if (isResolvedReferenceLike(value)) return <ReferenceLink value={value} />
            if (isRecord(value) && ("uriType" in value || "uri" in value)) return <PublicationUriValue value={value} />
            return ""
        }
    }
}

/**
 * Builds the Puck config for the given theme, target, and per-entry context (§6.3, pivot D7). The
 * component set and props are the frozen §4.5 catalog v1 plus the content outlets (pivot §4, and the
 * unified field-outlet rewrite's `ContentField`/`MediaText`); select options are drawn from `theme`.
 * `target` governs only the two editor-only fields (RichText `body`, Image `media`) per this module's
 * header. Outlet renders read the routed entry from the `context` closure — no clone-and-fill, no React
 * context — so the zero-JS build path is untouched; with no context (a `design_page`) outlets render
 * nothing (build) or a placeholder (editor).
 *
 * @param {TokenCatalog} theme - the live theme whose tokens populate the select fields
 * @param {CatalogTarget} target - "editor" (rich editing fields) or "build" (passthrough fields)
 * @param {BuildConfigContext} [context] - the entry the outlets resolve against, and (editor only)
 *   the collection schema that populates the outlet field pickers
 * @returns {Config} - the Puck config feeding the editor island or the static renderer
 */
export function buildConfig(theme: TokenCatalog, target: CatalogTarget, context?: BuildConfigContext): Config {
    const isEditor = target === "editor"

    // One storage key resolves to a different URL per target: the public media origin at build (a
    // prerendered page is served to anonymous visitors and the /_emdash proxy is Access-gated), the
    // same-origin proxy in the editor (the admin is authenticated through Access, and the public origin
    // is not in the client bundle). See media.ts — getting this backwards ships a broken <img>.
    const resolveMediaUrl = (storageKey: string) =>
        isEditor ? proxyMediaUrl(storageKey) : publicMediaUrl(storageKey, context?.mediaBaseUrl)

    // Same split as resolveMediaUrl, for D1 entity `image` fields pointing at our own R2_FILES uploads
    // (`/api/v1/files/{key}`) rather than EmDash media.
    const resolveFileUrl = (key: string) => (isEditor ? proxyFileUrl(key) : publicFileUrl(key, context?.filesBaseUrl))

    const mediaUrl = (source: NonNullable<MediaSource>) =>
        source.kind === "key" ? resolveMediaUrl(source.storageKey) : source.kind === "file" ? resolveFileUrl(source.key) : source.url

    const components = {
        Section: {
            label: "Section",
            fields: {
                background: tokenSelect(theme, "colors", "Background", true),
                paddingY: tokenSelect(theme, "space", "Vertical padding"),
                radius: tokenSelect(theme, "radius", "Corner radius", true),
                border: tokenSelect(theme, "borders", "Border", true),
                shadow: tokenSelect(theme, "shadows", "Shadow", true),
                content: { type: "slot" as const }
            },
            defaultProps: { background: "", paddingY: "section", radius: "", border: "", shadow: "", content: [] },
            render: ({ background, paddingY, radius, border, shadow, content: Content }: SectionProps) => (
                <section
                    className="cmp-section"
                    style={vars({
                        ...(background ? { "--cmp-section-bg": tokenVar("colors", background) } : {}),
                        "--cmp-section-py": tokenVar("space", paddingY),
                        ...frameStyleVars("section", radius, border, shadow)
                    })}
                >
                    <Content />
                </section>
            )
        },
        Columns: {
            label: "Columns",
            fields: {
                count: {
                    type: "select" as const,
                    label: "Columns",
                    options: [
                        { label: "2", value: 2 },
                        { label: "3", value: 3 },
                        { label: "4", value: 4 }
                    ]
                },
                gap: tokenSelect(theme, "space", "Gap"),
                col1: { type: "slot" as const },
                col2: { type: "slot" as const },
                col3: { type: "slot" as const },
                col4: { type: "slot" as const }
            },
            defaultProps: { count: 2, gap: "md", col1: [], col2: [], col3: [], col4: [] },
            render: ({ count, gap, col1: Col1, col2: Col2, col3: Col3, col4: Col4 }: ColumnsProps) => {
                const cols = [Col1, Col2, Col3, Col4].slice(0, count)
                return (
                    <div
                        className="cmp-columns"
                        style={vars({ "--cmp-columns-count": String(count), "--cmp-columns-gap": tokenVar("space", gap) })}
                    >
                        {cols.map((Col, i) => (
                            <div className="cmp-columns__col" key={i}>
                                <Col />
                            </div>
                        ))}
                    </div>
                )
            }
        },
        Row: {
            label: "Row",
            fields: {
                gap: tokenSelect(theme, "space", "Gap"),
                content: { type: "slot" as const }
            },
            defaultProps: { gap: "md", content: [] },
            // The only explicit horizontal container (see module header's flow-invariant note): children
            // lay out left-to-right and wrap, regardless of each child's own intrinsic CSS display.
            // `cmp-row` styles the slot's own wrapper directly (rather than an outer div around it) —
            // Puck's slot items are direct children of that wrapper with no further nesting, so it must
            // be the flex container for `gap` to land between the items instead of having only itself
            // to apply to.
            render: ({ gap, content: Content }: RowProps) => (
                <Content className="cmp-row" style={vars({ "--cmp-row-gap": tokenVar("space", gap) })} />
            )
        },
        Heading: {
            label: "Heading",
            fields: {
                text: { type: "text" as const, label: "Text" },
                level: {
                    type: "select" as const,
                    label: "Level",
                    options: [
                        { label: "H1", value: "h1" },
                        { label: "H2", value: "h2" },
                        { label: "H3", value: "h3" },
                        { label: "H4", value: "h4" }
                    ]
                },
                typography: tokenSelect(theme, "typography", "Typography"),
                align: {
                    type: "select" as const,
                    label: "Alignment",
                    options: [
                        { label: "Start", value: "start" },
                        { label: "Center", value: "center" },
                        { label: "End", value: "end" }
                    ]
                }
            },
            defaultProps: { text: "Heading", level: "h2", typography: "display", align: "start" },
            render: ({ text, level, typography, align }: HeadingProps) =>
                renderHeadingTag(text, level, typography, align)
        },
        RichText: {
            label: "Rich text",
            fields: {
                // Editor: the native richtext field (ProseMirror working value). Build: a passthrough so the
                // render receives the raw PT array (see header — Puck would otherwise blank it at build).
                body: isEditor ? { type: "richtext" as const, label: "Body" } : { type: "text" as const, label: "Body" }
            },
            defaultProps: { body: [] },
            render: ({ body }: RichTextProps) => (
                <div className="cmp-richtext">
                    {Array.isArray(body) ? <RichTextView value={body as PortableTextBlock[]} /> : (body as ReactNode)}
                </div>
            )
        },
        Image: {
            label: "Image",
            fields: {
                media: isEditor
                    ? { type: "custom" as const, label: "Image", render: mediaPickerRender }
                    : { type: "text" as const, label: "Image" },
                alt: { type: "text" as const, label: "Alt text (required)" },
                aspect: {
                    type: "select" as const,
                    label: "Aspect",
                    options: [
                        { label: "Original", value: "original" },
                        { label: "Landscape", value: "landscape" },
                        { label: "Portrait", value: "portrait" }
                    ]
                },
                size: imageSizeSelect(),
                radius: tokenSelect(theme, "radius", "Corner radius", true),
                border: tokenSelect(theme, "borders", "Border", true),
                shadow: tokenSelect(theme, "shadows", "Shadow", true)
            },
            // "full" preserves this component's pre-existing (unstyled, max-width:100%) behavior.
            defaultProps: { alt: "", aspect: "original", size: "full", radius: "", border: "", shadow: "" },
            render: ({ media, alt, aspect, size, radius, border, shadow }: ImageProps) => {
                if (!media?.storageKey || !isSafeStorageKey(media.storageKey)) return null
                const url = resolveMediaUrl(media.storageKey)
                return renderImageTag(url, alt, media.width || undefined, media.height || undefined, aspect, size, radius, border, shadow)
            }
        },
        Button: {
            label: "Button",
            fields: {
                label: { type: "text" as const, label: "Label" },
                href: { type: "text" as const, label: "Link URL" },
                variant: tokenSelect(theme, "buttonVariants", "Variant"),
                shadow: tokenSelect(theme, "shadows", "Shadow", true)
            },
            // "primary" is a seeded variant name (theme is authored before this code deploys), so the
            // default resolves. The render stays pure — it maps a variant name into `--cmp-button-*`
            // locals and never sees the theme, exactly like Spacer/Divider (catalog purity rule).
            defaultProps: { label: "Button", href: "#", variant: "primary", shadow: "" },
            render: ({ label, href, variant, shadow }: ButtonProps) => renderButtonTag(label, href, variant, shadow)
        },
        Spacer: {
            label: "Spacer",
            fields: { size: tokenSelect(theme, "space", "Size") },
            defaultProps: { size: "md" },
            render: ({ size }: SpacerProps) => (
                <div className="cmp-spacer" aria-hidden="true" style={vars({ "--cmp-spacer-size": tokenVar("space", size) })} />
            )
        },
        Divider: {
            label: "Divider",
            fields: {
                spaceAround: tokenSelect(theme, "space", "Space around"),
                color: tokenSelect(theme, "colors", "Color", true)
            },
            defaultProps: { spaceAround: "md", color: "" },
            render: ({ spaceAround, color }: DividerProps) => (
                <hr
                    className="cmp-divider"
                    style={vars({
                        "--cmp-divider-space": tokenVar("space", spaceAround),
                        ...(color ? { "--cmp-divider-color": tokenVar("colors", color) } : {})
                    })}
                />
            )
        },
        Breadcrumbs: {
            label: "Breadcrumbs",
            fields: {},
            defaultProps: {},
            render: () => renderBreadcrumbsTag(context?.breadcrumbs, context?.pageTitle, isEditor)
        },
        RelatedEntries: {
            label: "Related entries",
            fields: {
                heading: { type: "text" as const, label: "Heading" },
                limit: { type: "number" as const, label: "Max tiles to show" }
            },
            defaultProps: { heading: "Related Works", limit: DEFAULT_RELATED_LIMIT },
            render: ({ heading, limit }: RelatedEntriesProps) =>
                renderRelatedEntriesTag(context?.relatedEntries, heading, limit, isEditor)
        },
        PagefindSearch: {
            label: "Search box",
            fields: {
                scope: {
                    type: "select" as const,
                    label: "Search scope",
                    options: [
                        { label: "Whole site", value: "site" },
                        { label: "Database only", value: "database" }
                    ]
                }
            },
            defaultProps: { scope: "site" },
            render: ({ scope }: PagefindSearchProps) => renderPagefindSearchTag(scope)
        },
        // --- Content outlets (pivot §4, D7): read the routed entry from the `context` closure. Each is
        // a twin of the component above it — same markup via the shared render body — differing only in
        // where the value comes from. With no resolvable value: placeholder in the editor, nothing at build.
        ContentText: {
            label: "Content text",
            fields: {
                field: outletFieldSelect(context?.fields, OUTLET_PROPS.ContentText),
                level: {
                    type: "select" as const,
                    label: "Level",
                    options: [
                        { label: "H1", value: "h1" },
                        { label: "H2", value: "h2" },
                        { label: "H3", value: "h3" },
                        { label: "H4", value: "h4" }
                    ]
                },
                typography: tokenSelect(theme, "typography", "Typography"),
                align: {
                    type: "select" as const,
                    label: "Alignment",
                    options: [
                        { label: "Start", value: "start" },
                        { label: "Center", value: "center" },
                        { label: "End", value: "end" }
                    ]
                }
            },
            defaultProps: { field: "", level: "h2", typography: "display", align: "start" },
            render: ({ field, level, typography, align }: ContentTextProps) => {
                const value = context?.entry && field ? context.entry[field] : undefined
                if (typeof value === "string" && value.trim() !== "") {
                    return renderHeadingTag(value, level, typography, align)
                }
                return isEditor ? <OutletPlaceholder field={field} /> : null
            }
        },
        ContentRichText: {
            label: "Content rich text",
            fields: {
                field: outletFieldSelect(context?.fields, OUTLET_PROPS.ContentRichText)
            },
            defaultProps: { field: "" },
            render: ({ field }: ContentRichTextProps) => {
                const value = context?.entry && field ? context.entry[field] : undefined
                if (Array.isArray(value) && value.length > 0) {
                    return (
                        <div className="cmp-richtext">
                            <RichTextView value={value as PortableTextBlock[]} />
                        </div>
                    )
                }
                return isEditor ? <OutletPlaceholder field={field} /> : null
            }
        },
        ContentImage: {
            label: "Content image",
            fields: {
                field: outletFieldSelect(context?.fields, OUTLET_PROPS.ContentImage),
                aspect: {
                    type: "select" as const,
                    label: "Aspect",
                    options: [
                        { label: "Original", value: "original" },
                        { label: "Landscape", value: "landscape" },
                        { label: "Portrait", value: "portrait" }
                    ]
                },
                size: imageSizeSelect(),
                radius: tokenSelect(theme, "radius", "Corner radius", true),
                border: tokenSelect(theme, "borders", "Border", true),
                shadow: tokenSelect(theme, "shadows", "Shadow", true)
            },
            // "full" preserves this outlet's pre-existing (unstyled, max-width:100%) behavior.
            defaultProps: { field: "", aspect: "original", size: "full", radius: "", border: "", shadow: "" },
            render: ({ field, aspect, size, radius, border, shadow }: ContentImageProps) => {
                const image = context?.entry && field ? context.entry[field] : undefined
                // For local media EmDash strips `src` on persist and carries the key at `meta.storageKey`
                // (media.ts) — the media `id` is NOT a usable handle, the file route 404s on it. A plain
                // string (a D1 entity's `image` column) is already a usable URL/path — see media.ts.
                const source = mediaSource(image)
                if (source) {
                    const url = mediaUrl(source)
                    // D1 entities carry no alt field of their own. A bundled (/files/<key>) image resolves
                    // its alt from the build-time sidecar index; an R2-uploaded (/api/v1/files/<key>) or
                    // external image has no build-time alt source and still renders alt="" — a known
                    // accessibility gap versus EmDash media, which does have one (see BuildConfigContext).
                    const alt =
                        (isRecord(image) && typeof image.alt === "string" ? image.alt : undefined) ??
                        bundledAlt(source, context?.bundledFileAlt) ??
                        ""
                    const width = isRecord(image) && typeof image.width === "number" ? image.width : undefined
                    const height = isRecord(image) && typeof image.height === "number" ? image.height : undefined
                    return renderImageTag(url, alt, width, height, aspect, size, radius, border, shadow)
                }
                return isEditor ? <OutletPlaceholder field={field} /> : null
            }
        },
        ContentField: {
            label: "Content field",
            fields: {
                field: outletFieldSelect(context?.fields, OUTLET_PROPS.ContentField),
                label: { type: "text" as const, label: "Label override (optional)" },
                showLabel: {
                    type: "select" as const,
                    label: "Show label",
                    options: [
                        { label: "Yes", value: "yes" },
                        { label: "No", value: "no" }
                    ]
                },
                typography: tokenSelect(theme, "typography", "Value typography"),
                onEmpty: {
                    type: "select" as const,
                    label: "When empty",
                    options: [
                        { label: "Do nothing (blank value)", value: "doNothing" },
                        { label: "Hide the label", value: "hideLabel" },
                        { label: "Show a placeholder value", value: "placeholder" }
                    ]
                },
                emptyValue: { type: "text" as const, label: "Placeholder value (when empty)" }
            },
            // "doNothing" preserves this outlet's pre-existing behavior (label per showLabel, blank value).
            defaultProps: { field: "", label: "", showLabel: "yes", typography: "body", onEmpty: "doNothing", emptyValue: "(none)" },
            render: ({ field, label, showLabel, typography, onEmpty, emptyValue }: ContentFieldProps) => {
                if (!field) return isEditor ? <OutletPlaceholder field={field} /> : null
                if (isEditor && !context?.entry) return <OutletPlaceholder field={field} />

                const catalogField = context?.fields?.find((candidate) => candidate.slug === field)
                const displayLabel = label.trim() !== "" ? label.trim() : (catalogField?.label ?? "")
                const value = context?.entry ? context.entry[field] : undefined
                const empty = isEmptyFieldValue(value, catalogField?.type)
                const formatted = empty && onEmpty === "placeholder" ? emptyValue : formatFieldValue(value, catalogField?.type)
                const hideLabel = showLabel === "no" || displayLabel === "" || (empty && onEmpty === "hideLabel")

                return (
                    <div
                        className="cmp-field"
                        style={vars({
                            "--cmp-field-family": tokenVar("typography", typography, "family"),
                            "--cmp-field-size": tokenVar("typography", typography, "size"),
                            "--cmp-field-line-height": tokenVar("typography", typography, "line-height"),
                            "--cmp-field-style": tokenVar("typography", typography, "style"),
                            "--cmp-field-decoration": tokenVar("typography", typography, "decoration"),
                            "--cmp-field-transform": tokenVar("typography", typography, "transform")
                        })}
                    >
                        {!hideLabel && (
                            <strong className="cmp-field__label" data-pagefind-ignore="all">
                                {displayLabel}
                            </strong>
                        )}
                        <span className="cmp-field__value">{formatted}</span>
                    </div>
                )
            }
        },
        MediaText: {
            label: "Media + text",
            fields: {
                field: outletFieldSelect(context?.fields, OUTLET_PROPS.MediaText),
                aspect: {
                    type: "select" as const,
                    label: "Aspect",
                    options: [
                        { label: "Original", value: "original" },
                        { label: "Landscape", value: "landscape" },
                        { label: "Portrait", value: "portrait" }
                    ]
                },
                imagePosition: {
                    type: "select" as const,
                    label: "Image position",
                    options: [
                        { label: "Start", value: "start" },
                        { label: "End", value: "end" }
                    ]
                },
                size: imageSizeSelect(),
                radius: tokenSelect(theme, "radius", "Corner radius", true),
                border: tokenSelect(theme, "borders", "Border", true),
                shadow: tokenSelect(theme, "shadows", "Shadow", true),
                content: { type: "slot" as const }
            },
            // "medium" preserves this primitive's pre-existing fixed 16rem media-column width.
            defaultProps: {
                field: "",
                aspect: "original",
                imagePosition: "start",
                size: "medium",
                radius: "",
                border: "",
                shadow: "",
                content: []
            },
            // Concern #3 (missing images): when the bound field resolves to no usable source, the media
            // side is simply not rendered — no dead column, no reserved space. `content` then occupies the
            // whole row, matching the collapsing-primitive design (see plan / module header).
            render: ({ field, aspect, imagePosition, size, radius, border, shadow, content: Content }: MediaTextProps) => {
                const image = context?.entry && field ? context.entry[field] : undefined
                const source = mediaSource(image)
                return (
                    <div
                        className="cmp-media-text"
                        style={vars({ "--cmp-media-text-direction": imagePosition === "end" ? "row-reverse" : "row" })}
                    >
                        {source && (
                            <div className="cmp-media-text__media" data-size={size}>
                                {renderImageTag(
                                    mediaUrl(source),
                                    (isRecord(image) && typeof image.alt === "string" ? image.alt : undefined) ??
                                        bundledAlt(source, context?.bundledFileAlt) ??
                                        "",
                                    isRecord(image) && typeof image.width === "number" ? image.width : undefined,
                                    isRecord(image) && typeof image.height === "number" ? image.height : undefined,
                                    aspect,
                                    size,
                                    radius,
                                    border,
                                    shadow
                                )}
                            </div>
                        )}
                        <div className="cmp-media-text__content">
                            <Content />
                        </div>
                    </div>
                )
            }
        }
    }

    return {
        components,
        // The site-wide flow invariant's top-level anchor (see module header): every design's rendered
        // output is wrapped in one flex-column container, so a template's outermost components stack even
        // when authored without an enclosing Section.
        root: {
            render: ({ children }: { children: ReactNode }) => <div className="cmp-root">{children}</div>
        }
    } as unknown as Config
}
