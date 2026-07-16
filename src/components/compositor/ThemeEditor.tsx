/**
 * components/compositor/ThemeEditor.tsx
 *
 * The theme editor (impl §6.5): edits the single `design_theme` item's `tokens` catalog — the closed
 * set of `--dtk-*` values every design page draws from (§4.3). Mounted client-side by
 * `pages/admin/designs/theme.astro` inside the normal admin chrome (this is a form page, not the
 * full-viewport canvas), from a module script rather than an Astro island — the admin CSP blocks
 * Astro's inline island bootstrap (see `pages/admin/designs/edit.astro`).
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

import { TOKEN_PROPS } from "../../lib/compositor/catalog"
import { collectTokenUsage } from "../../lib/compositor/lint"
import { migrateDesign } from "../../lib/compositor/migrations"
import { isTokenCatalog, type TokenCatalog, type TokenKind } from "../../lib/compositor/tokens"
import type { DesignDoc } from "../../lib/compositor/types"

import "./design-editor.css"

const DESIGN_THEME = "/_emdash/api/content/design_theme"

/** One editable field within a token kind's row. `color` adds a swatch preview. */
interface FieldSpec {
    key: string
    label: string
    color?: boolean
    optional?: boolean
    /**
     * When set, this field holds a REFERENCE to another token (by name) of that kind, and renders as a
     * `<select>` of the names currently in that kind rather than a free-text input — making a dangling
     * reference unrepresentable in the editor (§3.1), which is stronger than linting it after the fact.
     */
    refKind?: TokenKind
}

/** Editable row: every token value is a string in the form; optional empties are dropped on save. */
type Row = Record<string, string>

/**
 * A web-font row. Fonts are not tokens (not a `TokenKind`), so they sit beside the kind-keyed rows and
 * are edited/serialized separately. `weights` is a comma-separated string in the form and is parsed to a
 * `number[]` on save — storing it as a string would fail `isTokenCatalog` and unstyle every design page.
 */
interface FontRow {
    family: string
    weights: string
}

/** The catalog as edited: rows per kind, the web-font rows, and the preserved catalog schema version. */
type EditableCatalog = { schemaVersion: number; fonts: FontRow[] } & Record<TokenKind, Row[]>

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
    { kind: "breakpoints", label: "Breakpoints", fields: [{ key: "name", label: "Name" }, { key: "minWidth", label: "Min width" }] },
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
        // fields; every read below is typeof-guarded, so widening away the union is safe here. `?? []`
        // covers optional kinds (buttonVariants) absent from a theme that predates them.
        rows[section.kind] = ((catalog[section.kind] ?? []) as unknown as Array<Record<string, unknown>>).map((token) => {
            const row: Row = {}
            for (const field of section.fields) {
                const value = token[field.key]
                row[field.key] = typeof value === "string" ? value : ""
            }
            return row
        })
    }
    const fonts: FontRow[] = (catalog.fonts ?? []).map((font) => ({
        family: font.family,
        weights: (font.weights ?? []).join(", ")
    }))
    return { schemaVersion: catalog.schemaVersion, fonts, ...(rows as Record<TokenKind, Row[]>) }
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
    // Fonts are serialized apart from the kind loop: `weights` is parsed from its comma-separated string
    // to distinct positive integers (a non-number is dropped), and a font with no valid weight omits the
    // key so it defaults to 400 on render. A blank family drops the whole row.
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

/** The design collections whose token references the usage scan counts. Drafts count too (see below). */
const USAGE_COLLECTIONS = ["design_page", "design_template"] as const

/**
 * Scans every design (pages and templates, INCLUDING drafts — a draft referencing a token breaks the
 * moment it is published) for token references, so the editor can tell how many designs a rename or
 * removal would strip. Fail-soft: any read error propagates to the caller, which falls back to the
 * static prose warning rather than breaking the editor over a lost advisory count.
 */
async function fetchDesignUsage(): Promise<Map<string, string[]>> {
    const docs: { label: string; doc: DesignDoc }[] = []
    for (const collection of USAGE_COLLECTIONS) {
        const res = await fetch(`/_emdash/api/content/${collection}?limit=100`, { headers: { Accept: "application/json" } })
        if (!res.ok) throw new Error(`Could not list ${collection}: ${await readError(res)}`)
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

/**
 * A token-reference select: the names available in the referenced kind, plus a way to represent an unset
 * choice and a now-missing reference — so a stored value is never silently rewritten to the first option.
 */
function RefSelect({
    names,
    value,
    optional,
    onChange
}: {
    names: string[]
    value: string
    optional?: boolean
    onChange: (value: string) => void
}) {
    const available = names.filter((name) => name !== "")
    const missing = value !== "" && !available.includes(value)
    return (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
            {(optional || value === "") && <option value="">{optional ? "— none —" : "— choose —"}</option>}
            {missing && <option value={value}>{value} (missing)</option>}
            {available.map((name) => (
                <option key={name} value={name}>
                    {name}
                </option>
            ))}
        </select>
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
    // `"<kind>:<name>"` → design labels using that token; null when the scan has not (yet) succeeded, in
    // which case the editor falls back to the static rename warning (fetchDesignUsage is fail-soft).
    const [usage, setUsage] = useState<Map<string, string[]> | null>(null)

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

    // The usage scan loads independently of the theme: a failed scan degrades to the static warning, it
    // never blocks editing. Left null on any error so the fallback prose shows.
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

    /** The distinct design labels referencing the token (kind, name), or [] when unknown/unused. */
    const usageLabels = (kind: TokenKind, name: string): string[] => (name ? (usage?.get(`${kind}:${name}`) ?? []) : [])

    const removeRow = (kind: TokenKind, index: number) => {
        // Naming which designs would lose the style is the whole point of the scan (§3.1): a silent
        // removal is what the static warning could never prevent. Only guard when we actually know of uses.
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
            {usage === null && (
                <p className="general-warning">
                    Renaming or removing a token breaks any design that references the old name — that style is lost until
                    the design is updated. Changes apply to published pages only after you publish and rebuild.
                </p>
            )}

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
                            {editable[section.kind].map((row, index) => {
                                const nameUses = usageLabels(section.kind, row.name ?? "")
                                return (
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
                                                    {field.refKind ? (
                                                        <RefSelect
                                                            names={editable[field.refKind].map((r) => r.name)}
                                                            value={row[field.key] ?? ""}
                                                            optional={field.optional}
                                                            onChange={(value) => setCell(section.kind, index, field.key, value)}
                                                        />
                                                    ) : (
                                                        <input
                                                            type="text"
                                                            value={row[field.key] ?? ""}
                                                            onChange={(event) => setCell(section.kind, index, field.key, event.target.value)}
                                                        />
                                                    )}
                                                    {field.key === "name" && nameUses.length > 0 && (
                                                        <small className="theme-editor__usage" title={nameUses.join(", ")}>
                                                            used by {nameUses.length} design{nameUses.length === 1 ? "" : "s"}
                                                        </small>
                                                    )}
                                                </span>
                                            </td>
                                        ))}
                                        <td>
                                            <button type="button" onClick={() => removeRow(section.kind, index)}>
                                                Remove
                                            </button>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                    <button type="button" onClick={() => addRow(section.kind)}>
                        Add {section.label.toLowerCase().replace(/s$/, "")}
                    </button>
                </section>
            ))}

            <section className="theme-editor__section">
                <h3>Web fonts</h3>
                <p className="theme-editor__hint">
                    Loads a font from Google Fonts for the whole site. Enter the family name exactly as Google lists it
                    (e.g. “Playfair Display”) and the weights to load, comma-separated (e.g. 400, 700). Then reference the
                    family from a Typography token’s font family. Publish and rebuild to apply.
                </p>
                <table className="theme-editor__table">
                    <thead>
                        <tr>
                            <th scope="col">Font family</th>
                            <th scope="col">Weights</th>
                            <th scope="col" aria-label="Remove" />
                        </tr>
                    </thead>
                    <tbody>
                        {editable.fonts.map((font, index) => (
                            <tr key={index}>
                                <td>
                                    <span className="theme-editor__cell">
                                        <input
                                            type="text"
                                            value={font.family}
                                            placeholder="Inter"
                                            onChange={(event) => setFont(index, "family", event.target.value)}
                                        />
                                    </span>
                                </td>
                                <td>
                                    <span className="theme-editor__cell">
                                        <input
                                            type="text"
                                            value={font.weights}
                                            placeholder="400, 700"
                                            onChange={(event) => setFont(index, "weights", event.target.value)}
                                        />
                                    </span>
                                </td>
                                <td>
                                    <button type="button" onClick={() => removeFont(index)}>
                                        Remove
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <button type="button" onClick={addFont}>
                    Add font
                </button>
            </section>

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
