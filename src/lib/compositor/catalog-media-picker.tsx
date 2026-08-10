/**
 * lib/compositor/catalog-media-picker.tsx
 *
 * The editor-only media picker: a Puck custom field that lists images from GET /_emdash/api/media and
 * writes the chosen one back as a `MediaValue`. Split out of catalog.tsx.
 *
 * It is the one field render in the catalog with browser behavior of its own — fetch plus modal state —
 * which is why it is attached only in the editor target and never reaches the build path. That is also
 * what makes it separable from a file whose render functions are otherwise required to be pure.
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
import type { CustomFieldRender } from "@puckeditor/core"

import { isSafeStorageKey, proxyMediaUrl } from "./media"
// Type-only, so this does not create a runtime import cycle with catalog.tsx, which imports the picker.
import type { MediaValue } from "./catalog"

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
export const mediaPickerRender: CustomFieldRender<MediaValue | undefined> = ({ value, onChange }) => {
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
