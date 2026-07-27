/**
 * components/compositor/DesignEditor.tsx
 *
 * The visual compositor's editor. Mounted client-side by `pages/admin/advanced/designs/edit.astro`, from a
 * module script rather than an Astro island — the admin CSP blocks Astro's inline island bootstrap.
 * Never runs on the build/RSC path (that uses `buildConfig(theme, "build")` + `<Render>`).
 *
 * Lifecycle: load the design item (draft-overlaid) and published theme → `migrateDesign` →
 * `designToEditorForm` (PT → ProseMirror) → mount `<Puck>` with `buildConfig(theme, "editor")`.
 * Autosave debounces a `PUT {status:"draft", _rev}` ~2s after the last change, chaining the fresh
 * `_rev` from each response; a stale `_rev` returns 409 and raises the conflict banner. Publish runs
 * the shared lint pass in a dialog — a11y errors block (they'd fail the build anyway) — then
 * `POST …/publish`, offering a rebuild through the same connector the manual rebuild page uses.
 *
 * Document kinds: `kind` parametrizes the same machinery over `design_page` (URL-owning layout) and
 * `design_template` (a layout entries of one collection render through). Template mode adds the
 * preview-entry picker — outlets resolve against a chosen entry, fetched draft-overlaid — and rebuilds
 * the config with `{entry, fields}` (Puck select options are static per config, so a preview change
 * remounts Puck from the current working tree). Its publish dialog blocks on the STRUCTURAL lint only
 * (entry: null); pairing rows against the preview entry are advisory — the preview is one sample, the
 * build is the real per-(template × entry) gate.
 *
 * Canvas styling: Puck renders the canvas in an iframe with `syncHostStyles: false`, so theme
 * `--dtk-*` properties and `compositor.css` are injected *inside* the iframe via the config's
 * `root.render` — no iframe/head override key exists. The editor previews against the *published*
 * theme, same tokens the build emits, so a theme edit only changes the canvas after publishing.
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Puck } from "@puckeditor/core"
import type { Config, Data } from "@puckeditor/core"

import { buildConfig, OUTLET_PROPS, RICH_TEXT_PROPS, TOKEN_PROPS } from "../../lib/compositor/catalog"
import { designToEditorForm, editorFormToDesign } from "../../lib/compositor/convert"
import { errorMessage } from "../../lib/compositor/design-list"
import { entityFields, isEntityNoun } from "../../lib/compositor/entity-fields"
import { hasBlockingError, lintDesign, type LintFinding } from "../../lib/compositor/lint"
// Type-only: erased at compile, so the build-side reader module never enters this client bundle.
import type { CollectionField } from "../../lib/build/design-api"
import { CURRENT_SCHEMA_VERSION, migrateDesign } from "../../lib/compositor/migrations"
import { columnsStackBreakpointCss, isTokenCatalog, tokensToCss, type TokenCatalog } from "../../lib/compositor/tokens"
import { cmsBoolean, type DesignDoc } from "../../lib/compositor/types"
// Vite `?raw` yields the file's text (typed via astro/client). Injected into the canvas iframe below,
// where host styles are not synced — so this is how compositor.css reaches the preview.
import compositorCss from "../../lib/compositor/compositor.css?raw"
// The PagefindSearch component's shared form styles (styles/search-form.css) — same `?raw` route, since
// a bare `@import` in compositorCss would not survive that transform.
import searchFormCss from "../../styles/search-form.css?raw"
import { rebuildSite } from "../../scripts/connector"

// puck-theme.css rebinds Puck's own semantic color tokens to the app's palette (it ships no dark mode);
// design-editor.css styles the chrome we wrap it in. Both are unlayered, so they win over Puck's
// `@layer puck-tokens` defaults without !important — see puck-theme.css.
import "./puck-theme.css"
import "./design-editor.css"

const DESIGN_PAGE = "/_emdash/api/content/design_page"
const DESIGN_TEMPLATE = "/_emdash/api/content/design_template"
const DESIGN_THEME = "/_emdash/api/content/design_theme"
const AUTOSAVE_DELAY_MS = 2000

/** Which document this editor session edits; selects the endpoint and the mode-specific UI. */
export type DocumentKind = "page" | "template"

/** Debounced-save state, surfaced as a small status line in the toolbar. */
type SaveState = "idle" | "saving" | "saved" | "error"

/** The design item's fields and revision token loaded for editing (both kinds; unused fields empty). */
interface LoadedDesign {
    doc: DesignDoc
    rev: string | undefined
    title: string
    description: string
    slug: string
    status: string
    /** template only: the collection whose entries this template renders */
    collection: string
    /** template only: this template is its collection's default */
    isDefault: boolean
}

/** The settings fields carried into every save payload. `description` is page-only, `isDefault` template-only. */
interface PageMeta {
    title: string
    description: string
    slug: string
    isDefault: boolean
}

/** The `PUT design_page/:id` / `PUT design_template/:id` body. Typed, not a loose record, so the
 * stored `design` value is held to the `DesignDoc` envelope every reader validates with
 * `migrateDesign` — writing the bare Puck tree here is what made a saved design unreadable on load. */
interface SavePayload {
    data: Record<string, unknown> & { title: string; design: DesignDoc }
    status: "draft"
    _rev: string | undefined
    slug?: string
}

/**
 * Loads the published theme (first `design_theme` item). The list endpoint returns published column
 * data only, so the editor previews against what the build will emit; a theme must be published first.
 */
async function fetchTheme(): Promise<TokenCatalog> {
    const response = await fetch(`${DESIGN_THEME}?limit=1`, { headers: { Accept: "application/json" } })
    if (!response.ok) throw new Error(`Could not load the theme: ${await errorMessage(response)}`)
    const body = (await response.json()) as { data?: { items?: Array<{ data?: Record<string, unknown> | null }> } }
    const tokens = body.data?.items?.[0]?.data?.tokens
    if (!isTokenCatalog(tokens)) {
        throw new Error("No published theme was found. Create and publish a theme on the Theme page before designing.")
    }
    return tokens
}

/** Loads one design item by id (draft-overlaid for an editor-role caller) and its revision token. */
async function fetchDesign(endpoint: string, id: string): Promise<LoadedDesign> {
    const response = await fetch(`${endpoint}/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } })
    if (!response.ok) throw new Error(`Could not load the design: ${await errorMessage(response)}`)
    const body = (await response.json()) as {
        data?: { item?: { slug?: string | null; status?: string; data?: Record<string, unknown> | null }; _rev?: string }
    }
    const item = body.data?.item
    if (!item) throw new Error("The design could not be found.")
    const fields = item.data ?? {}
    return {
        doc: migrateDesign(fields.design),
        rev: body.data?._rev,
        title: typeof fields.title === "string" ? fields.title : "",
        description: typeof fields.description === "string" ? fields.description : "",
        slug: typeof item.slug === "string" ? item.slug : "",
        status: typeof item.status === "string" ? item.status : "draft",
        collection: typeof fields.collection === "string" ? fields.collection : "",
        isDefault: cmsBoolean(fields.is_default)
    }
}

/** One row of the preview-entry picker: enough to label and fetch an entry of the template's collection. */
interface EntryListItem {
    id: string
    label: string
}

/** Lists entries of one collection for the preview picker (same-origin, first 100 — plenty here). */
async function fetchEntryList(collection: string): Promise<EntryListItem[]> {
    const response = await fetch(`/_emdash/api/content/${encodeURIComponent(collection)}?limit=100`, {
        headers: { Accept: "application/json" }
    })
    if (!response.ok) throw new Error(`Could not list ${collection}: ${await errorMessage(response)}`)
    const body = (await response.json()) as {
        data?: { items?: Array<{ id?: string; slug?: string | null; data?: Record<string, unknown> | null }> }
    }
    const entries: EntryListItem[] = []
    for (const item of body.data?.items ?? []) {
        if (typeof item.id !== "string") continue
        const title = item.data?.title
        entries.push({
            id: item.id,
            label: typeof title === "string" && title !== "" ? title : (item.slug ?? item.id)
        })
    }
    return entries
}

/** Fetches one entry draft-overlaid (editor-role GET) and returns its raw field record. */
async function fetchEntryFields(collection: string, entryId: string): Promise<Record<string, unknown>> {
    const response = await fetch(
        `/_emdash/api/content/${encodeURIComponent(collection)}/${encodeURIComponent(entryId)}`,
        { headers: { Accept: "application/json" } }
    )
    if (!response.ok) throw new Error(`Could not load the preview entry: ${await errorMessage(response)}`)
    const body = (await response.json()) as { data?: { item?: { data?: Record<string, unknown> | null } } }
    return body.data?.item?.data ?? {}
}

/** Fetches one collection's live field schema for the outlet field pickers (same shape as design-api's). */
async function fetchSchemaFields(collection: string): Promise<CollectionField[]> {
    const response = await fetch(`/_emdash/api/schema/collections/${encodeURIComponent(collection)}/fields`, {
        headers: { Accept: "application/json" }
    })
    if (!response.ok) throw new Error(`Could not load the ${collection} schema: ${await errorMessage(response)}`)
    const body = (await response.json()) as { data?: { items?: Array<Record<string, unknown>> } }
    const fields: CollectionField[] = []
    for (const item of body.data?.items ?? []) {
        if (typeof item.slug !== "string" || typeof item.type !== "string") continue
        fields.push({ slug: item.slug, label: typeof item.label === "string" ? item.label : item.slug, type: item.type })
    }
    return fields
}

/**
 * The design island. `id` is the item id (resolved server-side from the URL query); `kind` selects
 * the collection edited — `design_page` (default) or `design_template` (`edit?…&type=template`).
 */
export default function DesignEditor({ id, kind = "page" }: { id: string; kind?: DocumentKind }) {
    const endpoint = kind === "template" ? DESIGN_TEMPLATE : DESIGN_PAGE

    const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading")
    const [loadError, setLoadError] = useState("")

    const [theme, setTheme] = useState<TokenCatalog | null>(null)
    const [initialData, setInitialData] = useState<Data | null>(null)
    const [reloadKey, setReloadKey] = useState(0)

    const [meta, setMeta] = useState<PageMeta>({ title: "", description: "", slug: "", isDefault: false })
    const [status, setStatus] = useState("draft")

    const [saveState, setSaveState] = useState<SaveState>("idle")
    const [saveError, setSaveError] = useState("")
    const [conflict, setConflict] = useState(false)

    const [settingsOpen, setSettingsOpen] = useState(false)
    const [publishOpen, setPublishOpen] = useState(false)

    // Template mode: the collection schema (outlet field pickers + structural lint) and preview entry.
    const [collection, setCollection] = useState("")
    const [schemaFields, setSchemaFields] = useState<CollectionField[] | null>(null)
    const [entries, setEntries] = useState<EntryListItem[]>([])
    const [previewEntryId, setPreviewEntryId] = useState("")
    const [previewEntry, setPreviewEntry] = useState<Record<string, unknown> | null>(null)
    const [previewError, setPreviewError] = useState("")
    // Distinct from previewError: without the schema, no outlet can bind and the template can't pass
    // its own publish lint — a blocking condition, must never read as "this collection has no bindable fields".
    const [schemaError, setSchemaError] = useState("")

    // Refs are the source of truth for saving — the debounced timer never reads stale closures.
    const workingRef = useRef<Data | null>(null)
    const revRef = useRef<string | undefined>(undefined)
    const metaRef = useRef<PageMeta>({ title: "", description: "", slug: "", isDefault: false })
    const collectionRef = useRef("")
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const skipFirstChangeRef = useRef(true)

    // --- Load ------------------------------------------------------------------------------------
    useEffect(() => {
        let cancelled = false
        setPhase("loading")
        Promise.all([fetchTheme(), fetchDesign(endpoint, id)])
            .then(async ([loadedTheme, loaded]) => {
                if (cancelled) return

                // Template mode: load the collection schema and entry list BEFORE mounting Puck, so the
                // outlet field pickers are populated in the config the editor first renders with. Settled
                // independently — a schema failure mustn't also cost the entry list (unrelated reads) —
                // each reports its own consequence, an empty field picker must say why it's empty.
                let fields: CollectionField[] | null = null
                let entryList: EntryListItem[] = []
                if (kind === "template" && loaded.collection) {
                    if (isEntityNoun(loaded.collection)) {
                        // Entity collections (composer/composition/contributor) are D1-backed, not
                        // EmDash — no live schema-fields/entry-list endpoint to call. Field catalog is
                        // static (entity-fields.ts); preview-entry picker left empty rather than a 404.
                        fields = [...entityFields(loaded.collection)]
                    } else {
                        const [schemaResult, entriesResult] = await Promise.allSettled([
                            fetchSchemaFields(loaded.collection),
                            fetchEntryList(loaded.collection)
                        ])
                        if (cancelled) return
                        if (schemaResult.status === "fulfilled") {
                            fields = schemaResult.value
                        } else {
                            const reason: unknown = schemaResult.reason
                            setSchemaError(reason instanceof Error ? reason.message : String(reason))
                        }
                        if (entriesResult.status === "fulfilled") {
                            entryList = entriesResult.value
                        } else {
                            const reason: unknown = entriesResult.reason
                            setPreviewError(reason instanceof Error ? reason.message : String(reason))
                        }
                    }
                }

                const editorForm = designToEditorForm(loaded.doc, RICH_TEXT_PROPS)
                workingRef.current = editorForm.puck
                revRef.current = loaded.rev
                metaRef.current = {
                    title: loaded.title,
                    description: loaded.description,
                    slug: loaded.slug,
                    isDefault: loaded.isDefault
                }
                collectionRef.current = loaded.collection
                skipFirstChangeRef.current = true
                setTheme(loadedTheme)
                setInitialData(editorForm.puck)
                setMeta(metaRef.current)
                setStatus(loaded.status)
                setCollection(loaded.collection)
                setSchemaFields(fields)
                setEntries(entryList)
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
    }, [endpoint, id, kind])

    // Clear a pending autosave timer on unmount.
    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [])

    // --- Config (with in-iframe token + component CSS) -------------------------------------------
    const config = useMemo<Config>(() => {
        if (!theme) return { components: {} } as unknown as Config
        const context =
            kind === "template" ? { entry: previewEntry, fields: schemaFields ?? undefined } : undefined
        const base = buildConfig(theme, "editor", context) as unknown as Record<string, unknown>
        const canvasCss = `${tokensToCss(theme)}\n${compositorCss}\n${searchFormCss}\n${columnsStackBreakpointCss(theme)}`
        // Overrides buildConfig's own `root.render` (the flow invariant's `.cmp-root` wrapper) rather than
        // composing it — reproduce that same wrapper here so the canvas doesn't silently disagree with the
        // build about top-level stacking behavior; the injected canvas CSS sits outside it as a sibling.
        const rootRender = ({ children }: { children?: ReactNode }) => (
            <>
                <style dangerouslySetInnerHTML={{ __html: canvasCss }} />
                <div className="cmp-root">{children}</div>
            </>
        )
        return { ...base, root: { render: rootRender } } as unknown as Config
    }, [theme, kind, previewEntry, schemaFields])

    // --- Save ------------------------------------------------------------------------------------
    const save = useCallback(async (): Promise<void> => {
        const working = workingRef.current
        if (!working) return
        const current = metaRef.current
        if (current.title.trim() === "") {
            setSaveState("error")
            setSaveError("A title is required — set one in Page settings.")
            return
        }
        setSaveState("saving")
        setSaveError("")
        try {
            const stored = editorFormToDesign({ schemaVersion: CURRENT_SCHEMA_VERSION, puck: working }, RICH_TEXT_PROPS)
            const payload: SavePayload = {
                data:
                    kind === "template"
                        ? {
                              title: current.title,
                              collection: collectionRef.current,
                              is_default: current.isDefault,
                              design: stored
                          }
                        : { title: current.title, description: current.description, design: stored },
                status: "draft",
                _rev: revRef.current
            }
            if (current.slug) payload.slug = current.slug
            const response = await fetch(`${endpoint}/${encodeURIComponent(id)}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", Accept: "application/json", "X-EmDash-Request": "1" },
                body: JSON.stringify(payload)
            })
            if (response.status === 409) {
                setConflict(true)
                setSaveState("error")
                setSaveError("This design changed elsewhere.")
                return
            }
            if (!response.ok) throw new Error(await errorMessage(response))
            const body = (await response.json()) as { data?: { _rev?: string } }
            revRef.current = body.data?._rev
            setSaveState("saved")
        } catch (error) {
            setSaveState("error")
            setSaveError(error instanceof Error ? error.message : String(error))
        }
    }, [endpoint, id, kind])

    const scheduleSave = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
            void save()
        }, AUTOSAVE_DELAY_MS)
    }, [save])

    const handleChange = useCallback(
        (data: Data) => {
            workingRef.current = data
            // Puck emits an initial onChange on mount; ignore it so a fresh load doesn't write a needless draft.
            if (skipFirstChangeRef.current) {
                skipFirstChangeRef.current = false
                return
            }
            setSaveState("saving")
            scheduleSave()
        },
        [scheduleSave]
    )

    // Page-settings edits flow through the same save payload as canvas edits.
    const updateMeta = useCallback(
        (patch: Partial<PageMeta>) => {
            metaRef.current = { ...metaRef.current, ...patch }
            setMeta(metaRef.current)
            setSaveState("saving")
            scheduleSave()
        },
        [scheduleSave]
    )

    // --- Conflict resolution ---------------------------------------------------------------------
    const reloadFromServer = useCallback(async () => {
        try {
            const loaded = await fetchDesign(endpoint, id)
            const editorForm = designToEditorForm(loaded.doc, RICH_TEXT_PROPS)
            workingRef.current = editorForm.puck
            revRef.current = loaded.rev
            metaRef.current = {
                title: loaded.title,
                description: loaded.description,
                slug: loaded.slug,
                isDefault: loaded.isDefault
            }
            collectionRef.current = loaded.collection
            skipFirstChangeRef.current = true
            setInitialData(editorForm.puck)
            setMeta(metaRef.current)
            setStatus(loaded.status)
            setCollection(loaded.collection)
            setConflict(false)
            setSaveState("idle")
            setReloadKey((key) => key + 1) // remount Puck with the reloaded data
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : String(error))
        }
    }, [endpoint, id])

    // --- Preview entry (template mode) -------------------------------------------------------------
    // Puck select options are static per config, so a context change must rebuild the config AND
    // remount Puck — from the CURRENT working tree (not loaded initialData), or unsaved canvas edits
    // get silently dropped by the remount.
    const pickPreviewEntry = useCallback(
        async (entryId: string) => {
            setPreviewEntryId(entryId)
            setPreviewError("")
            try {
                const entryFields = entryId ? await fetchEntryFields(collection, entryId) : null
                if (workingRef.current) setInitialData(workingRef.current)
                skipFirstChangeRef.current = true
                setPreviewEntry(entryFields)
                setReloadKey((key) => key + 1)
            } catch (error) {
                setPreviewError(error instanceof Error ? error.message : String(error))
            }
        },
        [collection]
    )

    const overwriteServer = useCallback(async () => {
        // Blind write: dropping `_rev` bypasses the concurrency check (EmDash permits it).
        revRef.current = undefined
        setConflict(false)
        await save()
    }, [save])

    // --- Publish ---------------------------------------------------------------------------------
    // Template mode blocks on the STRUCTURAL pass only (entry: null); the pass against the preview
    // entry is advisory — the preview is one sample, the build gates every real (template × entry)
    // pairing. Page mode blocks on everything.
    //
    // `published` stays at its default (false), so `unknown-token` stays a WARNING here (DD2): an
    // author mid-rename must not be blocked on a token they're about to fix. The build re-lints with
    // published: true and fails there if a dangling token actually reaches a published document.
    const lint = useMemo<{ findings: LintFinding[]; blocked: boolean }>(() => {
        if (!publishOpen || !workingRef.current) return { findings: [], blocked: false }
        const stored = editorFormToDesign({ schemaVersion: CURRENT_SCHEMA_VERSION, puck: workingRef.current }, RICH_TEXT_PROPS)
        if (kind === "template") {
            const structural = lintDesign(stored, theme, TOKEN_PROPS, OUTLET_PROPS, { entry: null, schemaFields })
            const findings = previewEntry
                ? lintDesign(stored, theme, TOKEN_PROPS, OUTLET_PROPS, { entry: previewEntry, schemaFields })
                : structural
            return { findings, blocked: hasBlockingError(structural) }
        }
        const findings = lintDesign(stored, theme, TOKEN_PROPS, OUTLET_PROPS)
        return { findings, blocked: hasBlockingError(findings) }
    }, [publishOpen, theme, kind, schemaFields, previewEntry])

    if (phase === "loading") {
        return <FullScreenMessage title="Loading design…" kind={kind} />
    }
    if (phase === "error") {
        return <FullScreenMessage title="This design could not be opened" detail={loadError} kind={kind} />
    }

    return (
        <div className="design-editor">
            <div className="design-editor__bar">
                <a href={kind === "template" ? "/admin/advanced/designs/templates" : "/admin/advanced/designs"} className="design-editor__back">
                    {kind === "template" ? "← Templates" : "← Designs"}
                </a>
                <strong className="design-editor__title">{meta.title || "(untitled)"}</strong>
                {kind === "template" && <span className="design-editor__status">Template · {collection}</span>}
                <span className="design-editor__status">{status === "published" ? "Published" : "Draft"}</span>
                <SaveIndicator state={saveState} error={saveError} />
                <span className="design-editor__spacer" />
                {kind === "template" && (
                    <label className="design-editor__preview">
                        Preview entry{" "}
                        <select value={previewEntryId} onChange={(event) => void pickPreviewEntry(event.target.value)}>
                            <option value="">— none —</option>
                            {entries.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                    {entry.label}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                <button type="button" onClick={() => setSettingsOpen(true)}>
                    {kind === "template" ? "Template settings" : "Page settings"}
                </button>
            </div>

            {schemaError && (
                <div className="design-editor__conflict" role="alert">
                    <span>
                        The <strong>{collection}</strong> field schema could not be read, so the outlet field
                        pickers are empty and no content can be bound (this template cannot be published until
                        it is fixed). Reading a collection schema needs the Editor role in the CMS. {schemaError}
                    </span>
                </div>
            )}

            {previewError && (
                <div className="design-editor__conflict" role="alert">
                    <span>{previewError}</span>
                </div>
            )}

            {conflict && (
                <div className="design-editor__conflict" role="alert">
                    <span>This design changed elsewhere (very likely another tab or editor).</span>
                    <button type="button" onClick={() => void reloadFromServer()}>
                        Reload their version
                    </button>
                    <button type="button" onClick={() => void overwriteServer()}>
                        Overwrite with mine
                    </button>
                </div>
            )}

            <div className="design-editor__canvas">
                {initialData && (
                    <Puck
                        key={reloadKey}
                        config={config}
                        data={initialData}
                        onChange={handleChange}
                        onPublish={() => setPublishOpen(true)}
                        iframe={{ syncHostStyles: false }}
                        height="100%"
                    />
                )}
            </div>

            {settingsOpen && (
                <PageSettingsDrawer
                    kind={kind}
                    collection={collection}
                    meta={meta}
                    onChange={updateMeta}
                    onClose={() => setSettingsOpen(false)}
                />
            )}

            {publishOpen && (
                <PublishDialog
                    findings={lint.findings}
                    blocked={lint.blocked}
                    pairingAdvisory={kind === "template"}
                    flushSave={save}
                    publish={() => publishDesign(endpoint, id)}
                    onClose={() => setPublishOpen(false)}
                    onPublished={() => setStatus("published")}
                />
            )}
        </div>
    )
}

/** POST the publish transition for a design item. */
async function publishDesign(endpoint: string, id: string): Promise<void> {
    const response = await fetch(`${endpoint}/${encodeURIComponent(id)}/publish`, {
        method: "POST",
        headers: { Accept: "application/json", "X-EmDash-Request": "1" }
    })
    if (!response.ok) throw new Error(await errorMessage(response))
}

/** A centered full-viewport message for the load and error states. */
function FullScreenMessage({ title, detail, kind }: { title: string; detail?: string; kind: DocumentKind }) {
    return (
        <div className="design-editor__fullscreen" role="status">
            <div>
                <h1>{title}</h1>
                {detail && <p>{detail}</p>}
                <p>
                    {kind === "template" ? (
                        <a href="/admin/advanced/designs/templates">Back to Templates</a>
                    ) : (
                        <a href="/admin/advanced/designs">Back to Designs</a>
                    )}
                </p>
            </div>
        </div>
    )
}

/** The small saved / saving / error status line in the toolbar. */
function SaveIndicator({ state, error }: { state: SaveState; error: string }) {
    const label =
        state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? `Save failed: ${error}` : ""
    return (
        <span className="design-editor__save" data-state={state}>
            {label}
        </span>
    )
}

/** Settings drawer, saved through the design's autosave. Page mode: title, description, slug (a
 * route). Template mode: title, slug (an identifier, never a route), collection (read-only — changing
 * it would silently invalidate every outlet binding, recreate the template instead), default flag. */
function PageSettingsDrawer({
    kind,
    collection,
    meta,
    onChange,
    onClose
}: {
    kind: DocumentKind
    collection: string
    meta: PageMeta
    onChange: (patch: Partial<PageMeta>) => void
    onClose: () => void
}) {
    const heading = kind === "template" ? "Template settings" : "Page settings"
    return (
        <div className="design-editor__drawer" role="dialog" aria-label={heading}>
            <div className="design-editor__drawer-head">
                <h2>{heading}</h2>
                <button type="button" onClick={onClose}>
                    Close
                </button>
            </div>
            <label>
                Title
                <input type="text" value={meta.title} onChange={(event) => onChange({ title: event.target.value })} />
            </label>
            {kind === "page" && (
                <label>
                    Description
                    <textarea value={meta.description} onChange={(event) => onChange({ description: event.target.value })} />
                </label>
            )}
            <label>
                Slug
                <input type="text" value={meta.slug} onChange={(event) => onChange({ slug: event.target.value })} />
            </label>
            {kind === "page" ? (
                <p className="design-editor__hint">
                    The public URL changes when a new slug is published and the site is rebuilt.
                </p>
            ) : (
                <>
                    <p className="design-editor__hint">
                        A template slug is an identifier, not a URL — entries keep their own addresses.
                    </p>
                    <p className="design-editor__hint">
                        Renders entries of: <strong>{collection || "(unset)"}</strong>
                    </p>
                    <label className="design-editor__checkbox">
                        <input
                            type="checkbox"
                            checked={meta.isDefault}
                            onChange={(event) => onChange({ isDefault: event.target.checked })}
                        />{" "}
                        Default template for this collection
                    </label>
                    <p className="design-editor__hint">
                        Entries that name no template render through the collection default. Only one
                        published template per collection may be the default — two fail the build.
                    </p>
                </>
            )}
        </div>
    )
}

/** Publish dialog: shows lint findings, blocks publish per `blocked` (caller-computed — page mode
 * blocks every error; template mode structural errors only, preview-entry pairing rows advisory), then
 * publishes and offers a rebuild. Flushes a last save first so the published revision is current. */
function PublishDialog({
    findings,
    blocked,
    pairingAdvisory,
    flushSave,
    publish,
    onClose,
    onPublished
}: {
    findings: LintFinding[]
    blocked: boolean
    pairingAdvisory: boolean
    flushSave: () => Promise<void>
    publish: () => Promise<void>
    onClose: () => void
    onPublished: () => void
}) {
    const [step, setStep] = useState<"review" | "publishing" | "published" | "error">("review")
    const [message, setMessage] = useState("")
    const [rebuildState, setRebuildState] = useState<"idle" | "rebuilding" | "done" | "error">("idle")
    const [rebuildMessage, setRebuildMessage] = useState("")

    const doPublish = async () => {
        setStep("publishing")
        try {
            await flushSave()
            await publish()
            onPublished()
            setStep("published")
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error))
            setStep("error")
        }
    }

    const doRebuild = async () => {
        setRebuildState("rebuilding")
        try {
            await rebuildSite()
            setRebuildState("done")
            setRebuildMessage("Rebuild triggered. The new build will be live in a few minutes.")
        } catch (error) {
            setRebuildState("error")
            setRebuildMessage(error instanceof Error ? error.message : String(error))
        }
    }

    return (
        <div className="design-editor__modal-backdrop" onClick={onClose}>
            <div className="design-editor__modal" role="dialog" aria-label="Publish design" onClick={(e) => e.stopPropagation()}>
                <div className="design-editor__drawer-head">
                    <h2>Publish</h2>
                    <button type="button" onClick={onClose}>
                        Close
                    </button>
                </div>

                {findings.length === 0 ? (
                    <p>No issues found.</p>
                ) : (
                    <ul className="design-editor__findings">
                        {findings.map((finding, index) => (
                            <li key={index} data-severity={finding.severity}>
                                <strong>{finding.severity === "error" ? "Error" : "Warning"}:</strong> {finding.message}
                                <span className="design-editor__finding-path"> ({finding.path})</span>
                            </li>
                        ))}
                    </ul>
                )}

                {blocked && step === "review" && (
                    <p className="design-editor__blocked">
                        Fix the errors above before publishing — they would otherwise fail the site build.
                    </p>
                )}

                {pairingAdvisory && !blocked && step === "review" && findings.some((f) => f.severity === "error") && (
                    <p className="design-editor__hint">
                        The errors above come from pairing with the preview entry — they do not block
                        publishing this template, but the site build fails on any published entry that
                        pairs like this.
                    </p>
                )}

                {step === "error" && <p className="design-editor__blocked">Publish failed: {message}</p>}

                {step === "published" ? (
                    <div>
                        <p>Published. Rebuild the site to make it public.</p>
                        <button type="button" onClick={() => void doRebuild()} disabled={rebuildState === "rebuilding"}>
                            {rebuildState === "rebuilding" ? "Rebuilding…" : "Rebuild now"}
                        </button>
                        {rebuildMessage && <p>{rebuildMessage}</p>}
                    </div>
                ) : (
                    <button type="button" onClick={() => void doPublish()} disabled={blocked || step === "publishing"}>
                        {step === "publishing" ? "Publishing…" : "Publish"}
                    </button>
                )}
            </div>
        </div>
    )
}
