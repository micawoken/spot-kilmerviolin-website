/**
 * components/compositor/ThemeEditor.tsx
 *
 * React component for the design theme editor
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

import { useEffect, useMemo, useRef, useState } from "react"

import { TOKEN_PROPS, TOKEN_USAGE_NOTES, tokenKindUsers } from "../../lib/compositor/catalog"
import { errorMessage } from "../../lib/compositor/design-list"
import { collectTokenUsage } from "../../lib/compositor/lint"
import { migrateDesign } from "../../lib/compositor/migrations"
import {
    columnsStackBreakpointCss,
    isTokenCatalog,
    tokensToCss,
    type SiteChromeRoles,
    type TokenCatalog,
    type TokenKind
} from "../../lib/compositor/tokens"
import { formatLightDark, parseLightDark } from "../../lib/compositor/theme-controls"
import type { DesignDoc } from "../../lib/compositor/types"
import { CellControl, RefSelect, type FieldSpec } from "./ThemeEditorControls"
import {
    BorderSwatches,
    BreakpointScale,
    ButtonVariantSamples,
    ColorReference,
    RadiusSwatches,
    ResponsivePreviewFrame,
    ShadowSwatches,
    SiteChromeContrastCheck,
    SpacingScale,
    TypographySpecimen
} from "./ThemePreview"

import "./design-editor.css"
// Vite `?raw` yields the file's text, same mechanism as DesignEditor.tsx's Puck canvas iframe. Styles
// the live preview specimens below via a plain `<style>` in the admin document (admin CSP allows
// `style-src 'self' 'unsafe-inline'`). stripCssComments keeps the source files' dev comments out of that
// document — see lib/compositor/css.ts.
import { stripCssComments } from "../../lib/compositor/css"
import rawCompositorCss from "../../lib/compositor/compositor.css?raw"
// The PagefindSearch component's shared form styles (styles/search-form.css) — same `?raw` route, since
// a bare `@import` in compositorCss would not survive that transform.
import rawSearchFormCss from "../../styles/search-form.css?raw"

const compositorCss = stripCssComments(rawCompositorCss)
const searchFormCss = stripCssComments(rawSearchFormCss)

const DESIGN_THEME = "/_emdash/api/content/design_theme"

/** Editable row: every token value is a string in the form; optional empties are dropped on save. */
type Row = Record<string, string>

/**
 * A web-font row. Fonts aren't tokens (not a `TokenKind`), so they sit beside the kind-keyed rows,
 * edited/serialized separately. `weights` is comma-separated in the form, parsed to `number[]` on save —
 * storing it as a string would fail `isTokenCatalog` and unstyle every design page.
 */
interface FontRow {
    family: string
    weights: string
}

/**
 * Site Chrome roles as edited: every role a plain string field, `""` meaning unset. Excludes deprecated
 * `horizontalSpace` — a read-only migration source (see `toEditable`), never a form field.
 */
type SiteChromeRow = Record<Exclude<keyof SiteChromeRoles, "horizontalSpace">, string>

/** The catalog as edited: rows per kind, the web-font rows, and the preserved catalog schema version. */
type EditableCatalog = {
    schemaVersion: number
    colorScheme: "adaptive" | "fixed"
    fonts: FontRow[]
    siteChrome: SiteChromeRow
    /** names a `breakpoints` token driving Columns' stack point; "" keeps the historical fixed 768px. */
    layoutStackBreakpoint: string
    /** whether cross-document view transitions are enabled site-wide; defaults true (historical always-on
     *  behavior) when unset. */
    viewTransitions: boolean
} & Record<TokenKind, Row[]>

/** The token kinds and their fields (§4.3), in the order they render. Drives load, edit, and save. */
const SECTIONS: Array<{ kind: TokenKind; label: string; fields: FieldSpec[] }> = [
    { kind: "colors", label: "Colors", fields: [{ key: "name", label: "Name" }, { key: "value", label: "Value", color: true, control: "color" }] },
    {
        kind: "typography",
        label: "Typography",
        fields: [
            { key: "name", label: "Name" },
            { key: "family", label: "Font family", control: "family" },
            { key: "size", label: "Size", control: "clamp" },
            { key: "weight", label: "Weight", control: "weight" },
            { key: "lineHeight", label: "Line height", control: "length", allowUnitless: true },
            { key: "letterSpacing", label: "Letter spacing", optional: true, control: "length" },
            { key: "italic", label: "Italic", control: "checkbox", valueType: "boolean" },
            // Overrides `weight` above for this property only, when checked; unchecking restores it.
            { key: "bold", label: "Bold", control: "checkbox", valueType: "boolean" },
            { key: "underline", label: "Underline", control: "checkbox", valueType: "boolean" },
            { key: "lineThrough", label: "Strikethrough", control: "checkbox", valueType: "boolean" },
            { key: "overline", label: "Overline", control: "checkbox", valueType: "boolean" },
            { key: "textTransform", label: "Text transform", control: "transform", optional: true }
        ]
    },
    { kind: "space", label: "Spacing", fields: [{ key: "name", label: "Name" }, { key: "value", label: "Value", control: "length" }] },
    { kind: "radius", label: "Radius", fields: [{ key: "name", label: "Name" }, { key: "value", label: "Value", control: "length" }] },
    {
        kind: "borders",
        label: "Borders",
        fields: [
            { key: "name", label: "Name" },
            { key: "width", label: "Width", control: "length" },
            { key: "style", label: "Style", control: "style" },
            { key: "colorRef", label: "Color token" }
        ]
    },
    { kind: "shadows", label: "Shadows", fields: [{ key: "name", label: "Name" }, { key: "value", label: "Value", control: "shadow" }] },
    { kind: "breakpoints", label: "Breakpoints", fields: [{ key: "name", label: "Name" }, { key: "minWidth", label: "Min width", control: "length" }] },
    {
        kind: "buttonVariants",
        label: "Button variants",
        fields: [
            { key: "name", label: "Name" },
            { key: "background", label: "Background", refKind: "colors" },
            { key: "text", label: "Text", refKind: "colors" },
            { key: "border", label: "Border", refKind: "borders", optional: true },
            { key: "radius", label: "Radius", refKind: "radius" },
            { key: "paddingX", label: "Padding X", refKind: "space" },
            { key: "paddingY", label: "Padding Y", refKind: "space" }
        ]
    }
]

/** Site Chrome roles in render order. 3 tables: colors/borders/typography all under Site Chrome (one
 * place for every interface-component binding); `space` split H/V under Spacing next to the tokens it
 * references. */
const SITE_CHROME_ROLES: Array<{ key: keyof SiteChromeRow; label: string; kind: "colors" | "borders" | "space" | "typography" }> = [
    { key: "pageBackground", label: "Page background", kind: "colors" },
    { key: "bodyText", label: "Body text", kind: "colors" },
    { key: "linkColor", label: "Link color", kind: "colors" },
    { key: "linkHoverColor", label: "Link hover color", kind: "colors" },
    { key: "mutedText", label: "Muted text (nav / footer)", kind: "colors" },
    { key: "footerBackground", label: "Footer background", kind: "colors" },
    { key: "hairlineBorder", label: "Hairline border", kind: "borders" },
    {
        key: "headingTypography",
        label: "Page heading (static pages, Portable Text — Puck page titles use their own Heading field instead)",
        kind: "typography"
    },
    { key: "horizontalSpaceInset", label: "Page edge inset (header, footer)", kind: "space" },
    {
        key: "horizontalSpaceContentInset",
        label: "Main content inset (article body, cmp-section, static pages — independent of the page edge inset above)",
        kind: "space"
    },
    {
        key: "horizontalSpaceItemGap",
        label: "List & grid item gap (nav links, footer links, tile / card grids)",
        kind: "space"
    },
    {
        key: "horizontalSpaceControl",
        label: "Control padding & gap (search boxes, tiles, list-result cards)",
        kind: "space"
    },
    {
        key: "verticalSpaceSection",
        label: "Section rhythm (main content, grid/form margins)",
        kind: "space"
    },
    {
        key: "verticalSpaceHeader",
        label: "Header rhythm (site header nav padding)",
        kind: "space"
    },
    {
        key: "verticalSpaceFooter",
        label: "Footer rhythm (site footer padding & top margin)",
        kind: "space"
    },
    {
        key: "verticalSpaceItemGap",
        label: "List & grid item gap (stacked nav rows, tile / card grid rows, search results)",
        kind: "space"
    },
    {
        key: "verticalSpaceControl",
        label: "Control padding & gap (search boxes, tiles, list-result cards, small captions)",
        kind: "space"
    },
    {
        key: "verticalSpaceStatic",
        label: "Static-page nudge (added on top of Section rhythm above — entity/database index, search, search/advanced only)",
        kind: "space"
    }
]

/** The three split horizontal-spacing roles, for the one-time `horizontalSpace` migration in `toEditable`. */
const HORIZONTAL_SPACE_ROLE_KEYS = new Set<keyof SiteChromeRow>([
    "horizontalSpaceInset",
    "horizontalSpaceItemGap",
    "horizontalSpaceControl"
])

/** Candidate names to auto-suggest for a Site Chrome role when the catalog never set `siteChrome`
 * (predates the feature). Each role tries candidates in order, takes the first present in the catalog;
 * no match leaves it unset rather than guessing wrong. Mirrors the magic names hardcoded in
 * `public-chrome.css`/`search.astro` before Site Chrome existed — a one-time migration aid, not a
 * permanent default. */
const LEGACY_CHROME_NAME_CANDIDATES: Record<keyof SiteChromeRow, string[]> = {
    pageBackground: ["parchment", "paper"],
    bodyText: ["ink"],
    linkColor: ["garnet"],
    linkHoverColor: [],
    mutedText: ["slate"],
    footerBackground: ["surface"],
    hairlineBorder: ["hairline"],
    headingTypography: ["display"],
    // No legacy magic name for these: an old singular `horizontalSpace` value is handled separately in
    // toEditable (seeds all three), not via this candidate list.
    horizontalSpaceInset: [],
    // Brand new role, split out from horizontalSpaceInset — no prior dial of any kind to migrate from.
    horizontalSpaceContentInset: [],
    horizontalSpaceItemGap: [],
    horizontalSpaceControl: [],
    // No legacy name or prior singular dial for vertical roles either — ship split from the start.
    verticalSpaceSection: [],
    verticalSpaceHeader: [],
    verticalSpaceFooter: [],
    verticalSpaceItemGap: [],
    verticalSpaceControl: [],
    verticalSpaceStatic: []
}

/** Converts a validated catalog into the string-row form the editor mutates. */
function toEditable(catalog: TokenCatalog): EditableCatalog {
    const rows: Partial<Record<TokenKind, Row[]>> = {}
    for (const section of SECTIONS) {
        // Rows are edited generically (kind → fields), so token unions are read as bags of fields —
        // every read below is typeof-guarded, widening away the union safely. `?? []` covers optional
        // kinds (buttonVariants) absent from a theme predating them.
        rows[section.kind] = ((catalog[section.kind] ?? []) as unknown as Array<Record<string, unknown>>).map((token) => {
            const row: Row = {}
            for (const field of section.fields) {
                const value = token[field.key]
                row[field.key] = field.valueType === "boolean" ? (value === true ? "true" : "") : typeof value === "string" ? value : ""
            }
            return row
        })
    }
    const fonts: FontRow[] = (catalog.fonts ?? []).map((font) => ({
        family: font.family,
        weights: (font.weights ?? []).join(", ")
    }))

    // Every role empty-string by default; if the catalog never had siteChrome (not even `{}`), suggest
    // matches from the legacy magic-name convention as a one-time migration aid.
    const chrome = catalog.siteChrome
    const colorNames = new Set(catalog.colors.map((token) => token.name))
    const borderNames = new Set(catalog.borders.map((token) => token.name))
    const spaceNames = new Set(catalog.space.map((token) => token.name))
    const typographyNames = new Set(catalog.typography.map((token) => token.name))
    const namesByKind = { colors: colorNames, borders: borderNames, space: spaceNames, typography: typographyNames }
    const siteChrome = Object.fromEntries(
        SITE_CHROME_ROLES.map(({ key, kind }) => {
            if (chrome?.[key]) return [key, chrome[key]]
            // One-time migration: a catalog predating the horizontalSpace split has only the singular
            // value — seed all three roles from it so an already-configured theme doesn't silently revert
            // to the built-in fallback. Only fires while split roles are unset; Save always rewrites
            // siteChrome from the rows (see toCatalog), so the legacy value is never read again.
            if (HORIZONTAL_SPACE_ROLE_KEYS.has(key) && chrome?.horizontalSpace) return [key, chrome.horizontalSpace]
            if (chrome !== undefined) return [key, ""]
            const names = namesByKind[kind]
            const suggestion = LEGACY_CHROME_NAME_CANDIDATES[key].find((name) => names.has(name))
            return [key, suggestion ?? ""]
        })
    ) as SiteChromeRow

    return {
        schemaVersion: catalog.schemaVersion,
        // Absent means adaptive (the trap-A default): an older theme authored light-dark() colors.
        colorScheme: catalog.colorScheme ?? "adaptive",
        fonts,
        siteChrome,
        layoutStackBreakpoint: catalog.layoutStackBreakpoint ?? "",
        // Absent means enabled (the trap-A default): the site's original always-on global.css rule.
        viewTransitions: catalog.viewTransitions ?? true,
        ...(rows as Record<TokenKind, Row[]>)
    }
}

/** Rebuilds the stored catalog from the edited rows, dropping empty optional fields. */
function toCatalog(editable: EditableCatalog): TokenCatalog {
    const catalog: Record<string, unknown> = {
        schemaVersion: editable.schemaVersion,
        colorScheme: editable.colorScheme
    }
    for (const section of SECTIONS) {
        catalog[section.kind] = editable[section.kind].map((row) => {
            const token: Record<string, string | boolean> = {}
            for (const field of section.fields) {
                const value = row[field.key] ?? ""
                if (field.valueType === "boolean") {
                    // Absent (false) matches pre-existing behavior (trap A): only emit when checked.
                    if (value === "true") token[field.key] = true
                    continue
                }
                if (field.optional && value.trim() === "") continue
                token[field.key] = value
            }
            return token
        })
    }
    // Fonts serialize apart from the kind loop: `weights` parses from its comma-separated string to
    // distinct positive integers (non-numbers dropped); no valid weight omits the key, defaults to 400
    // on render. Blank family drops the row.
    catalog.fonts = editable.fonts
        .map((row) => {
            const family = row.family.trim()
            const weights = [
                ...new Set(
                    row.weights
                        .split(",")
                        .map((weight) => Number.parseInt(weight.trim(), 10))
                        .filter((weight) => Number.isInteger(weight) && weight > 0 && weight <= 1000)
                )
            ]
            return weights.length > 0 ? { family, weights } : { family }
        })
        .filter((font) => font.family !== "")

    // Only non-empty roles kept; an all-unset chrome mapping omits the field entirely (trap A), so an
    // unmigrated theme keeps falling back to the legacy magic-name lookup in the consuming CSS.
    const chromeEntries = Object.entries(editable.siteChrome).filter(([, value]) => value.trim() !== "")
    if (chromeEntries.length > 0) catalog.siteChrome = Object.fromEntries(chromeEntries)

    if (editable.layoutStackBreakpoint.trim() !== "") catalog.layoutStackBreakpoint = editable.layoutStackBreakpoint

    // Only emit when disabled (the non-default): an untouched theme stays absent, matching the trap-A
    // contract every other optional field here follows.
    if (!editable.viewTransitions) catalog.viewTransitions = false

    return catalog as unknown as TokenCatalog
}

/** A blank row for a kind (all fields empty). */
function blankRow(kind: TokenKind): Row {
    const section = SECTIONS.find((candidate) => candidate.kind === kind)!
    const row: Row = {}
    for (const field of section.fields) row[field.key] = ""
    return row
}

/** Loads the theme item id, its draft-overlaid tokens, revision token, and how many themes exist. */
async function fetchTheme(): Promise<{ id: string; catalog: TokenCatalog; rev: string | undefined; count: number }> {
    const list = await fetch(`${DESIGN_THEME}?limit=100`, { headers: { Accept: "application/json" } })
    if (!list.ok) throw new Error(`Could not list themes: ${await errorMessage(list)}`)
    const listBody = (await list.json()) as { data?: { items?: Array<{ id: string }> } }
    const items = listBody.data?.items ?? []
    if (items.length === 0) throw new Error("No theme item exists. Run the design-collection setup tool to seed one.")

    const id = items[0].id
    const get = await fetch(`${DESIGN_THEME}/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } })
    if (!get.ok) throw new Error(`Could not load the theme: ${await errorMessage(get)}`)
    const getBody = (await get.json()) as { data?: { item?: { data?: { tokens?: unknown } }; _rev?: string } }
    const tokens = getBody.data?.item?.data?.tokens
    if (!isTokenCatalog(tokens)) throw new Error("The stored theme is not a valid token catalog and cannot be edited here.")
    return { id, catalog: tokens, rev: getBody.data?._rev, count: items.length }
}

/** The design collections whose token references the usage scan counts. Drafts count too (see below). */
const USAGE_COLLECTIONS = ["design_page", "design_template"] as const

/** Scans every design (pages and templates, INCLUDING drafts — a draft referencing a token breaks the
 * moment it's published) for token references, so the editor can show how many designs a rename/removal
 * would strip. Fail-soft: a read error propagates to the caller, which falls back to the static warning
 * rather than breaking the editor over a lost advisory count. */
async function fetchDesignUsage(): Promise<Map<string, string[]>> {
    const docs: { label: string; doc: DesignDoc }[] = []
    for (const collection of USAGE_COLLECTIONS) {
        const res = await fetch(`/_emdash/api/content/${collection}?limit=100`, { headers: { Accept: "application/json" } })
        if (!res.ok) throw new Error(`Could not list ${collection}: ${await errorMessage(res)}`)
        const body = (await res.json()) as {
            data?: { items?: Array<{ id: string; slug?: string; data?: { title?: unknown; design?: unknown } }> }
        }
        for (const item of body.data?.items ?? []) {
            const title = item.data?.title
            const label = typeof title === "string" && title.trim() !== "" ? title : (item.slug ?? item.id)
            docs.push({ label, doc: migrateDesign(item.data?.design) })
        }
    }
    return collectTokenUsage(docs, TOKEN_PROPS)
}

/** localStorage key for the raw/friendly view preference, so a developer's choice sticks across visits. */
const RAW_MODE_KEY = "theme-editor:raw-mode"

/** Every collapsible section's stable id, in render order. A token-kind section reuses its
 * `TokenKind`; the rest are hand-picked ids for sections rendered inline below (Backup & restore, Page
 * transitions, Site Chrome, Web fonts) rather than via `renderTokenSection`. */
const SECTION_IDS = [
    "backup",
    "page-transitions",
    "colors",
    "site-chrome",
    "typography",
    "web-fonts",
    "space",
    "radius",
    "borders",
    "shadows",
    "breakpoints",
    "buttonVariants"
] as const

/** localStorage key for which sections are collapsed, so a developer's layout sticks across visits. */
const COLLAPSED_SECTIONS_KEY = "theme-editor:collapsed-sections"

/** Reads the persisted collapsed-section ids, guarded the same way `rawMode` is (private mode / bad JSON). */
function loadCollapsedSections(): Set<string> {
    try {
        const stored = localStorage.getItem(COLLAPSED_SECTIONS_KEY)
        if (!stored) return new Set()
        const parsed = JSON.parse(stored) as unknown
        return Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === "string")) : new Set()
    } catch {
        return new Set()
    }
}

/** A section's clickable heading: chevron + `<h3>`, toggling collapsed state. Button spans the whole
 * header, not a small icon target — the point: this page is long, needs coarse, fast-to-hit collapse. */
function SectionHeader({ id, title, open, onToggle }: { id: string; title: string; open: boolean; onToggle: (id: string) => void }) {
    return (
        <button
            type="button"
            className="theme-editor__section-toggle"
            aria-expanded={open}
            onClick={() => onToggle(id)}
        >
            <span className="theme-editor__section-icon" aria-hidden="true">
                {open ? "▾" : "▸"}
            </span>
            <h3>{title}</h3>
        </button>
    )
}

/** The theme editor. */
export default function ThemeEditor() {
    const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading")
    const [loadError, setLoadError] = useState("")
    const [id, setId] = useState("")
    const [rev, setRev] = useState<string | undefined>(undefined)
    const [count, setCount] = useState(1)
    const [editable, setEditable] = useState<EditableCatalog | null>(null)
    const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle")
    const [message, setMessage] = useState("")
    // `"<kind>:<name>"` → design labels using that token; null until the scan succeeds — editor falls
    // back to the static rename warning (fetchDesignUsage is fail-soft).
    const [usage, setUsage] = useState<Map<string, string[]> | null>(null)
    // Backup/restore status, shown beside the export/import buttons; null before either is used.
    const [ioStatus, setIoStatus] = useState<{ text: string; error: boolean } | null>(null)
    // A hidden file input the "Import JSON…" button opens; kept out of the layout (imports are rare).
    const fileInputRef = useRef<HTMLInputElement>(null)
    // Raw view = CSS-native inputs; off = friendly controls. Persisted so the choice sticks. Read
    // lazily, guarded: localStorage can throw (private mode); a bad value is just "not raw".
    const [rawMode, setRawMode] = useState<boolean>(() => {
        try {
            return localStorage.getItem(RAW_MODE_KEY) === "1"
        } catch {
            return false
        }
    })
    // Which sections are collapsed, keyed by SECTION_IDS; persisted like rawMode above. Absent (not in
    // the set) means expanded — the default for a first-time visitor.
    const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsedSections)

    // Live preview CSS: the in-progress edit converted to a catalog, emitted as `--dtk-*` properties plus
    // the same stylesheet real design pages use — recomputed on every edit so a specimen always reflects
    // current form state, not the last save.
    const previewCss = useMemo(() => {
        if (!editable) return ""
        const catalog = toCatalog(editable)
        return `${tokensToCss(catalog)}\n${compositorCss}\n${searchFormCss}\n${columnsStackBreakpointCss(catalog)}`
    }, [editable])

    useEffect(() => {
        let cancelled = false
        fetchTheme()
            .then((loaded) => {
                if (cancelled) return
                setId(loaded.id)
                setRev(loaded.rev)
                setCount(loaded.count)
                setEditable(toEditable(loaded.catalog))
                setPhase("ready")
            })
            .catch((error: unknown) => {
                if (cancelled) return
                setLoadError(error instanceof Error ? error.message : String(error))
                setPhase("error")
            })
        return () => {
            cancelled = true
        }
    }, [])

    // Usage scan loads independently of the theme: a failed scan degrades to the static warning, never
    // blocks editing. Left null on error so the fallback prose shows.
    useEffect(() => {
        let cancelled = false
        fetchDesignUsage()
            .then((map) => {
                if (!cancelled) setUsage(map)
            })
            .catch(() => {
                if (!cancelled) setUsage(null)
            })
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        try {
            localStorage.setItem(RAW_MODE_KEY, rawMode ? "1" : "0")
        } catch {
            // private mode / storage disabled: the toggle still works for this session, just not persisted.
        }
    }, [rawMode])

    useEffect(() => {
        try {
            localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...collapsed]))
        } catch {
            // private mode / storage disabled: collapsing still works for this session, just not persisted.
        }
    }, [collapsed])

    if (phase === "loading") return <p>Loading theme…</p>
    if (phase === "error" || !editable) return <p className="design-editor__blocked">{loadError}</p>

    const setCell = (kind: TokenKind, index: number, key: string, value: string) => {
        setEditable((current) => {
            if (!current) return current
            const rows = current[kind].slice()
            rows[index] = { ...rows[index], [key]: value }
            return { ...current, [kind]: rows }
        })
    }

    const addRow = (kind: TokenKind) => {
        setEditable((current) => (current ? { ...current, [kind]: [...current[kind], blankRow(kind)] } : current))
    }

    const toggleSection = (id: string) => {
        setCollapsed((current) => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }
    const collapseAllSections = () => setCollapsed(new Set(SECTION_IDS))
    const expandAllSections = () => setCollapsed(new Set())

    /** The distinct design labels referencing the token (kind, name), or [] when unknown/unused. */
    const usageLabels = (kind: TokenKind, name: string): string[] => (name ? (usage?.get(`${kind}:${name}`) ?? []) : [])

    const removeRow = (kind: TokenKind, index: number) => {
        // Naming which designs would lose the style is the point of the scan (§3.1) — a silent removal
        // is what the static warning could never prevent. Only guard when uses are actually known.
        const name = editable[kind][index]?.name ?? ""
        const labels = usageLabels(kind, name)
        if (labels.length > 0) {
            const confirmed = window.confirm(
                `"${name}" is used by ${labels.length} design${labels.length === 1 ? "" : "s"}: ${labels.join(", ")}.\n` +
                    "Removing it strips that style until each design is updated. Remove anyway?"
            )
            if (!confirmed) return
        }
        setEditable((current) =>
            current ? { ...current, [kind]: current[kind].filter((_, position) => position !== index) } : current
        )
    }

    // Switches the theme between adaptive (each color a light-dark pair) and fixed (single value),
    // rewriting every color to match. adaptive→fixed drops each dark channel — confirms first, points at
    // the JSON backup. fixed→adaptive is non-destructive (seeds dark = light, editable after).
    const changeColorScheme = (next: "adaptive" | "fixed") => {
        if (!editable || editable.colorScheme === next) return
        if (next === "fixed") {
            const pairs = editable.colors.filter((row) => parseLightDark(row.value ?? "") !== null).length
            if (
                pairs > 0 &&
                !window.confirm(
                    `Switching to a fixed color scheme keeps each color's light value and discards its dark value ` +
                        `(${pairs} affected). Export a JSON backup first if you might want to undo this. Continue?`
                )
            ) {
                return
            }
        }
        setEditable((current) => {
            if (!current) return current
            const colors = current.colors.map((row) => {
                const value = row.value ?? ""
                if (value.trim() === "") return row
                if (next === "fixed") {
                    const pair = parseLightDark(value)
                    return pair ? { ...row, value: pair.light } : row
                }
                // adaptive: wrap a plain color as light-dark(value, value); leave an existing pair alone.
                return parseLightDark(value) ? row : { ...row, value: formatLightDark({ light: value, dark: value }) }
            })
            return { ...current, colorScheme: next, colors }
        })
    }

    const setFont = (index: number, key: keyof FontRow, value: string) => {
        setEditable((current) => {
            if (!current) return current
            const fonts = current.fonts.slice()
            fonts[index] = { ...fonts[index], [key]: value }
            return { ...current, fonts }
        })
    }

    const addFont = () => {
        setEditable((current) => (current ? { ...current, fonts: [...current.fonts, { family: "", weights: "" }] } : current))
    }

    const removeFont = (index: number) => {
        setEditable((current) =>
            current ? { ...current, fonts: current.fonts.filter((_, position) => position !== index) } : current
        )
    }

    // Looked up by kind so sections below render in a logical order (colors with Site Chrome, typography
    // with Web fonts) that differs from SECTIONS' declaration order, which instead drives load/save.
    const sectionByKind = Object.fromEntries(SECTIONS.map((section) => [section.kind, section])) as Record<
        TokenKind,
        (typeof SECTIONS)[number]
    >

    /** One token-kind section: its table of rows plus any kind-specific controls and live preview. */
    const renderTokenSection = (section: (typeof SECTIONS)[number]) => {
        const open = !collapsed.has(section.kind)
        return (
        <section key={section.kind} className="theme-editor__section">
            <SectionHeader id={section.kind} title={section.label} open={open} onToggle={toggleSection} />
            {open && <>
            {section.kind === "colors" && (
                <div className="theme-editor__scheme">
                    <label className="theme-editor__switch">
                        Color scheme
                        <select
                            value={editable.colorScheme}
                            onChange={(event) => changeColorScheme(event.target.value as "adaptive" | "fixed")}
                        >
                            <option value="adaptive">Adaptive (light + dark)</option>
                            <option value="fixed">Fixed (single value)</option>
                        </select>
                    </label>
                    <span className="theme-editor__hint">
                        {editable.colorScheme === "adaptive"
                            ? "Each color has a light and a dark value; the site follows the viewer's color scheme."
                            : "Each color is a single value, the same in light and dark."}
                    </span>
                </div>
            )}
            <div className="theme-editor__rows">
                {editable[section.kind].map((row, index) => {
                    const nameUses = usageLabels(section.kind, row.name ?? "")
                    return (
                        <div className="theme-editor__row" key={index}>
                            {section.fields.map((field) =>
                                field.valueType === "boolean" ? (
                                    // A boolean field's checkbox + caption are one control, not
                                    // caption-over-cell — matches .design-editor__checkbox's inline
                                    // label+input elsewhere.
                                    <label className="theme-editor__field theme-editor__checkbox" key={field.key}>
                                        <CellControl
                                            field={field}
                                            value={row[field.key] ?? ""}
                                            rawMode={rawMode}
                                            colorScheme={editable.colorScheme}
                                            refNames={field.refKind ? editable[field.refKind].map((r) => r.name) : []}
                                            fontFamilies={editable.fonts.map((font) => font.family)}
                                            onChange={(value) => setCell(section.kind, index, field.key, value)}
                                        />
                                        {field.label}
                                    </label>
                                ) : (
                                    <div className="theme-editor__field" key={field.key}>
                                        <span className="theme-editor__field-label">{field.label}</span>
                                        <span className="theme-editor__cell">
                                            {/* Friendly color control shows its own picker swatches — row
                                                swatch is only the raw view's preview. */}
                                            {field.color && (rawMode || field.control !== "color") && (
                                                <span
                                                    className="theme-editor__swatch"
                                                    style={{ background: row[field.key] || "transparent" }}
                                                    aria-hidden="true"
                                                />
                                            )}
                                            <CellControl
                                                field={field}
                                                value={row[field.key] ?? ""}
                                                rawMode={rawMode}
                                                colorScheme={editable.colorScheme}
                                                refNames={field.refKind ? editable[field.refKind].map((r) => r.name) : []}
                                                fontFamilies={editable.fonts.map((font) => font.family)}
                                                onChange={(value) => setCell(section.kind, index, field.key, value)}
                                            />
                                            {field.key === "name" && nameUses.length > 0 && (
                                                <small className="theme-editor__usage" title={nameUses.join(", ")}>
                                                    used by {nameUses.length} design{nameUses.length === 1 ? "" : "s"}
                                                </small>
                                            )}
                                        </span>
                                    </div>
                                )
                            )}
                            <div className="theme-editor__field theme-editor__field--remove">
                                <button type="button" onClick={() => removeRow(section.kind, index)}>
                                    Remove
                                </button>
                            </div>
                        </div>
                    )
                })}
            </div>
            <button type="button" onClick={() => addRow(section.kind)}>
                Add {section.label.toLowerCase().replace(/s$/, "")}
            </button>
            {section.kind === "breakpoints" && (
                <div className="theme-editor__scheme">
                    <label className="theme-editor__switch">
                        Columns stacks below
                        <RefSelect
                            names={editable.breakpoints.map((row) => row.name)}
                            value={editable.layoutStackBreakpoint}
                            optional
                            onChange={(value) =>
                                setEditable((current) => (current ? { ...current, layoutStackBreakpoint: value } : current))
                            }
                        />
                    </label>
                    <span className="theme-editor__hint">
                        {editable.layoutStackBreakpoint
                            ? `The Columns component stacks to a single column below this breakpoint's width.`
                            : "Unset: Columns stacks below the built-in 768px default."}
                    </span>
                </div>
            )}
            {section.kind === "space" && (
                <div className="theme-editor__spacing-groups">
                    <div className="theme-editor__spacing-group">
                        <h4>Horizontal spacing</h4>
                        <p className="theme-editor__hint">
                            Manage horizontal (left-right) spacing on the site. Enter values as CSS spacing, with units.
                        </p>
                        {renderChromeRoleTable(SITE_CHROME_ROLES.filter((role) => role.key.toString().startsWith("horizontalSpace")))}
                    </div>

                    <div className="theme-editor__spacing-group">
                        <h4>Vertical spacing</h4>
                        <p className="theme-editor__hint">
                            Manage vertical (top-bottom) spacing on the site. Enter values as CSS spacing, with units.
                        </p>
                        {renderChromeRoleTable(SITE_CHROME_ROLES.filter((role) => role.key.toString().startsWith("verticalSpace")))}
                    </div>
                </div>
            )}
            {editable[section.kind].some((row) => (row.name ?? "").trim() !== "") && (
                <div className="theme-preview">
                    <h4 className="theme-preview__heading">Preview</h4>
                    {TOKEN_USAGE_NOTES[section.kind] && (
                        <p className="theme-editor__hint">{TOKEN_USAGE_NOTES[section.kind]}</p>
                    )}
                    {section.kind === "colors" && (
                        <ColorReference colors={editable.colors} colorScheme={editable.colorScheme} />
                    )}
                    {section.kind === "typography" && (
                        <ResponsivePreviewFrame>
                            <TypographySpecimen
                                typography={editable.typography}
                                usedBy={tokenKindUsers("typography")}
                            />
                        </ResponsivePreviewFrame>
                    )}
                    {section.kind === "space" && (
                        <ResponsivePreviewFrame>
                            <SpacingScale space={editable.space} />
                        </ResponsivePreviewFrame>
                    )}
                    {section.kind === "radius" && <RadiusSwatches radius={editable.radius} />}
                    {section.kind === "shadows" && <ShadowSwatches shadows={editable.shadows} />}
                    {section.kind === "borders" && <BorderSwatches borders={editable.borders} />}
                    {section.kind === "breakpoints" && (
                        <BreakpointScale breakpoints={editable.breakpoints} activeName={editable.layoutStackBreakpoint} />
                    )}
                    {section.kind === "buttonVariants" && <ButtonVariantSamples variants={editable.buttonVariants} />}
                </div>
            )}
            </>}
        </section>
        )
    }

    // Downloads current editor state (normalized catalog, not necessarily published) as JSON — a manual
    // snapshot, since the theme is a singleton with no version history. Object URL revoked right after
    // the synthetic click; img-src blob: already covers it under the CSP.
    const exportJson = () => {
        const json = JSON.stringify(toCatalog(editable), null, 2)
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }))
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = `design-theme-${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
        setIoStatus({ text: "Exported the current editor state to a JSON file.", error: false })
    }

    // Loads an exported file INTO the editor (doesn't save) — user reviews then Saves/Publishes.
    // Validated with the same isTokenCatalog guard the build uses, so a malformed file is rejected
    // before replacing good rows. Parse/validation failures are reported, editor left untouched.
    const importJson = async (file: File) => {
        let parsed: unknown
        try {
            parsed = JSON.parse(await file.text())
        } catch {
            setIoStatus({ text: "That file isn't valid JSON.", error: true })
            return
        }
        if (!isTokenCatalog(parsed)) {
            setIoStatus({ text: "That file isn't a valid theme token catalog.", error: true })
            return
        }
        setEditable(toEditable(parsed))
        setIoStatus({ text: "Imported. Review the tokens, then Save draft or Publish to apply.", error: false })
    }

    const write = async (publish: boolean) => {
        setSaveState("saving")
        setMessage("")
        try {
            const tokens = toCatalog(editable)
            const put = await fetch(`${DESIGN_THEME}/${encodeURIComponent(id)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", Accept: "application/json", "X-EmDash-Request": "1" },
                body: JSON.stringify({ data: { tokens }, status: "draft", _rev: rev })
            })
            if (put.status === 409) {
                setSaveState("error")
                setMessage("The theme changed elsewhere. Reload the page to get the latest version before editing.")
                return
            }
            if (!put.ok) throw new Error(await errorMessage(put))
            const putBody = (await put.json()) as { data?: { _rev?: string } }
            setRev(putBody.data?._rev)

            if (publish) {
                const publishResponse = await fetch(`${DESIGN_THEME}/${encodeURIComponent(id)}/publish`, {
                    method: "POST",
                    headers: { Accept: "application/json", "X-EmDash-Request": "1" }
                })
                if (!publishResponse.ok) throw new Error(await errorMessage(publishResponse))
            }
            setSaveState("saved")
            setMessage(publish ? "Published. Rebuild the site to apply the theme to published pages." : "Draft saved.")
        } catch (error) {
            setSaveState("error")
            setMessage(error instanceof Error ? error.message : String(error))
        }
    }

    /** One Site Chrome role list: a row per role, each a label plus a RefSelect over its token kind. */
    const renderChromeRoleTable = (roles: typeof SITE_CHROME_ROLES) => (
        <div className="theme-editor__roles">
            {roles.map(({ key, label, kind }) => (
                <div className="theme-editor__role-row" key={key}>
                    <span className="theme-editor__role-label">{label}</span>
                    <RefSelect
                        names={editable[kind].map((row) => row.name)}
                        value={editable.siteChrome[key]}
                        optional
                        onChange={(value) =>
                            setEditable((current) =>
                                current ? { ...current, siteChrome: { ...current.siteChrome, [key]: value } } : current
                            )
                        }
                    />
                </div>
            ))}
        </div>
    )

    return (
        <div className="theme-editor">
            {/* Scoped by class (`.cmp-*`) and `--dtk-*` namespace — nothing here collides with admin
                chrome styles. Powers every specimen below. */}
            <style dangerouslySetInnerHTML={{ __html: previewCss }} />
            <div className="theme-editor__viewbar">
                <label className="theme-editor__switch">
                    <input type="checkbox" checked={rawMode} onChange={(event) => setRawMode(event.target.checked)} />
                    Show raw CSS values
                </label>
                <span className="theme-editor__hint">
                    {rawMode
                        ? "CSS controls shown"
                        : "Simple controls shown"}
                </span>
                <span className="theme-editor__viewbar-spacer" />
                <button type="button" onClick={expandAllSections}>
                    Expand all
                </button>
                <button type="button" onClick={collapseAllSections}>
                    Collapse all
                </button>
            </div>

            {count > 1 && (
                <p className="general-warning">
                    More than one theme item exists ({count}). Only the first is edited here; remove the extras in the
                    EmDash admin to avoid ambiguity.
                </p>
            )}
            {usage === null && (
                <p className="general-warning">
                    Renaming or removing a token breaks any design that references the old name — that style is lost until
                    the design is updated. Changes apply to published pages only after you publish and rebuild.
                </p>
            )}

            <section className="theme-editor__section">
                <SectionHeader id="backup" title="Backup & restore" open={!collapsed.has("backup")} onToggle={toggleSection} />
                {!collapsed.has("backup") && <>
                <p className="theme-editor__hint">
                    Export the current theme to a JSON file. When importing, remember to Save draft and Publish.
                </p>
                <div className="theme-editor__actions">
                    <button type="button" onClick={exportJson}>
                        Export JSON
                    </button>
                    <button type="button" onClick={() => fileInputRef.current?.click()}>
                        Import JSON...
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/json,.json"
                        style={{ display: "none" }}
                        onChange={(event) => {
                            const file = event.target.files?.[0]
                            // Reset so choosing the same file again re-fires onChange; do it before the async read.
                            event.target.value = ""
                            if (!file) return
                            if (
                                !window.confirm(
                                    "Importing deletes all in-progress work. Continue?"
                                )
                            ) {
                                return
                            }
                            void importJson(file)
                        }}
                    />
                    {ioStatus && (
                        <span className="design-editor__save" data-state={ioStatus.error ? "error" : "saved"}>
                            {ioStatus.text}
                        </span>
                    )}
                </div>
                </>}
            </section>

            <section className="theme-editor__section">
                <SectionHeader
                    id="page-transitions"
                    title="Page transitions"
                    open={!collapsed.has("page-transitions")}
                    onToggle={toggleSection}
                />
                {!collapsed.has("page-transitions") && <>
                <p className="theme-editor__hint">
                    Manage page transitions, viewable on supported browsers.
                </p>
                <label className="theme-editor__switch">
                    <input
                        type="checkbox"
                        checked={editable.viewTransitions}
                        onChange={(event) =>
                            setEditable((current) => (current ? { ...current, viewTransitions: event.target.checked } : current))
                        }
                    />
                    Enable page transitions
                </label>
                </>}
            </section>

            {renderTokenSection(sectionByKind.colors)}

            <section className="theme-editor__section">
                <SectionHeader
                    id="site-chrome"
                    title="Site Chrome"
                    open={!collapsed.has("site-chrome")}
                    onToggle={toggleSection}
                />
                {!collapsed.has("site-chrome") && <>
                <p className="theme-editor__hint">
                    Control which colors, borders, and typography are connected to which interface components — including
                    the public site frame's page heading (pre-generated static pages, Portable Text pages/posts).
                </p>
                {renderChromeRoleTable(SITE_CHROME_ROLES.filter((role) => role.kind !== "space"))}

                <div className="theme-preview">
                    <h4 className="theme-preview__heading">Contrast check</h4>
                    <p className="theme-editor__hint">
                        WCAG AA/AAA contrast accessibility check for the Site Chrome roles above. Red indicates failure of accessibility standard.
                    </p>
                    <SiteChromeContrastCheck
                        colors={editable.colors}
                        colorScheme={editable.colorScheme}
                        roles={{
                            pageBackground: editable.siteChrome.pageBackground,
                            bodyText: editable.siteChrome.bodyText,
                            linkColor: editable.siteChrome.linkColor,
                            linkHoverColor: editable.siteChrome.linkHoverColor,
                            mutedText: editable.siteChrome.mutedText,
                            footerBackground: editable.siteChrome.footerBackground
                        }}
                    />
                </div>
                </>}
            </section>

            {renderTokenSection(sectionByKind.typography)}

            <section className="theme-editor__section">
                <SectionHeader id="web-fonts" title="Web fonts" open={!collapsed.has("web-fonts")} onToggle={toggleSection} />
                {!collapsed.has("web-fonts") && <>
                <p className="theme-editor__hint">
                    Loads a font from Google Fonts, available for use on the site. Enter the family name exactly as Google lists it
                    (e.g. "Playfair Display") and the weights to load, comma-separated (e.g. 400, 700).
                </p>
                <div className="theme-editor__rows">
                    {editable.fonts.map((font, index) => (
                        <div className="theme-editor__row" key={index}>
                            <div className="theme-editor__field">
                                <span className="theme-editor__field-label">Font family</span>
                                <input
                                    type="text"
                                    value={font.family}
                                    placeholder="Inter"
                                    onChange={(event) => setFont(index, "family", event.target.value)}
                                />
                            </div>
                            <div className="theme-editor__field">
                                <span className="theme-editor__field-label">Weights</span>
                                <input
                                    type="text"
                                    value={font.weights}
                                    placeholder="400, 700"
                                    onChange={(event) => setFont(index, "weights", event.target.value)}
                                />
                            </div>
                            <div className="theme-editor__field theme-editor__field--remove">
                                <button type="button" onClick={() => removeFont(index)}>
                                    Remove
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
                <button type="button" onClick={addFont}>
                    Add font
                </button>
                </>}
            </section>

            {renderTokenSection(sectionByKind.space)}
            {renderTokenSection(sectionByKind.radius)}
            {renderTokenSection(sectionByKind.borders)}
            {renderTokenSection(sectionByKind.shadows)}
            {renderTokenSection(sectionByKind.breakpoints)}
            {renderTokenSection(sectionByKind.buttonVariants)}

            <div className="theme-editor__actions">
                <button type="button" onClick={() => void write(false)} disabled={saveState === "saving"}>
                    Save draft
                </button>
                <button type="button" onClick={() => void write(true)} disabled={saveState === "saving"}>
                    Publish theme
                </button>
                <span className="design-editor__save" data-state={saveState}>
                    {message}
                </span>
            </div>
        </div>
    )
}
