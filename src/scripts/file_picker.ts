/**
 *
 *
 *
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

import { errorMessage, renderSearchProgress, submitOnEnter } from "./common"
import { fileApiUrl, listFiles } from "./connector"

/**
 * The build-time pool of optimized src/files assets, fetched once and reused across pickers.
 * Resolves to an empty array when the manifest is absent (e.g. local dev, where the build step that
 * emits /files-manifest.json has not run).
 */
let _bundled_files_cache: FilePickerEntry[] | null = null

/**
 * Loads the bundled (src/files) picker entries from the build-time manifest, tolerating its absence
 */
async function _loadBundledFiles(): Promise<FilePickerEntry[]> {
    if (_bundled_files_cache !== null) {
        return _bundled_files_cache
    }
    try {
        const response = await fetch("/files-manifest.json", { headers: { Accept: "application/json" } })
        if (!response.ok) {
            _bundled_files_cache = []
            return _bundled_files_cache
        }
        const manifest = (await response.json()) as {
            name: string
            url: string
            w?: number | null
            h?: number | null
            alt?: string | null
        }[]
        _bundled_files_cache = manifest.map((entry) => ({
            source: "bundled" as const,
            name: entry.name,
            url: entry.url,
            width: entry.w ?? null,
            height: entry.h ?? null,
            alt: entry.alt ?? null
        }))
    } catch {
        // no manifest available; the picker simply falls back to R2 files
        _bundled_files_cache = []
    }
    return _bundled_files_cache
}

/**
 * Appends the build-time bundled (src/files) assets to the file listing as additional rows.
 *
 * The file list page renders the R2 (database) files server-side; bundled assets live only in the static
 * build manifest (/files-manifest.json), so they are added client-side here. Each row mirrors the SSR
 * list markup and is tagged "Local (src/files)" so its source is clear alongside the "Database (R2)"
 * rows. Bundled assets are immutable build artifacts, so they carry no replace/delete actions; the name
 * links directly to the served file. No-ops (silently) when the manifest is absent, e.g. in local dev.
 *
 * @param {string} container_id DOM id of the list-results container to append rows into
 */
export async function appendBundledFiles(container_id: string): Promise<void> {
    const container = document.getElementById(container_id)
    if (!container) {
        console.warn(`List container ${container_id} not found for bundled files`)
        return
    }
    const bundled = await _loadBundledFiles()
    for (const entry of bundled) {
        const row = document.createElement("div")
        row.className = "list-result-container"
        const img = document.createElement("img")
        img.className = "list-result-thumb"
        img.src = entry.url
        img.alt = entry.alt || `Preview of ${entry.name}`
        img.loading = "lazy"
        img.width = 48
        img.height = 48
        const link = document.createElement("a")
        link.className = "list-result-link"
        link.href = entry.url
        link.textContent = entry.name
        const meta = document.createElement("span")
        meta.className = "list-result-meta"
        meta.textContent = `Local (src/files)${entry.width && entry.height ? ` · ${entry.width}×${entry.height}` : ""}`
        row.appendChild(img)
        row.appendChild(link)
        row.appendChild(meta)
        container.appendChild(row)
    }
}

/**
 * Attaches an image file picker to an image-URL field, drawing from build-time bundled assets and R2.
 *
 * Modeled on attachSearchHelper: on button click it gathers the available files, filters them by the
 * query (a case-insensitive substring of the file name; an empty query matches all), and renders each
 * match as a link that, when clicked, fills the target image input with the file's URL. Bundled
 * (src/files) entries are listed before R2 entries so they take selection priority.
 *
 * @param {string} input_id DOM id of the picker's query text input
 * @param {string} button_id DOM id of the picker's search button
 * @param {string} results_div_id DOM id of the element in which to render results
 * @param {string} target_input_id DOM id of the image-URL input to fill on selection
 */
export function attachFilePicker(
    input_id: string,
    button_id: string,
    results_div_id: string,
    target_input_id: string
): void {
    const button = document.getElementById(button_id)
    const input = document.getElementById(input_id)
    const results_div = document.getElementById(results_div_id)
    const target_input = document.getElementById(target_input_id)
    if (
        !button ||
        !(input instanceof HTMLInputElement) ||
        !results_div ||
        !(target_input instanceof HTMLInputElement)
    ) {
        console.warn("File picker elements not found or invalid: ", {
            input_id,
            button_id,
            results_div_id,
            target_input_id
        })
        return
    }
    submitOnEnter(input, button)
    button.addEventListener("click", async (evt: Event) => {
        evt.preventDefault()
        renderSearchProgress(results_div as HTMLElement)
        try {
            // bundled (src/files) first so they take priority, then live R2 files
            const bundled = await _loadBundledFiles()
            const r2_files = await listFiles(true)
            const r2_entries: FilePickerEntry[] = Array.isArray(r2_files)
                ? (r2_files as FileMeta[]).map((file) => ({
                      source: "r2" as const,
                      name: file.key,
                      url: fileApiUrl(file.key),
                      width: file.width,
                      height: file.height,
                      alt: file.alt || null
                  }))
                : []
            const all_entries = [...bundled, ...r2_entries]
            const query = input.value.trim().toLowerCase()
            const matches = all_entries.filter((entry) => entry.name.toLowerCase().includes(query))
            results_div.textContent = ""
            if (matches.length === 0) {
                results_div.textContent = "No matching files found."
                return
            }
            for (const match of matches) {
                const entry = document.createElement("p")
                const link = document.createElement("a")
                link.href = "#"
                link.textContent = `${match.name} (${match.source === "bundled" ? "bundled" : "uploaded"})`
                link.addEventListener("click", (e: Event) => {
                    e.preventDefault()
                    target_input.value = match.url
                    // surface the change to any listeners (e.g. PATCH edit-target auto-check)
                    target_input.dispatchEvent(new Event("input", { bubbles: true }))
                    results_div.textContent = `Selected ${match.name}`
                })
                entry.appendChild(link)
                results_div.appendChild(entry)
            }
        } catch (error) {
            results_div.textContent = `File picker unavailable: ${errorMessage(error)}`
            console.error(error)
        }
    })
}

/**
 * Attaches a file search box that finds uploaded (R2) files and links each hit to its info page.
 *
 * Modeled on attachFilePicker, but instead of filling a target input it renders each match as a link
 * to /admin/files/info?id=<key> so the operator can browse to a file without knowing its exact key.
 * Only R2 (uploaded) files are searched, since bundled (src/files) assets have no info page. An empty
 * query matches all files; matching is a case-insensitive substring of the file key.
 *
 * @param {string} input_id DOM id of the search query text input
 * @param {string} button_id DOM id of the search button
 * @param {string} results_div_id DOM id of the element in which to render results
 */
/**
 * Internal: wires a file-name search box, delegating per-result link setup to `bindResult`.
 *
 * On button click, lists uploaded files and renders each key-substring match as a link. Callers control
 * what selecting a hit does via `bindResult`, which receives the freshly created anchor and the matched
 * file key so it can either set an href (navigation) or attach an on-page click handler.
 *
 * @param {string} input_id DOM id of the file-name text input
 * @param {string} button_id DOM id of the search button
 * @param {string} results_div_id DOM id of the element in which to render results
 * @param {(link: HTMLAnchorElement, key: string) => void} bindResult configures each result link
 */
function _attachFileSearch(
    input_id: string,
    button_id: string,
    results_div_id: string,
    bindResult: (link: HTMLAnchorElement, key: string) => void
): void {
    const button = document.getElementById(button_id)
    const input = document.getElementById(input_id)
    const results_div = document.getElementById(results_div_id)
    if (!button || !(input instanceof HTMLInputElement) || !results_div) {
        console.warn("File search elements not found or invalid: ", { input_id, button_id, results_div_id })
        return
    }
    submitOnEnter(input, button)
    button.addEventListener("click", async (evt: Event) => {
        evt.preventDefault()
        renderSearchProgress(results_div as HTMLElement)
        try {
            const r2_files = await listFiles(true)
            const files: FileMeta[] = Array.isArray(r2_files) ? (r2_files as FileMeta[]) : []
            const query = input.value.trim().toLowerCase()
            const matches = files.filter((file) => file.key.toLowerCase().includes(query))
            results_div.textContent = ""
            if (matches.length === 0) {
                results_div.textContent = "No matching files found."
                return
            }
            for (const match of matches) {
                const entry = document.createElement("p")
                const link = document.createElement("a")
                link.textContent = match.key
                bindResult(link, match.key)
                entry.appendChild(link)
                results_div.appendChild(entry)
            }
        } catch (error) {
            results_div.textContent = `File search unavailable: ${errorMessage(error)}`
            console.error(error)
        }
    })
}

/**
 * Attaches a navigating file-name search box (used by the file info/view page).
 *
 * Each hit becomes a link to that file's info page.
 *
 * @param {string} input_id DOM id of the file-name text input
 * @param {string} button_id DOM id of the search button
 * @param {string} results_div_id DOM id of the element in which to render results
 */
export function attachFileSearch(input_id: string, button_id: string, results_div_id: string): void {
    _attachFileSearch(input_id, button_id, results_div_id, (link, key) => {
        link.href = `/admin/files/info?id=${encodeURIComponent(key)}`
    })
}

/**
 * Attaches an on-page (non-navigating) file-name search box, used by the replace/delete pages.
 *
 * Selecting a hit invokes `onSelect` with the matched key instead of navigating, so those pages can fill
 * the key into their form field rather than leaving the page.
 *
 * @param {string} input_id DOM id of the file-name text input
 * @param {string} button_id DOM id of the search button
 * @param {string} results_div_id DOM id of the element in which to render results
 * @param {(key: string) => void} onSelect handles a selected file key (e.g. fills a form field)
 */
export function attachFileSearchInline(
    input_id: string,
    button_id: string,
    results_div_id: string,
    onSelect: (key: string) => void
): void {
    _attachFileSearch(input_id, button_id, results_div_id, (link, key) => {
        link.href = "#"
        link.addEventListener("click", (e: Event) => {
            e.preventDefault()
            onSelect(key)
        })
    })
}

/**
 * Live storage-usage estimate for the file upload and replace forms.
 *
 * Renders the current "Storage used: X GB of Y GB (Z%)" line (matching the figure on /admin/files) into
 * the display element, and — once a file is chosen — appends a projection of usage after the upload so the
 * operator can see how much room will remain. For the replace flow (key_input_id supplied) the new bytes
 * overwrite the existing object at the key, so its current size is looked up from the file listing and
 * subtracted from the projection. The selected file's raw size is used as an upper bound; images are
 * optimized smaller on upload, so the real result is no worse than shown.
 *
 * @param {number} used current bytes used (from getStorageUsage, embedded by the page)
 * @param {number} max the storage ceiling in bytes
 * @param {string} file_input_id DOM id of the file <input type="file">
 * @param {string} display_id DOM id of the element the usage text is rendered into
 * @param {string} [key_input_id] DOM id of the key input (replace flow only); subtracts the replaced file's size
 */
export function attachStorageEstimate(
    used: number,
    max: number,
    file_input_id: string,
    display_id: string,
    key_input_id?: string
): void {
    const file_input = document.getElementById(file_input_id)
    const display = document.getElementById(display_id)
    if (!(file_input instanceof HTMLInputElement) || !display) {
        console.warn("Storage estimate elements not found: ", { file_input_id, display_id })
        return
    }
    const key_input = key_input_id ? document.getElementById(key_input_id) : null
    const GB = 1024 * 1024 * 1024
    const gb = (bytes: number) => (Math.max(0, bytes) / GB).toFixed(2)
    const pct = (bytes: number) => (max > 0 ? Math.round((bytes / max) * 100) : 0)
    // human-readable size for the (typically sub-GB) selected file
    const human = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        if (bytes < GB) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        return `${gb(bytes)} GB`
    }
    // lazily-loaded key -> size map, used by the replace flow to discount the file being overwritten
    let size_by_key: Map<string, number> | null = null
    const loadSizes = async (): Promise<Map<string, number>> => {
        if (size_by_key) return size_by_key
        const map = new Map<string, number>()
        try {
            const files = await listFiles(true)
            if (Array.isArray(files)) {
                for (const file of files as FileMeta[]) map.set(file.key, file.size)
            }
        } catch (error) {
            console.warn("Could not load file sizes for storage estimate: ", error)
        }
        size_by_key = map
        return map
    }
    const base = `Storage used: ${gb(used)} GB of ${gb(max)} GB (${pct(used)}%).`
    const render = async () => {
        const file = file_input.files?.[0]
        if (!file) {
            display.textContent = base
            return
        }
        // a replace overwrites the existing object at the key, so its current size does not count twice
        let existing = 0
        if (key_input instanceof HTMLInputElement) {
            const key = key_input.value.trim()
            if (key) existing = (await loadSizes()).get(key) ?? 0
        }
        const projected = used - existing + file.size
        const free = max - projected
        if (free < 0) {
            display.textContent = `${base} Selected file (${human(file.size)}) would exceed the storage ceiling by ${gb(-free)} GB.`
        } else {
            display.textContent = `${base} Selected file: ${human(file.size)}; after upload ${gb(projected)} GB of ${gb(max)} GB (${pct(projected)}%) used, ${gb(free)} GB free.`
        }
    }
    file_input.addEventListener("change", render)
    if (key_input instanceof HTMLInputElement) {
        key_input.addEventListener("input", render)
        key_input.addEventListener("change", render)
    }
    render()
}
