/**
 * lib/compositor/catalog.tsx
 *
 * The single, frozen component catalog (impl §4.5/§6.3). `buildConfig(theme, target, context?)` is a
 * factory — select options depend on the live theme, outlet renders on the routed entry (pivot D7) —
 * producing the Puck `Config` driving BOTH the editor island and the static build renderer. Render
 * functions are pure (catalog purity rule): no hooks, no state, no browser APIs, no data fetching;
 * every visual control stores a token *name* resolved to `var(--dtk-…)` at render, all real styling
 * lives in `compositor.css`. Inline styles carry token-var lookups only, mapping a chosen token to a
 * local custom property `compositor.css` applies — no freeform CSS generated at render.
 *
 * Editor vs build target (deliberate deviation from "one config feeds both"): Puck's `useRichtextProps`
 * intercepts every `richtext`-typed field in the RSC render path too, normalizing a stored PT array to
 * an *empty* ProseMirror doc — a `richtext` field would silently blank every design page at build. So
 * the build target exposes RichText's `body` as a plain passthrough field, routed through `richtext.tsx`
 * for `pages`-parity output; the editor target uses the real `richtext` field (ProseMirror form from
 * `convert.ts`), Puck renders it natively. `RichText.render` distinguishes the two by
 * `Array.isArray(body)`. Media picker is likewise editor-only, keeping its browser code off the build path.
 *
 * Button `variant` (Phase D): a token select over the theme's `buttonVariants`, each a bundle of
 * color/radius/space/border references. Render maps the chosen variant into `--cmp-button-*` locals
 * `compositor.css` applies — no variant styling hardcoded. Theme is authored with its variants BEFORE
 * this code deploys, so `Button.variant` never dangles at build (plan-compositor-phase-d.md §2.1 trap B).
 *
 * Flow invariant (unified field-outlet rewrite): every content-bearing container (`Section`, a `Columns`
 * column, `Row`, document root) stacks children `flex-direction: column` by default — a component's own
 * intrinsic display (e.g. `Button`'s `inline-block`) never causes it to sit beside its sibling. The ONLY
 * way to place components side by side is the explicit `Row` (or `Columns` for a fixed grid) — closes
 * the flow ambiguity the editor canvas doesn't otherwise show.
 *
 * Unified field-outlet rewrite (entity prerendering redesign): the old per-noun split — composer/
 * contributor through loose `ContentText`/`ContentImage` outlets, composition through one dedicated
 * `CompositionDetail` block — is gone. Every entity field is bindable through `ContentField` (kind-aware
 * value row) or `ContentImage`/`MediaText` for images. Foreign keys are pre-resolved to `{id, name,
 * href}` by `entity-records.ts`'s normalizer before render — no composition-specific code lives here.
 *
 * Known canvas-vs-build diffs (accepted): canvas shows unoptimized R2 originals; site chrome is absent
 * in the canvas; fonts may load differently.
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

import type { ComponentType, CSSProperties, ReactNode } from "react"
import type { Config } from "@puckeditor/core"
import type { PortableTextBlock } from "emdash"

import { isEmptyFieldValue } from "./entity-fields"
import { RichTextView, opensInNewTab, sanitizeHref } from "./richtext"
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
// Type-only: erased at compile, so the editor bundle never pulls in the build-side reader module.
import type { CollectionField } from "../build/design-api"
// Same type-only split as CollectionField above — RelatedEntries reads this from context, never imports
// entity-records.ts's build-side functions.
import type { RelatedWork } from "../build/entity-records"
import { mediaPickerRender } from "./catalog-media-picker"
import {
    DEFAULT_RELATED_LIMIT,
    fieldPlacementClass,
    formatFieldValue,
    frameStyleVars,
    renderButtonTag,
    renderHeadingTag,
    renderImageTag,
    renderRelatedEntriesTag,
    rendersOwnAnchors,
    vars,
    type ImageSizePreset,
    type ValuePlacement
} from "./catalog-renderers"

/** Which config a `buildConfig` call produces: the editor island's or the static build renderer's. */
export type CatalogTarget = "editor" | "build"

/**
 * Per-entry context a config is built against (pivot D7). `entry` is the routed content entry's raw
 * field record — outlet renders read `entry[field]` from this closure; null/absent means no entry
 * (a `design_page`, or template editor before a preview entry is picked). `fields` is the template's
 * collection schema — populated for the editor's field pickers, and (entity templates) also at BUILD
 * time, since `ContentField` uses each field's declared kind when rendering, not just for picker options.
 */
export interface BuildConfigContext {
    entry?: Record<string, unknown> | null
    fields?: CollectionField[]
    /** Public media origin (`EMDASH_MEDIA_PUBLIC_URL`), required on **build** whenever a design renders
     * media — a prerendered page is anonymous, and the `/_emdash` media proxy sits behind Access. Editor
     * target ignores it and uses the proxy, correct for an authenticated admin. */
    mediaBaseUrl?: string
    /** Public origin for our own R2_FILES uploads (`FILES_PUBLIC_URL`), required on **build** whenever a
     * design renders a D1 entity `image` pointing at `/api/v1/files/{key}` — that route requires an
     * authenticated identity in production, same gap `mediaBaseUrl` closes for EmDash media. */
    filesBaseUrl?: string
    /** Current route's breadcrumb trail: `breadcrumbs` is *ancestor* crumbs only (Home implicit,
     * `Breadcrumbs` always prepends it), `pageTitle` is the trail's final unlinked crumb. Both computed
     * once per route at the page level — catalog.tsx has no access to the route set to derive this
     * itself. Absent in the editor; `Breadcrumbs` falls back to an illustrative preview. */
    breadcrumbs?: { label: string; href: string | null }[]
    pageTitle?: string
    /** Bundled (src/files) image alt text, keyed by the /files/<key> suffix — resolves real alt text
     * for a plain-string entity `image` field pointing at a bundled asset. R2-uploaded and external
     * images have no build-time alt source, still render alt="". Plain object, not a Map — see
     * `loadBundledFileAlt`'s header for why. */
    bundledFileAlt?: Record<string, string>
    /** This record's related works, computed once per route by `entity-records.ts`'s
     * `buildRelatedWorksIndex`, passed in by `[id].astro` — same split as `breadcrumbs`/`pageTitle`
     * above. Absent in the editor; `RelatedEntries` falls back to an illustrative preview. */
    relatedEntries?: RelatedWork[]
}

/**
 * Outlet component type → the schema field types it accepts. Drives the editor's field pickers and the
 * pairing lint's dangling-outlet-field rule (receives this as an argument, same pattern as TOKEN_PROPS).
 * Contributor rule: a new outlet MUST register here.
 *
 * `ContentField` accepts every non-image entity field kind plus EmDash's "string"/"text" —
 * collection-agnostic, works unmodified on pages/posts fields too, just without the reference/date/
 * list-aware formatting those never produce. `MediaText` accepts only "image" — its non-image side is
 * a slot, not a bound field.
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
        "referenceListWithRole",
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

/** Component type → the names of its rich-text props. Drives `convert.ts`'s PT ↔ ProseMirror walks; a
 * component absent here has no rich-text props. Phase 1 has exactly `RichText.body`. Contributor rule:
 * a new rich-text prop MUST be registered here. */
export const RICH_TEXT_PROPS: Record<string, readonly string[]> = { RichText: ["body"] }

/**
 * Component type → its token-select props and the kind each draws from, kept beside the field
 * definitions below so the two can't drift. Lint consumes this to flag a stored token name absent from
 * the theme; passing it in (rather than importing lint here) keeps lint free of this module's React/
 * Puck code and unit-testable. Optional token props (Section `background`, Divider `color`) may hold
 * "" (None), which lint skips. Contributor rule: a new token-select field MUST be registered here.
 */
export const TOKEN_PROPS: TokenPropRegistry = {
    Section: { background: "colors", paddingY: "space", radius: "radius", border: "borders", shadow: "shadows" },
    Columns: { columnGap: "space", rowGap: "space" },
    Row: { columnGap: "space", rowGap: "space" },
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
 * captions. Hand-written, not derived from `TOKEN_PROPS`: facts like a button variant's indirect
 * reference to `radius`/`borders`/`space`, or `shadows` being consumed by nothing at all, can't be
 * expressed by formatting `TOKEN_PROPS` as a string. Keep in step with real consumers — a wrong note
 * is worse than none. `colors`/`typography`/`buttonVariants` omitted — `TOKEN_PROPS` already answers
 * "which component" clearly enough for those.
 */
export const TOKEN_USAGE_NOTES: Partial<Record<TokenKind, string>> = {
    space: "Preview sizing of spacers used on the site.",
    radius: "Preview radius used on buttons and other components.",
    borders: "Preview border styles used on buttons and other components.",
    shadows: "Preview shadow styles used on buttons and other components.",
    breakpoints: "Preview breakpoint values used for responsive design."
}

/** Puck components (and field) that draw from a token kind, formatted `"Component.field"`, in
 * `TOKEN_PROPS`'s key order. Unlike `TOKEN_USAGE_NOTES`, every `typography`-kind field is a direct,
 * first-class consumer — no indirection to explain — so a derived list beats hand-written prose here. */
export function tokenKindUsers(kind: TokenKind): string[] {
    const users: string[] = []
    for (const [component, fields] of Object.entries(TOKEN_PROPS)) {
        for (const [field, fieldKind] of Object.entries(fields)) {
            if (fieldKind === kind) users.push(`${component}.${field}`)
        }
    }
    return users
}

/** The media object an Image stores. Holds the **storage key**, never a baked URL — the URL a key
 * resolves to differs by render target (public origin at build, Access-gated proxy in the editor), so
 * baking one in would hard-code the wrong answer for the other. See `media.ts`. */
export interface MediaValue {
    mediaId: string
    storageKey: string
    alt: string
    width: number
    height: number
}

/** A slot prop's value in render: a Puck-supplied component rendering the slot's contents.
 * `className`/`style` land on the DOM element Puck wraps the slot's items in — the only styling hook,
 * since children render as direct DOM children with no further nesting. */
type SlotRender = ComponentType<{ className?: string; style?: CSSProperties }>

/** A token select field. Optional selects prepend a "None" option (value ""), letting the render skip
 * the local var so `compositor.css`'s fallback applies. */
function tokenSelect(theme: TokenCatalog, kind: TokenKind, label: string, optional = false) {
    const options = tokenSelectOptions(theme, kind)
    return {
        type: "select" as const,
        label,
        options: optional ? [{ label: "None", value: "" }, ...options] : options
    }
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
    /** a `space` token name; the horizontal gutter between columns. */
    columnGap: string
    /** a `space` token name; the gap between wrapped rows (only visible when columns stack). */
    rowGap: string
    col1: SlotRender
    col2: SlotRender
    col3: SlotRender
    col4: SlotRender
}
interface RowProps {
    /** a `space` token name; the gap between items on the same line. */
    columnGap: string
    /** a `space` token name; the gap between wrapped lines (only visible when items wrap). */
    rowGap: string
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

/** The `priority` select shared by `Image`, `ContentImage`, and `MediaText` — mark the one image, if any,
 *  that sits above the fold so it loads with `fetchPriority="high"` instead of competing on equal footing
 *  with every other resource on the page. */
function imagePrioritySelect() {
    return {
        type: "select" as const,
        label: "Priority (above the fold)",
        options: [
            { label: "No", value: "no" },
            { label: "Yes", value: "yes" }
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
    /** "yes" renders `fetchPriority="high" loading="eager"` — for the one image, if any, that sits
     *  above the fold. "no" (the default) renders neither attribute. */
    priority: "yes" | "no"
}
interface ButtonProps {
    label: string
    href: string
    /** a `buttonVariants` token name (theme-authored), not a fixed union. */
    variant: string
    /** a `shadows` token name, or "" for no shadow (the pre-existing default) — variants don't carry one. */
    shadow: string
    /** "_self"/"_blank" to force where this opens, or "" to follow the href's scheme (richtext.tsx's
     *  `opensInNewTab`, the same rule in-prose links use). Trap A: absent means "". */
    target: string
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
    /** "yes" renders `fetchPriority="high" loading="eager"` — for the one image, if any, that sits
     *  above the fold. "no" (the default) renders neither attribute. */
    priority: "yes" | "no"
}
interface ContentFieldProps {
    field: string
    /** blank = use the bound field's catalog label (entity-fields.ts). Non-blank overrides it. */
    label: string
    showLabel: "yes" | "no"
    /** Where the value sits relative to its label: on the same line ("inline", the pre-existing behavior
     *  and the default, so designs stored before this field existed are unaffected), always stacked
     *  underneath it ("below"), or stacked only while the field's own container is narrow ("auto" — a
     *  container query, see compositor.css). Optional — undefined on any such older design, so `render`
     *  defaults it defensively rather than relying on `defaultProps`, which Puck applies only to newly
     *  inserted components. */
    valuePlacement?: ValuePlacement
    typography: string
    /** What to render when the bound value is empty (see {@link isEmptyFieldValue}): leave the row as-is
     *  (label per `showLabel`, blank value — the pre-existing behavior, and the default so old designs
     *  are unaffected), hide just the label (blank value, no label), or substitute `emptyValue`. */
    onEmpty: "doNothing" | "hideLabel" | "placeholder"
    /** Shown in place of the value when empty and `onEmpty` is "placeholder". */
    emptyValue: string
    /** Prepended to the value with no separator — used verbatim, never trimmed, so a trailing space is
     *  how an author encodes "Op. ". Optional, defaulted to "" defensively in `render` (added after
     *  `ContentField` existed, so `defaultProps` alone would not reach older stored designs). Suppressed
     *  whenever the value is empty, so every `onEmpty` outcome (including the "placeholder" substitution)
     *  renders without it. */
    prefix?: string
    /** "yes" wraps prefix+value in an `<a>` to `linkHref`, replacing (not nesting inside) any anchor the
     *  bound field's own kind would otherwise render — nested `<a>` is invalid HTML. Inert when the kind
     *  injects its own anchor markup ({@link rendersOwnAnchors}: `uri`, `citations`) — lint flags that.
     *  Optional, defaulted to "no" defensively in `render`, same back-compat reasoning as `prefix`. */
    forceLink?: "yes" | "no"
    /** The forced link's href, live only when `forceLink` is "yes" and this is non-blank. An unsafe
     *  scheme is sanitized to "#" (matches `renderButtonTag`); target follows `opensInNewTab`'s scheme
     *  rule with no override, per the outlet's "auto mechanism" design. Optional, defaulted to "" in
     *  `render`, same back-compat reasoning as `prefix`. */
    linkHref?: string
}
interface PagefindSearchProps {
    /** "site" (the default, and search.astro's untagged behavior) searches every indexed public page;
     *  "database" restricts to pages carrying `data-pagefind-filter="scope:database"` (see search.astro
     *  and layouts/PublicPage.astro's `pagefindFilter` prop) — the three entity nouns' index/detail pages. */
    scope: "site" | "database"
    /** Auxiliary link rendered below the search bar: "none" (the default) shows nothing extra, "search" and
     *  "advanced" link to that page — mode switching, so an editor can send a visitor from this simple bar
     *  toward the fuller search experience. Optional — undefined on any design stored before this field
     *  existed, defaulted defensively in `render`, not just `defaultProps`, for that back-compat. */
    advancedLink?: "none" | "search" | "advanced"
    /** Pre-existing fields from the old inline `<details>` advanced panel, replaced by `advancedLink` (the
     *  panel duplicated the same criteria form /search/advanced itself owns — see that page and
     *  DatabaseRoot.astro, which dropped their own copies of it the same way). Kept only so a design stored
     *  before this change still resolves to an equivalent `advancedLink` value in `render`, never read
     *  anywhere else. */
    display?: "simple" | "advanced"
    showToggle?: "yes" | "no"
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
    /** "yes" renders `fetchPriority="high" loading="eager"` — for the one image, if any, that sits
     *  above the fold. "no" (the default) renders neither attribute. */
    priority: "yes" | "no"
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

/** Builds the Puck config for the given theme, target, and per-entry context (pivot D7). Component
 * set/props are the frozen catalog v1 plus the content outlets; select options draw from `theme`.
 * `target` governs only the two editor-only fields (RichText `body`, Image `media`). Outlet renders
 * read the routed entry from the `context` closure — no clone-and-fill, no React context — so the
 * zero-JS build path is untouched; with no context (a `design_page`) outlets render nothing (build) or
 * a placeholder (editor). */
export function buildConfig(theme: TokenCatalog, target: CatalogTarget, context?: BuildConfigContext): Config {
    const isEditor = target === "editor"

    // One storage key resolves to a different URL per target: public media origin at build (page is
    // anonymous, /_emdash proxy is Access-gated), same-origin proxy in the editor (admin is
    // Access-authenticated, public origin isn't in the client bundle). Getting this backwards ships a
    // broken <img>.
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
                columnGap: tokenSelect(theme, "space", "Column gap (horizontal)"),
                rowGap: tokenSelect(theme, "space", "Row gap (vertical)"),
                col1: { type: "slot" as const },
                col2: { type: "slot" as const },
                col3: { type: "slot" as const },
                col4: { type: "slot" as const }
            },
            defaultProps: { count: 2, columnGap: "md", rowGap: "md", col1: [], col2: [], col3: [], col4: [] },
            render: ({ count, columnGap, rowGap, col1: Col1, col2: Col2, col3: Col3, col4: Col4 }: ColumnsProps) => {
                const cols = [Col1, Col2, Col3, Col4].slice(0, count)
                return (
                    <div
                        className="cmp-columns"
                        style={vars({
                            "--cmp-columns-count": String(count),
                            "--cmp-columns-column-gap": tokenVar("space", columnGap),
                            "--cmp-columns-row-gap": tokenVar("space", rowGap)
                        })}
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
                columnGap: tokenSelect(theme, "space", "Column gap (horizontal)"),
                rowGap: tokenSelect(theme, "space", "Row gap (vertical)"),
                content: { type: "slot" as const }
            },
            defaultProps: { columnGap: "md", rowGap: "md", content: [] },
            // The only explicit horizontal container (see module header's flow-invariant note): children
            // lay out left-to-right and wrap, regardless of each child's own intrinsic CSS display.
            // `cmp-row` styles the slot's own wrapper directly, not an outer div — Puck's slot items are
            // direct children of that wrapper with no further nesting, so it must be the flex container
            // for the gaps to land between items. `rowGap` only shows once the row wraps.
            render: ({ columnGap, rowGap, content: Content }: RowProps) => (
                <Content
                    className="cmp-row"
                    style={vars({
                        "--cmp-row-column-gap": tokenVar("space", columnGap),
                        "--cmp-row-row-gap": tokenVar("space", rowGap)
                    })}
                />
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
                shadow: tokenSelect(theme, "shadows", "Shadow", true),
                priority: imagePrioritySelect()
            },
            // "full" preserves this component's pre-existing (unstyled, max-width:100%) behavior.
            defaultProps: { alt: "", aspect: "original", size: "full", radius: "", border: "", shadow: "", priority: "no" },
            render: ({ media, alt, aspect, size, radius, border, shadow, priority }: ImageProps) => {
                if (!media?.storageKey || !isSafeStorageKey(media.storageKey)) return null
                const url = resolveMediaUrl(media.storageKey)
                return renderImageTag(
                    url,
                    alt,
                    media.width || undefined,
                    media.height || undefined,
                    aspect,
                    size,
                    radius,
                    border,
                    shadow,
                    priority === "yes"
                )
            }
        },
        Button: {
            label: "Button",
            fields: {
                label: { type: "text" as const, label: "Label" },
                href: { type: "text" as const, label: "Link URL" },
                // Same three-way choice a rich-text link resolves through, surfaced as a field because a
                // Button has nowhere else to express it. "Automatic" keeps a button consistent with the
                // same URL written in prose.
                target: {
                    type: "select" as const,
                    label: "Opens in",
                    options: [
                        { label: "Automatic (new tab if external)", value: "" },
                        { label: "Same tab", value: "_self" },
                        { label: "New tab", value: "_blank" }
                    ]
                },
                variant: tokenSelect(theme, "buttonVariants", "Variant"),
                shadow: tokenSelect(theme, "shadows", "Shadow", true)
            },
            // "primary" is a seeded variant name (theme is authored before this code deploys), so the
            // default resolves. The render stays pure — it maps a variant name into `--cmp-button-*`
            // locals and never sees the theme, exactly like Spacer/Divider (catalog purity rule).
            defaultProps: { label: "Button", href: "#", target: "", variant: "primary", shadow: "" },
            render: ({ label, href, variant, shadow, target }: ButtonProps) =>
                renderButtonTag(label, href, variant, shadow, target)
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
            // Home, then each ancestor crumb (linked, or plain text when href is null — the "Posts"
            // case), then the page title as the final unlinked crumb. No route context (editor
            // previewing a template) → illustrative fallback trail.
            render: () => {
                const ancestors = context?.breadcrumbs
                const pageTitle = context?.pageTitle
                if (ancestors === undefined && pageTitle === undefined && isEditor) {
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
                },
                advancedLink: {
                    type: "select" as const,
                    label: "Link below search bar",
                    options: [
                        { label: "None", value: "none" },
                        { label: "Link to /search", value: "search" },
                        { label: "Link to /search/advanced", value: "advanced" }
                    ]
                }
            },
            defaultProps: { scope: "site", advancedLink: "none" },
            // Plain GET form — native browser navigation, no client JS (catalog purity rule). `advancedLink`
            // defaults in the destructure (not just `defaultProps`), and old `display`/`showToggle` values
            // (pre-dating this field) are mapped onto it, so a design stored before this change still shows
            // an advanced-search link rather than silently losing that access.
            render: ({ scope, advancedLink, display, showToggle }: PagefindSearchProps) => {
                const resolvedAdvancedLink =
                    advancedLink ?? (showToggle === "yes" || display === "advanced" ? "advanced" : "none")
                return (
                    <form className="search-form" action="/search" method="get">
                        {scope === "database" && <input type="hidden" name="scope" value="database" />}
                        <input type="search" name="q" placeholder="Search…" aria-label="Search" autoComplete="off" />
                        <button type="submit">Search</button>
                        {resolvedAdvancedLink !== "none" && (
                            <p className="search-advanced-link">
                                <a href={resolvedAdvancedLink === "advanced" ? "/search/advanced" : "/search"}>
                                    Advanced search →
                                </a>
                            </p>
                        )}
                    </form>
                )
            }
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
                shadow: tokenSelect(theme, "shadows", "Shadow", true),
                priority: imagePrioritySelect()
            },
            // "full" preserves this outlet's pre-existing (unstyled, max-width:100%) behavior.
            defaultProps: { field: "", aspect: "original", size: "full", radius: "", border: "", shadow: "", priority: "no" },
            render: ({ field, aspect, size, radius, border, shadow, priority }: ContentImageProps) => {
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
                    return renderImageTag(url, alt, width, height, aspect, size, radius, border, shadow, priority === "yes")
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
                valuePlacement: {
                    type: "select" as const,
                    label: "Value placement",
                    options: [
                        { label: "Inline with the label", value: "inline" },
                        { label: "Below the label when narrow", value: "auto" },
                        { label: "Always below the label", value: "below" }
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
                emptyValue: { type: "text" as const, label: "Placeholder value (when empty)" },
                prefix: { type: "text" as const, label: "Value prefix (optional)" },
                forceLink: {
                    type: "select" as const,
                    label: "Force hyperlink",
                    options: [
                        { label: "No", value: "no" },
                        { label: "Yes", value: "yes" }
                    ]
                },
                linkHref: { type: "text" as const, label: "Link URL (when forced)" }
            },
            // "doNothing"/"inline" preserve this outlet's pre-existing behavior (label per showLabel, blank
            // value, both on one line).
            defaultProps: {
                field: "",
                label: "",
                showLabel: "yes",
                valuePlacement: "inline",
                typography: "body",
                onEmpty: "doNothing",
                emptyValue: "(none)",
                prefix: "",
                forceLink: "no",
                linkHref: ""
            },
            render: ({
                field,
                label,
                showLabel,
                valuePlacement,
                typography,
                onEmpty,
                emptyValue,
                prefix,
                forceLink,
                linkHref
            }: ContentFieldProps) => {
                if (!field) return isEditor ? <OutletPlaceholder field={field} /> : null
                if (isEditor && !context?.entry) return <OutletPlaceholder field={field} />

                const catalogField = context?.fields?.find((candidate) => candidate.slug === field)
                const displayLabel = label.trim() !== "" ? label.trim() : (catalogField?.label ?? "")
                const value = context?.entry ? context.entry[field] : undefined
                const empty = isEmptyFieldValue(value, catalogField?.type)
                // Forced link replaces (never nests inside) any anchor the value's own kind would
                // otherwise render, and is inert on kinds that inject their own anchor markup.
                const linked =
                    forceLink === "yes" &&
                    typeof linkHref === "string" &&
                    linkHref.trim() !== "" &&
                    !rendersOwnAnchors(value, catalogField?.type)
                const formatted =
                    empty && onEmpty === "placeholder" ? emptyValue : formatFieldValue(value, catalogField?.type, linked)
                const hideLabel = showLabel === "no" || displayLabel === "" || (empty && onEmpty === "hideLabel")
                // Prefix is used verbatim (a trailing space is how an author encodes "Op. ") and
                // suppressed on empty so every onEmpty outcome, including "placeholder", renders without it.
                const prefixText = !empty && prefix ? prefix : ""
                const content = (
                    <>
                        {prefixText}
                        {formatted}
                    </>
                )
                const safeHref = linked ? sanitizeHref(linkHref) : null
                const newTab = safeHref !== null && opensInNewTab(safeHref)

                return (
                    <div
                        className={`cmp-field${fieldPlacementClass(valuePlacement)}`}
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
                        <span className="cmp-field__value">
                            {safeHref !== null ? (
                                <a href={safeHref} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener noreferrer" : undefined}>
                                    {content}
                                </a>
                            ) : (
                                content
                            )}
                        </span>
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
                priority: imagePrioritySelect(),
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
                priority: "no",
                content: []
            },
            // Concern #3 (missing images): when the bound field resolves to no usable source, the media
            // side is simply not rendered — no dead column, no reserved space. `content` then occupies the
            // whole row, matching the collapsing-primitive design (see plan / module header).
            render: ({ field, aspect, imagePosition, size, radius, border, shadow, priority, content: Content }: MediaTextProps) => {
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
                                    shadow,
                                    priority === "yes"
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
