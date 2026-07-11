/**
 * components/compositor/DesignEditor.tsx
 *
 * The visual compositor's editor island (impl §6.5). Mounted `client:only="react"` by
 * `pages/admin/designs/edit.astro`; it never runs on the build/RSC path (that path uses
 * `buildConfig(theme, "build")` + `<Render>` instead — see catalog.tsx).
 *
 * Lifecycle: load the design item (draft-overlaid `data`, per EmDash's editor-role GET) and the
 * published theme → `migrateDesign` → `designToEditorForm` (Portable Text → ProseMirror) → mount
 * `<Puck>` with `buildConfig(theme, "editor")`. Autosave debounces a `PUT { status: "draft", _rev }`
 * ~2s after the last change, chaining the fresh `_rev` from each response; a stale `_rev` returns 409
 * and raises the conflict banner. Publish runs the shared lint pass (§6.7) in a dialog — a11y errors
 * block publishing (they would fail the build anyway) — then `POST …/publish`, offering a rebuild
 * through the same connector the manual rebuild page uses.
 *
 * Canvas styling: Puck 0.22 renders the canvas in an iframe with `syncHostStyles: false`, so the
 * theme's `--dtk-*` custom properties and `compositor.css` are injected *inside* the iframe via the
 * config's `root.render` (the mechanism confirmed in the Phase 0 spike; no iframe/head override key
 * exists). The editor previews against the *published* theme — the same tokens the build emits — so a
 * theme edit only changes the canvas after it is published (a deliberate, build-faithful choice).
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { Puck } from "@puckeditor/core"
import type { Config, Data } from "@puckeditor/core"

import { buildConfig, RICH_TEXT_PROPS, TOKEN_PROPS } from "../../lib/compositor/catalog"
import { designToEditorForm, editorFormToDesign } from "../../lib/compositor/convert"
import { hasBlockingError, lintDesign, type LintFinding } from "../../lib/compositor/lint"
import { CURRENT_SCHEMA_VERSION, migrateDesign } from "../../lib/compositor/migrations"
import { isTokenCatalog, tokensToCss, type TokenCatalog } from "../../lib/compositor/tokens"
import type { DesignDoc } from "../../lib/compositor/types"
// Vite `?raw` yields the file's text (typed via astro/client). Injected into the canvas iframe below,
// where host styles are not synced — so this is how compositor.css reaches the preview.
import compositorCss from "../../lib/compositor/compositor.css?raw"
import { rebuildSite } from "../../scripts/connector"

import "./design-editor.css"

const DESIGN_PAGE = "/_emdash/api/content/design_page"
const DESIGN_THEME = "/_emdash/api/content/design_theme"
const AUTOSAVE_DELAY_MS = 2000

/** Debounced-save state, surfaced as a small status line in the toolbar. */
type SaveState = "idle" | "saving" | "saved" | "error"

/** The design-page fields and revision token loaded for editing. */
interface LoadedDesign {
    doc: DesignDoc
    rev: string | undefined
    title: string
    description: string
    slug: string
    status: string
}

/** The page-settings fields carried into every save payload. */
interface PageMeta {
    title: string
    description: string
    slug: string
}

/** Best-effort human message from an EmDash `{ error: { message } }` body, else the status line. */
async function readError(response: Response): Promise<string> {
    try {
        const body = (await response.json()) as { error?: { message?: string } }
        if (body.error?.message) return body.error.message
    } catch {
        // non-JSON body; fall through
    }
    return `${response.status} ${response.statusText}`
}

/**
 * Loads the published theme (first `design_theme` item). The list endpoint returns published column
 * data only, so the editor previews against what the build will emit; a theme must be published first.
 */
async function fetchTheme(): Promise<TokenCatalog> {
    const response = await fetch(`${DESIGN_THEME}?limit=1`, { headers: { Accept: "application/json" } })
    if (!response.ok) throw new Error(`Could not load the theme: ${await readError(response)}`)
    const body = (await response.json()) as { data?: { items?: Array<{ data?: Record<string, unknown> | null }> } }
    const tokens = body.data?.items?.[0]?.data?.tokens
    if (!isTokenCatalog(tokens)) {
        throw new Error("No published theme was found. Create and publish a theme on the Theme page before designing.")
    }
    return tokens
}

/** Loads one design page by id (draft-overlaid for an editor-role caller) and its revision token. */
async function fetchDesign(id: string): Promise<LoadedDesign> {
    const response = await fetch(`${DESIGN_PAGE}/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } })
    if (!response.ok) throw new Error(`Could not load the design: ${await readError(response)}`)
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
        status: typeof item.status === "string" ? item.status : "draft"
    }
}

/** The design island. `id` is the `design_page` item id, resolved server-side from the URL query. */
export default function DesignEditor({ id }: { id: string }) {
    const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading")
    const [loadError, setLoadError] = useState("")

    const [theme, setTheme] = useState<TokenCatalog | null>(null)
    const [initialData, setInitialData] = useState<Data | null>(null)
    const [reloadKey, setReloadKey] = useState(0)

    const [meta, setMeta] = useState<PageMeta>({ title: "", description: "", slug: "" })
    const [status, setStatus] = useState("draft")

    const [saveState, setSaveState] = useState<SaveState>("idle")
    const [saveError, setSaveError] = useState("")
    const [conflict, setConflict] = useState(false)

    const [settingsOpen, setSettingsOpen] = useState(false)
    const [publishOpen, setPublishOpen] = useState(false)

    // Refs are the source of truth for saving, so the debounced timer never reads stale closures.
    const workingRef = useRef<Data | null>(null)
    const revRef = useRef<string | undefined>(undefined)
    const metaRef = useRef<PageMeta>({ title: "", description: "", slug: "" })
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const skipFirstChangeRef = useRef(true)

    // --- Load ------------------------------------------------------------------------------------
    useEffect(() => {
        let cancelled = false
        setPhase("loading")
        Promise.all([fetchTheme(), fetchDesign(id)])
            .then(([loadedTheme, loaded]) => {
                if (cancelled) return
                const editorForm = designToEditorForm(loaded.doc, RICH_TEXT_PROPS)
                workingRef.current = editorForm.puck
                revRef.current = loaded.rev
                metaRef.current = { title: loaded.title, description: loaded.description, slug: loaded.slug }
                skipFirstChangeRef.current = true
                setTheme(loadedTheme)
                setInitialData(editorForm.puck)
                setMeta(metaRef.current)
                setStatus(loaded.status)
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
    }, [id])

    // Clear a pending autosave timer on unmount.
    useEffect(() => {
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [])

    // --- Config (with in-iframe token + component CSS) -------------------------------------------
    const config = useMemo<Config>(() => {
        if (!theme) return { components: {} } as unknown as Config
        const base = buildConfig(theme, "editor") as unknown as Record<string, unknown>
        const canvasCss = `${tokensToCss(theme)}\n${compositorCss}`
        const rootRender = ({ children }: { children?: ReactNode }) => (
            <>
                <style dangerouslySetInnerHTML={{ __html: canvasCss }} />
                {children}
            </>
        )
        return { ...base, root: { render: rootRender } } as unknown as Config
    }, [theme])

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
            const payload: Record<string, unknown> = {
                data: { title: current.title, description: current.description, design: stored.puck },
                status: "draft",
                _rev: revRef.current
            }
            if (current.slug) payload.slug = current.slug
            const response = await fetch(`${DESIGN_PAGE}/${encodeURIComponent(id)}`, {
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
            if (!response.ok) throw new Error(await readError(response))
            const body = (await response.json()) as { data?: { _rev?: string } }
            revRef.current = body.data?._rev
            setSaveState("saved")
        } catch (error) {
            setSaveState("error")
            setSaveError(error instanceof Error ? error.message : String(error))
        }
    }, [id])

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
            const loaded = await fetchDesign(id)
            const editorForm = designToEditorForm(loaded.doc, RICH_TEXT_PROPS)
            workingRef.current = editorForm.puck
            revRef.current = loaded.rev
            metaRef.current = { title: loaded.title, description: loaded.description, slug: loaded.slug }
            skipFirstChangeRef.current = true
            setInitialData(editorForm.puck)
            setMeta(metaRef.current)
            setStatus(loaded.status)
            setConflict(false)
            setSaveState("idle")
            setReloadKey((key) => key + 1) // remount Puck with the reloaded data
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : String(error))
        }
    }, [id])

    const overwriteServer = useCallback(async () => {
        // Blind write: dropping `_rev` bypasses the concurrency check (EmDash permits it).
        revRef.current = undefined
        setConflict(false)
        await save()
    }, [save])

    // --- Publish ---------------------------------------------------------------------------------
    const lintFindings = useMemo<LintFinding[]>(() => {
        if (!publishOpen || !workingRef.current) return []
        const stored = editorFormToDesign({ schemaVersion: CURRENT_SCHEMA_VERSION, puck: workingRef.current }, RICH_TEXT_PROPS)
        return lintDesign(stored, theme, TOKEN_PROPS)
    }, [publishOpen, theme])

    if (phase === "loading") {
        return <FullScreenMessage title="Loading design…" />
    }
    if (phase === "error") {
        return <FullScreenMessage title="This design could not be opened" detail={loadError} />
    }

    return (
        <div className="design-editor">
            <div className="design-editor__bar">
                <a href="/admin/designs" className="design-editor__back">
                    ← Designs
                </a>
                <strong className="design-editor__title">{meta.title || "(untitled)"}</strong>
                <span className="design-editor__status">{status === "published" ? "Published" : "Draft"}</span>
                <SaveIndicator state={saveState} error={saveError} />
                <span className="design-editor__spacer" />
                <button type="button" onClick={() => setSettingsOpen(true)}>
                    Page settings
                </button>
                <button type="button" onClick={() => setPublishOpen(true)}>
                    Publish…
                </button>
            </div>

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
                        iframe={{ syncHostStyles: false }}
                        height="100%"
                    />
                )}
            </div>

            {settingsOpen && (
                <PageSettingsDrawer meta={meta} onChange={updateMeta} onClose={() => setSettingsOpen(false)} />
            )}

            {publishOpen && (
                <PublishDialog
                    findings={lintFindings}
                    flushSave={save}
                    publish={() => publishDesign(id)}
                    onClose={() => setPublishOpen(false)}
                    onPublished={() => setStatus("published")}
                />
            )}
        </div>
    )
}

/** POST the publish transition for a design page. */
async function publishDesign(id: string): Promise<void> {
    const response = await fetch(`${DESIGN_PAGE}/${encodeURIComponent(id)}/publish`, {
        method: "POST",
        headers: { Accept: "application/json", "X-EmDash-Request": "1" }
    })
    if (!response.ok) throw new Error(await readError(response))
}

/** A centered full-viewport message for the load and error states. */
function FullScreenMessage({ title, detail }: { title: string; detail?: string }) {
    return (
        <div className="design-editor__fullscreen" role="status">
            <div>
                <h1>{title}</h1>
                {detail && <p>{detail}</p>}
                <p>
                    <a href="/admin/designs">Back to Designs</a>
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

/** Page-settings drawer: title, description, slug. Edits are saved through the design's autosave. */
function PageSettingsDrawer({
    meta,
    onChange,
    onClose
}: {
    meta: PageMeta
    onChange: (patch: Partial<PageMeta>) => void
    onClose: () => void
}) {
    return (
        <div className="design-editor__drawer" role="dialog" aria-label="Page settings">
            <div className="design-editor__drawer-head">
                <h2>Page settings</h2>
                <button type="button" onClick={onClose}>
                    Close
                </button>
            </div>
            <label>
                Title
                <input type="text" value={meta.title} onChange={(event) => onChange({ title: event.target.value })} />
            </label>
            <label>
                Description
                <textarea value={meta.description} onChange={(event) => onChange({ description: event.target.value })} />
            </label>
            <label>
                Slug
                <input type="text" value={meta.slug} onChange={(event) => onChange({ slug: event.target.value })} />
            </label>
            <p className="design-editor__hint">
                The public URL changes when a new slug is published and the site is rebuilt.
            </p>
        </div>
    )
}

/**
 * Publish dialog: shows the lint findings, blocks publish on any a11y/safety error, then publishes and
 * offers a rebuild. A last save is flushed before publishing so the published revision is current.
 */
function PublishDialog({
    findings,
    flushSave,
    publish,
    onClose,
    onPublished
}: {
    findings: LintFinding[]
    flushSave: () => Promise<void>
    publish: () => Promise<void>
    onClose: () => void
    onPublished: () => void
}) {
    const [step, setStep] = useState<"review" | "publishing" | "published" | "error">("review")
    const [message, setMessage] = useState("")
    const [rebuildState, setRebuildState] = useState<"idle" | "rebuilding" | "done" | "error">("idle")
    const [rebuildMessage, setRebuildMessage] = useState("")
    const blocked = hasBlockingError(findings)

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
