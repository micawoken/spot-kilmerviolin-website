/**
 * lib/search/pagination.ts
 *
 * Pure result-list math shared by pages/search.astro and pages/search/advanced.astro's client scripts
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

/** No product spec pins this number - a round default chosen to keep a page of results short. */
export const SEARCH_PAGE_SIZE = 20

export interface PageWindow {
    /** slice bounds into the full result array, [start, end) */
    start: number
    end: number
    /** 1-indexed current page (always 1 when showingAll) */
    page: number
    totalPages: number
    showingAll: boolean
    totalCount: number
}

export function readPage(params: URLSearchParams): number {
    const raw = Number(params.get("page"))
    return Number.isInteger(raw) && raw > 0 ? raw : 1
}

export function readShowAll(params: URLSearchParams): boolean {
    return params.get("perPage") === "all"
}

/**
 * Everything a pagination-controls renderer needs to know, given the full (unsliced) result count and
 * the current URL params
 */
export function computePageWindow(
    totalCount: number,
    params: URLSearchParams,
    pageSize: number = SEARCH_PAGE_SIZE
): PageWindow {
    if (readShowAll(params) || totalCount <= pageSize) {
        return { start: 0, end: totalCount, page: 1, totalPages: 1, showingAll: true, totalCount }
    }
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
    const page = Math.min(Math.max(1, readPage(params)), totalPages)
    const start = (page - 1) * pageSize
    const end = Math.min(start + pageSize, totalCount)
    return { start, end, page, totalPages, showingAll: false, totalCount }
}

/**
 * Returns params identical to `base` except for the paging keys, set for page `page` (an explicit "1"
 * simply clears `page`/`perPage` back to the paginated default)
 */
export function withPage(base: URLSearchParams, page: number): URLSearchParams {
    const params = new URLSearchParams(base)
    params.delete("perPage")
    if (page <= 1) params.delete("page")
    else params.set("page", String(page))
    return params
}

/** Returns params identical to `base` but forcing "show all" (and clearing `page`, which no longer applies). */
export function withShowAll(base: URLSearchParams): URLSearchParams {
    const params = new URLSearchParams(base)
    params.delete("page")
    params.set("perPage", "all")
    return params
}

/** Strips a single trailing slash (except the bare root) so a Pagefind-crawled result URL and a
 *  db-search-index.json entry URL can be compared for equality despite differing trailing-slash
 *  conventions */
export function normalizeUrl(url: string): string {
    return url.length > 1 && url.endsWith("/") ? url.slice(0, -1) : url
}

/** Collapses same-URL entries to their first (highest-ranked, since Pagefind returns results pre-sorted by
 *  relevance) occurrence, preserving order */
export function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
    const seen = new Set<string>()
    const deduped: T[] = []
    for (const item of items) {
        if (seen.has(item.url)) continue
        seen.add(item.url)
        deduped.push(item)
    }
    return deduped
}
