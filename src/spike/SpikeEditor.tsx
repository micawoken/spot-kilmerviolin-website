/**
 * spike/SpikeEditor.tsx — THROWAWAY (Phase 0 spike (b)+(c); deleted before Phase 1 merges).
 *
 * Puck editor island exercising the editor↔EmDash roundtrip:
 *   load:    GET /_emdash/api/content/design_spike (create the doc if absent) → draft-overlaid data + _rev
 *   save:    debounced PUT { data, status: "draft", _rev } with the X-EmDash-Request CSRF header,
 *            same-origin credentials; _rev refreshed from each response; conflict → banner
 *   publish: Puck's Publish button → save, then POST …/publish
 *
 * Spike (c): token CSS is injected INSIDE the canvas iframe via the config root render (a <style>
 * element rendered with the content — Puck 0.22 has no iframe/head override; overrides.preview wraps
 * the canvas in the HOST document, so it cannot style the iframe). Host-style sync is disabled
 * (iframe.syncHostStyles: false) so admin/editor styles cannot leak into the canvas.
 *
 * Local dev note (spike finding): EmDash's own API auth is NOT bypassed in `astro dev` (external auth
 * falls back to passkey sessions); the DEV-only /_emdash/api/auth/dev-bypass endpoint creates an admin
 * session. The island offers that link when it hits a 401.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { Puck } from "@puckeditor/core"
import type { Config, Data } from "@puckeditor/core"
import "@puckeditor/core/puck.css"
import { spikeConfig, spikeData } from "./spike-config"

const COLLECTION = "design_spike"
const DOC_SLUG = "spike-editor-doc"

/** Hardcoded stand-in for the design_theme token catalog (spike (c)). */
const TOKENS_CSS =
    ":root{--dtk-color-band-primary:#f3ede2;--dtk-space-section-y:2rem;" +
    "--dtk-type-display-family:Georgia,serif;--dtk-type-body-family:system-ui,sans-serif}"

/** spikeConfig plus a root render that injects the token CSS inside the canvas iframe. */
const editorConfig: Config = {
    ...spikeConfig,
    root: {
        render: ({ children }) => (
            <>
                <style dangerouslySetInnerHTML={{ __html: TOKENS_CSS }} />
                {children}
            </>
        )
    }
}

interface ApiResult {
    status: number
    json: { data?: any; error?: { code?: string; message?: string } } | null
}

async function api(method: string, path: string, body?: unknown): Promise<ApiResult> {
    const response = await fetch(`/_emdash/api${path}`, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-EmDash-Request": "1" },
        body: body === undefined ? undefined : JSON.stringify(body)
    })
    let json = null
    try {
        json = await response.json()
    } catch {
        /* non-JSON response */
    }
    return { status: response.status, json }
}

type LoadState =
    | { phase: "loading" }
    | { phase: "unauthenticated" }
    | { phase: "error"; message: string }
    | { phase: "ready"; id: string; initial: Data }

type SaveState = "idle" | "saving" | "saved" | "conflict" | "error" | "published"

export default function SpikeEditor() {
    const [load, setLoad] = useState<LoadState>({ phase: "loading" })
    const [saveState, setSaveState] = useState<SaveState>("idle")
    const revRef = useRef<string | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        ;(async () => {
            const list = await api("GET", `/content/${COLLECTION}?limit=10`)
            if (list.status === 401) return setLoad({ phase: "unauthenticated" })
            if (list.status !== 200) return setLoad({ phase: "error", message: `list → ${list.status}` })

            let id: string | undefined = list.json?.data?.items?.find((i: any) => i.slug === DOC_SLUG)?.id
            if (!id) {
                const created = await api("POST", `/content/${COLLECTION}`, {
                    slug: DOC_SLUG,
                    status: "draft",
                    data: { design: { schemaVersion: 1, puck: spikeData } }
                })
                id = created.json?.data?.item?.id
                if (!id) return setLoad({ phase: "error", message: `create → ${created.status}` })
            }

            const got = await api("GET", `/content/${COLLECTION}/${id}`)
            const design = got.json?.data?.item?.data?.design
            revRef.current = got.json?.data?._rev ?? null
            if (got.status !== 200 || !design?.puck || !revRef.current)
                return setLoad({ phase: "error", message: `get → ${got.status} (design/_rev missing)` })
            setLoad({ phase: "ready", id, initial: design.puck })
        })()
    }, [])

    const save = useCallback(
        async (data: Data): Promise<boolean> => {
            if (load.phase !== "ready") return false
            setSaveState("saving")
            const put = await api("PUT", `/content/${COLLECTION}/${load.id}`, {
                data: { design: { schemaVersion: 1, puck: data } },
                status: "draft",
                _rev: revRef.current
            })
            if (put.status === 200 && put.json?.data?._rev) {
                revRef.current = put.json.data._rev
                setSaveState("saved")
                return true
            }
            setSaveState(put.json?.error?.message?.includes("conflict") ? "conflict" : "error")
            return false
        },
        [load]
    )

    // ~2s debounced autosave, mirroring the production editor's contract (a possible redundant save of
    // the initial mount state is harmless for the spike)
    const onChange = useCallback(
        (data: Data) => {
            if (timerRef.current) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => void save(data), 2000)
        },
        [save]
    )

    const publish = useCallback(
        async (data: Data) => {
            if (load.phase !== "ready") return
            if (!(await save(data))) return
            const result = await api("POST", `/content/${COLLECTION}/${load.id}/publish`)
            setSaveState(result.status === 200 ? "published" : "error")
        },
        [load, save]
    )

    if (load.phase === "loading") return <p>Loading…</p>
    if (load.phase === "unauthenticated")
        return (
            <p>
                Not authenticated with EmDash.{" "}
                <a href="/_emdash/api/setup/dev-bypass?redirect=/admin/designs/spike">Sign in via dev bypass</a>{" "}
                (local dev only).
            </p>
        )
    if (load.phase === "error") return <p>Failed to load spike document: {load.message}</p>

    return (
        <div style={{ position: "fixed", inset: 0 }}>
            {saveState === "conflict" && (
                <div style={{ position: "fixed", top: 0, left: "50%", transform: "translateX(-50%)", zIndex: 100, background: "#b91c1c", color: "#fff", padding: "4px 12px" }}>
                    This design changed elsewhere — reload to pick up the latest version.
                </div>
            )}
            <div data-spike-save-state={saveState} style={{ position: "fixed", bottom: 4, right: 8, zIndex: 100, fontSize: 12 }}>
                {saveState}
            </div>
            <Puck
                config={editorConfig}
                data={load.initial}
                iframe={{ syncHostStyles: false }}
                onChange={onChange}
                onPublish={publish}
            />
        </div>
    )
}
