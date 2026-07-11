/**
 * components/compositor/ThemeEditor.tsx
 *
 * The theme editor island (impl §6.5): edits the single `design_theme` item's `tokens` catalog —
 * the closed set of `--dtk-*` values every design page draws from (§4.3). Mounted `client:only="react"`
 * by `pages/admin/designs/theme.astro` inside the normal admin chrome (this is a form page, not the
 * full-viewport canvas).
 *
 * It discovers the theme item via the content list, then GETs it by id for the draft-overlaid `tokens`
 * (editor-role read), edits every token kind as rows, and writes a draft `PUT` / `POST …/publish` the
 * same way the design editor does. Rename/remove is destructive to designs referencing the old name
 * (Phase 1 accepts this — lint surfaces the dangling reference; a usage scan is a later hardening step).
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

import { useEffect, useState } from "react"

import { isTokenCatalog, type TokenCatalog, type TokenKind } from "../../lib/compositor/tokens"

import "./design-editor.css"

const DESIGN_THEME = "/_emdash/api/content/design_theme"

/** One editable field within a token kind's row. `color` adds a swatch preview. */
interface FieldSpec {
    key: string
    label: string
    color?: boolean
    optional?: boolean
}

/** Editable row: every token value is a string in the form; optional empties are dropped on save. */
type Row = Record<string, string>

/** The catalog as edited: rows per kind plus the preserved catalog schema version. */
type EditableCatalog = { schemaVersion: number } & Record<TokenKind, Row[]>

/** The token kinds and their fields (§4.3), in the order they render. Drives load, edit, and save. */
const SECTIONS: Array<{ kind: TokenKind; label: string; fields: FieldSpec[] }> = [
    { kind: "colors", label: "Colors", fields: [{ key: "name", label: "Name" }, { key: "value", label: "Value", color: true }] },
    {
        kind: "typography",
        label: "Typography",
        fields: [
            { key: "name", label: "Name" },
            { key: "family", label: "Font family" },
            { key: "size", label: "Size" },
            { key: "weight", label: "Weight" },
            { key: "lineHeight", label: "Line height" },
            { key: "letterSpacing", label: "Letter spacing", optional: true }
        ]
    },
    { kind: "space", label: "Spacing", fields: [{ key: "name", label: "Name" }, { key: "value", label: "Value" }] },
    { kind: "radius", label: "Radius", fields: [{ key: "name", label: "Name" }, { key: "value", label: "Value" }] },
    { kind: "shadows", label: "Shadows", fields: [{ key: "name", label: "Name" }, { key: "value", label: "Value" }] },
    {
        kind: "borders",
        label: "Borders",
        fields: [
            { key: "name", label: "Name" },
            { key: "width", label: "Width" },
            { key: "style", label: "Style" },
            { key: "colorRef", label: "Color token" }
        ]
    },
    { kind: "breakpoints", label: "Breakpoints", fields: [{ key: "name", label: "Name" }, { key: "minWidth", label: "Min width" }] }
]

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

/** Converts a validated catalog into the string-row form the editor mutates. */
function toEditable(catalog: TokenCatalog): EditableCatalog {
    const rows: Partial<Record<TokenKind, Row[]>> = {}
    for (const section of SECTIONS) {
        // The rows are edited generically (kind → fields), so the token unions are read as bags of
        // fields; every read below is typeof-guarded, so widening away the union is safe here.
        rows[section.kind] = (catalog[section.kind] as unknown as Array<Record<string, unknown>>).map((token) => {
            const row: Row = {}
            for (const field of section.fields) {
                const value = token[field.key]
                row[field.key] = typeof value === "string" ? value : ""
            }
            return row
        })
    }
    return { schemaVersion: catalog.schemaVersion, ...(rows as Record<TokenKind, Row[]>) }
}

/** Rebuilds the stored catalog from the edited rows, dropping empty optional fields. */
function toCatalog(editable: EditableCatalog): TokenCatalog {
    const catalog: Record<string, unknown> = { schemaVersion: editable.schemaVersion }
    for (const section of SECTIONS) {
        catalog[section.kind] = editable[section.kind].map((row) => {
            const token: Record<string, string> = {}
            for (const field of section.fields) {
                const value = row[field.key] ?? ""
                if (field.optional && value.trim() === "") continue
                token[field.key] = value
            }
            return token
        })
    }
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
    if (!list.ok) throw new Error(`Could not list themes: ${await readError(list)}`)
    const listBody = (await list.json()) as { data?: { items?: Array<{ id: string }> } }
    const items = listBody.data?.items ?? []
    if (items.length === 0) throw new Error("No theme item exists. Run the design-collection setup tool to seed one.")

    const id = items[0].id
    const get = await fetch(`${DESIGN_THEME}/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } })
    if (!get.ok) throw new Error(`Could not load the theme: ${await readError(get)}`)
    const getBody = (await get.json()) as { data?: { item?: { data?: { tokens?: unknown } }; _rev?: string } }
    const tokens = getBody.data?.item?.data?.tokens
    if (!isTokenCatalog(tokens)) throw new Error("The stored theme is not a valid token catalog and cannot be edited here.")
    return { id, catalog: tokens, rev: getBody.data?._rev, count: items.length }
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

    const removeRow = (kind: TokenKind, index: number) => {
        setEditable((current) =>
            current ? { ...current, [kind]: current[kind].filter((_, position) => position !== index) } : current
        )
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
            if (!put.ok) throw new Error(await readError(put))
            const putBody = (await put.json()) as { data?: { _rev?: string } }
            setRev(putBody.data?._rev)

            if (publish) {
                const publishResponse = await fetch(`${DESIGN_THEME}/${encodeURIComponent(id)}/publish`, {
                    method: "POST",
                    headers: { Accept: "application/json", "X-EmDash-Request": "1" }
                })
                if (!publishResponse.ok) throw new Error(await readError(publishResponse))
            }
            setSaveState("saved")
            setMessage(publish ? "Published. Rebuild the site to apply the theme to published pages." : "Draft saved.")
        } catch (error) {
            setSaveState("error")
            setMessage(error instanceof Error ? error.message : String(error))
        }
    }

    return (
        <div className="theme-editor">
            {count > 1 && (
                <p className="general-warning">
                    More than one theme item exists ({count}). Only the first is edited here; remove the extras in the
                    EmDash admin to avoid ambiguity.
                </p>
            )}
            <p className="general-warning">
                Renaming or removing a token breaks any design that references the old name — that style is lost until
                the design is updated. Changes apply to published pages only after you publish and rebuild.
            </p>

            {SECTIONS.map((section) => (
                <section key={section.kind} className="theme-editor__section">
                    <h3>{section.label}</h3>
                    <table className="theme-editor__table">
                        <thead>
                            <tr>
                                {section.fields.map((field) => (
                                    <th key={field.key} scope="col">
                                        {field.label}
                                    </th>
                                ))}
                                <th scope="col" aria-label="Remove" />
                            </tr>
                        </thead>
                        <tbody>
                            {editable[section.kind].map((row, index) => (
                                <tr key={index}>
                                    {section.fields.map((field) => (
                                        <td key={field.key}>
                                            <span className="theme-editor__cell">
                                                {field.color && (
                                                    <span
                                                        className="theme-editor__swatch"
                                                        style={{ background: row[field.key] || "transparent" }}
                                                        aria-hidden="true"
                                                    />
                                                )}
                                                <input
                                                    type="text"
                                                    value={row[field.key] ?? ""}
                                                    onChange={(event) => setCell(section.kind, index, field.key, event.target.value)}
                                                />
                                            </span>
                                        </td>
                                    ))}
                                    <td>
                                        <button type="button" onClick={() => removeRow(section.kind, index)}>
                                            Remove
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <button type="button" onClick={() => addRow(section.kind)}>
                        Add {section.label.toLowerCase().replace(/s$/, "")}
                    </button>
                </section>
            ))}

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
