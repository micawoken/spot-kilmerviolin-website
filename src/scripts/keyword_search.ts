/**
 * 
 * 
 * 
 * 
 */

import { errorMessage, renderSearchProgress, submitOnEnter } from "./common"
import { listComposer, listContributor, searchDatabase } from "./connector"



/**
 * Resets and re-reveals the keyword search box that the info pages pair with the ID entry form.
 *
 * The on-page READ flow (processSubmit) hides both the ID entry form and the keyword search box when a
 * record is loaded; this restores the keyword box (clearing its input and results) so the next task can
 * search again. No-ops on pages without a keyword box (e.g. create/delete), so it is safe to call generally.
 */
export function _resetKeywordSearch(): void {
    const search_container = document.getElementById("entity-search-container")
    if (!search_container) {
        return
    }
    search_container.classList.remove("hidden")
    const search_input = document.getElementById("entity-search-input")
    if (search_input instanceof HTMLInputElement) {
        search_input.value = ""
    }
    const search_results = document.getElementById("entity-search-results")
    if (search_results) {
        search_results.replaceChildren()
        const placeholder = document.createElement("p")
        placeholder.textContent = "Results will display here when searched."
        search_results.appendChild(placeholder)
    }
}


/**
 * Singular, human-readable label for each searchable database, used to prefix a hit's result text so the
 * operator can tell which database it came from (most useful for an all-databases search, where the
 * results are interleaved).
 */
const search_database_label: Record<SearchDatabase, string> = {
    composers: "Composer",
    compositions: "Composition",
    contributors: "Contributor",
}

/**
 * Attaches an on-page (non-navigating) keyword-search box, used by the entity info (view) pages.
 *
 * Selecting a hit invokes `onSelect` instead of navigating, so the info pages can load the record in
 * place via the same READ flow used by the ID entry form (which hides both search boxes and renders the
 * record), keeping ID search and keyword search behaviorally identical.
 *
 * @param {string} input_id DOM id of the keyword text input
 * @param {string} button_id DOM id of the search button
 * @param {string} results_div_id DOM id of the element in which to render results
 * @param {() => SearchDatabase | null} getDatabase returns the database to scope to, or null for all three
 * @param {(result: SearchResult) => void} onSelect handles a selected hit (e.g. loads it on-page)
 */
export function attachKeywordSearchInline(input_id: string, button_id: string, results_div_id: string, getDatabase: () => SearchDatabase | null, onSelect: (result: SearchResult) => void): void {
    _attachKeywordSearch(input_id, button_id, results_div_id, getDatabase, (link, result) => {
        link.href = "#"
        link.addEventListener("click", (e: Event) => {
            e.preventDefault()
            onSelect(result)
        })
    })
}

/**
 * Internal: wires a keyword-search box, delegating per-result link setup to `bindResult`.
 *
 * On button click, sends the keyword (and the database returned by getDatabase) to /api/v1/search and
 * renders each hit as a link. Callers control what selecting a hit does via `bindResult`, which receives
 * the freshly created anchor and its result so it can either set an href (navigation) or attach an
 * on-page click handler.
 *
 * @param {string} input_id DOM id of the keyword text input
 * @param {string} button_id DOM id of the search button
 * @param {string} results_div_id DOM id of the element in which to render results
 * @param {() => SearchDatabase | null} getDatabase returns the database to scope to, or null for all three
 * @param {(link: HTMLAnchorElement, result: SearchResult) => void} bindResult configures each result link
 */
function _attachKeywordSearch(input_id: string, button_id: string, results_div_id: string, getDatabase: () => SearchDatabase | null, bindResult: (link: HTMLAnchorElement, result: SearchResult) => void): void {
    const button = document.getElementById(button_id)
    const input = document.getElementById(input_id)
    const results_div = document.getElementById(results_div_id)
    if (!button || !(input instanceof HTMLInputElement) || !results_div) {
        console.warn("Keyword search elements not found or invalid: ", { input_id, button_id, results_div_id })
        return
    }
    submitOnEnter(input, button)
    button.addEventListener("click", async (evt: Event) => {
        evt.preventDefault()
        const keyword = input.value.trim()
        if (keyword === "") {
            results_div.textContent = "Enter a keyword to search."
            return
        }
        if (keyword.length < 3) {
            results_div.textContent = "Please enter at least 3 characters for the search."
            return
        }
        renderSearchProgress(results_div as HTMLElement)
        try {
            const results = await searchDatabase(keyword, getDatabase())
            results_div.textContent = ""
            if (!Array.isArray(results) || results.length === 0) {
                results_div.textContent = "No matches found."
                return
            }
            for (const result of results) {
                const entry = document.createElement("p")
                const link = document.createElement("a")
                // prefix with the source database (e.g. "Composer ID #5 - ...") so it is clear which
                // database a hit came from when searching across all of them
                const db_label = search_database_label[result.database] ?? ""
                link.textContent = `${db_label ? `${db_label} ` : ""}ID #${result.id} - ${result.name}`
                bindResult(link, result)
                entry.appendChild(link)
                results_div.appendChild(entry)
            }
        } catch (error) {
            results_div.textContent = `Search unavailable: ${errorMessage(error)}`
            console.error(error)
        }
    })
}

/**
 * Attaches a navigating keyword-search box (used by the standalone search page and the edit pages).
 *
 * Each hit becomes a link whose target is produced by getHref: the standalone search page routes each
 * hit to its entity's info page, while the edit pages route to the current page's "?id=" SSR flow (which
 * prefills the edit form).
 *
 * @param {string} input_id DOM id of the keyword text input
 * @param {string} button_id DOM id of the search button
 * @param {string} results_div_id DOM id of the element in which to render results
 * @param {() => SearchDatabase | null} getDatabase returns the database to scope to, or null for all three
 * @param {(result: SearchResult) => string} getHref builds the href for a given hit
 */
export function attachKeywordSearch(input_id: string, button_id: string, results_div_id: string, getDatabase: () => SearchDatabase | null, getHref: (result: SearchResult) => string): void {
    _attachKeywordSearch(input_id, button_id, results_div_id, getDatabase, (link, result) => {
        link.href = getHref(result)
    })
}


/**
 * Attaches a name-search helper to an entity ID input
 *
 * On button click, fetches the full record list, filters by name (case-insensitive substring),
 * and renders clickable results which fill the target ID input when selected
 *
 * @param {"composer" | "contributor"} kind which record list to search
 * @param {string} input_id DOM id of the search text input
 * @param {string} button_id DOM id of the search button
 * @param {string} results_div_id DOM id of the element in which to render results
 * @param {string} target_input_id DOM id of the ID input to fill upon selection
 */
export function attachSearchHelper(kind: "composer" | "contributor", input_id: string, button_id: string, results_div_id: string, target_input_id: string): void {
    const button = document.getElementById(button_id)
    const input = document.getElementById(input_id)
    const results_div = document.getElementById(results_div_id)
    const target_input = document.getElementById(target_input_id)
    if (!button || !(input instanceof HTMLInputElement) || !results_div || !(target_input instanceof HTMLInputElement)) {
        console.warn(`Search helper elements not found or invalid for ${kind}: `, { input_id, button_id, results_div_id, target_input_id })
        return
    }
    submitOnEnter(input, button)
    button.addEventListener("click", async (evt: Event) => {
        evt.preventDefault()
        renderSearchProgress(results_div as HTMLElement)
        try {
            const records = (kind === "composer") ? await listComposer(true) : await listContributor(true)
            if (!Array.isArray(records)) {
                throw new Error("No records returned from search")
            }
            const query = input.value.trim().toLowerCase()
            const matches = records.filter((rec: any) => typeof rec?.name === "string" && rec.name.toLowerCase().includes(query))
            results_div.textContent = ""
            if (matches.length === 0) {
                results_div.textContent = "No matches found."
                return
            }
            for (const match of matches) {
                const entry = document.createElement("p")
                const link = document.createElement("a")
                link.href = "#"
                link.textContent = `ID #${match.id} - ${match.name}`
                link.addEventListener("click", (e: Event) => {
                    e.preventDefault()
                    target_input.value = String(match.id)
                    results_div.textContent = `Selected ID #${match.id} - ${match.name}`
                })
                entry.appendChild(link)
                results_div.appendChild(entry)
            }
        } catch (error) {
            // any viewer may list contributors; non-self records come back with protected properties
            // redacted, but the name used for searching is not protected, so search still works
            results_div.textContent = `Search unavailable: ${errorMessage(error)}`
            console.error(error)
        }
    })
}