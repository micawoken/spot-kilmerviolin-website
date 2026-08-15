/**
 * lib/build/emdash-api.ts
 *
 * Build-time HTTP reader for EmDash CMS content
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

/**
 * A published entry of a routed content collection (`pages` or `posts`)
 */
export interface BuildPage {
    /** the EmDash item id — what a `reference` field on another item points at */
    id: string
    /** the on-site path segment(s), without a leading or trailing slash (e.g. "about", "docs/setup") */
    slug: string
    title: string
    description: string
    /** the rich-text body as an EmDash Portable-Text block array (rendered via emdash/ui PortableText) */
    content: unknown
    /** the authored publish date, or null when the field is blank */
    published_at: string | null
    /**
     * The entry's whole raw data record
     */
    fields: Record<string, unknown>
    /**
     * The `design` reference field: the `design_template` the entry renders through, or null
     */
    designRef: string | null
}

/** The subset of EmDash General Settings the chrome consumes. */
export interface BuildSettings {
    title?: string
    tagline?: string
}

/** A single primary-menu entry, as authored in EmDash -> Menus. */
export interface BuildMenuItem {
    label: string
    url: string
}

/** Resolved build-time API configuration; null when CONTENT_API_BASE is unset. */
interface ApiConfig {
    base: string
    headers: Record<string, string>
}

/** Build-time config value: `import.meta.env` (Astro/Vite), fallback `process.env` (Node/CI). */
function env(name: string): string | undefined {
    return import.meta.env[name] ?? process.env[name]
}

/**
 * Resolves the API base and auth headers from build env, or returns null when CONTENT_API_BASE is unset
 */
function getConfig(): ApiConfig | null {
    const base = env("CONTENT_API_BASE")?.replace(/\/+$/, "")
    if (!base) return null

    const headers: Record<string, string> = { Accept: "application/json" }
    const clientId = env("CF_ACCESS_CLIENT_ID")
    const clientSecret = env("CF_ACCESS_CLIENT_SECRET")
    if (clientId && clientSecret) {
        headers["CF-Access-Client-Id"] = clientId
        headers["CF-Access-Client-Secret"] = clientSecret
    }
    const pat = env("EMDASH_API_TOKEN")
    if (pat) headers["Authorization"] = `Bearer ${pat}`

    return { base, headers }
}

// Emit the "not configured" warning at most once per build so the log stays readable.
let warnedUnconfigured = false

/**
 * How long a single read may wait before the build gives up
 */
export const READ_TIMEOUT_MS = 75_000

/** EmDash's worst-case wait for a queued request (RUNTIME_INIT_DEADLINE_MS + MAX_WAIT_HEADROOM_MS). */
export const EMDASH_MAX_WAIT_MS = 60_000

/**
 * Total attempts per read (one initial + two retries)
 */
const READ_ATTEMPTS = 3

/** Linear backoff between attempts: 3s, then 6s. */
const RETRY_BACKOFF_MS = 3_000

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Whether a non-OK status is worth retrying
 */
function isRetryable(status: number): boolean {
    return status >= 500 || status === 429
}

/** Options for a single read. */
interface GetOptions {
    /**
     * Treat a 404 as "there is nothing here" (returns null) rather than a failed read
     */
    allowMissing?: boolean
}

/**
 * Thrown when the CMS is configured but a read did not succeed. Distinct from "no CMS configured"
 */
export class CmsReadError extends Error {
    constructor(path: string, reason: string) {
        super(
            `[build/emdash-api] GET ${path} failed: ${reason}\n` +
                "CONTENT_API_BASE is set, so the CMS was expected to answer. The build is stopping rather " +
                "than emitting a site with content missing — a fail-soft rebuild during a CMS outage would " +
                "publish empty pages over the live ones. Check the API's health and rebuild."
        )
        this.name = "CmsReadError"
    }
}

/**
 * GETs an EmDash API path and returns its `data` payload
 *
 * @param path an absolute API path beginning with "/_emdash/api/..."
 * @param options see {@link GetOptions}
 * @throws {CmsReadError} when a configured CMS fails to answer the read
 */
export async function emdashGet<T>(path: string, options: GetOptions = {}): Promise<T | null> {
    const config = getConfig()
    if (!config) {
        if (!warnedUnconfigured) {
            console.warn(
                "[build/emdash-api] CONTENT_API_BASE is unset — skipping CMS reads; content pages will " +
                    "not be generated and site chrome falls back to consts.ts defaults."
            )
            warnedUnconfigured = true
        }
        return null
    }

    let reason = "no attempt was made"

    for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
        if (attempt > 1) {
            console.warn(
                `[build/emdash-api] GET ${path} failed (${reason}); retrying ` +
                    `(attempt ${attempt} of ${READ_ATTEMPTS})`
            )
            await sleep(RETRY_BACKOFF_MS * (attempt - 1))
        }

        let response: Response
        try {
            // Generous by design — a short abort here poisons the isolate. See READ_TIMEOUT_MS.
            response = await fetch(`${config.base}${path}`, {
                headers: config.headers,
                signal: AbortSignal.timeout(READ_TIMEOUT_MS)
            })
        } catch (error) {
            // A network error or timeout: the CMS may be cold or mid-reclaim, so this is worth retrying.
            reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
            continue
        }

        if (response.status === 404 && options.allowMissing) return null

        if (response.ok) {
            const body = (await response.json()) as { data?: T }
            return body.data ?? null
        }

        reason =
            `${response.status} ${response.statusText}` +
            (response.status === 401 || response.status === 403
                ? " — check the Access service token and that its EmDash role grants read permission"
                : "")
        // A 4xx is a standing fact about this request; retrying it only delays the failure.
        if (!isRetryable(response.status)) break
    }

    throw new CmsReadError(path, reason)
}

/** EmDash content item as returned by the list API (subset; see emdash `ContentItem`). */
export interface ApiContentItem {
    id: string
    slug: string | null
    status: string
    data: Record<string, unknown> | null
}

/** Cursor-paginated list envelope (see emdash `ListResult`). */
export interface ApiListResult {
    items: ApiContentItem[]
    nextCursor?: string
}

/**
 * Normalizes an EmDash slug to a catch-all route param
 */
export function normalizeSlug(slug: string | null): string | null {
    const trimmed = slug?.trim().replace(/^\/+|\/+$/g, "")
    return trimmed ? trimmed : null
}

/**
 * Reads an EmDash `reference` field as the referenced item's id
 */
export function normalizeReference(value: unknown): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
}

/**
 * Fetches every published entry of one routed content collection, following cursor pagination to
 * completion
 *
 * @param {string} collection - the EmDash collection slug ("pages" or "posts")
 * @param {string} descriptionField - the field whose value becomes the page's meta description
 * @returns {Promise<BuildPage[]>} the published entries to prerender, in API order
 * @throws {CmsReadError} when a configured CMS fails the read
 */
async function fetchPublishedEntries(collection: string, descriptionField: string): Promise<BuildPage[]> {
    const entries: BuildPage[] = []
    let cursor: string | undefined

    do {
        const query = new URLSearchParams({ status: "published", limit: "100" })
        if (cursor) query.set("cursor", cursor)
        const result = await emdashGet<ApiListResult>(`/_emdash/api/content/${collection}?${query.toString()}`)
        if (!result?.items) break

        for (const item of result.items) {
            const slug = normalizeSlug(item.slug)
            if (!slug) continue
            const data = item.data ?? {}
            const description = data[descriptionField]
            entries.push({
                id: item.id,
                slug,
                title: typeof data.title === "string" ? data.title : "",
                description: typeof description === "string" ? description : "",
                content: data.content ?? [],
                published_at: typeof data.published_at === "string" ? data.published_at : null,
                fields: data,
                designRef: normalizeReference(data.design)
            })
        }
        cursor = result.nextCursor
    } while (cursor)

    return entries
}

/**
 * Fetches every published `pages` entry
 *
 * @returns {Promise<BuildPage[]>} the published pages to prerender, in API order
 */
export function fetchPublishedPages(): Promise<BuildPage[]> {
    if (!publishedPagesCache) publishedPagesCache = fetchPublishedEntries("pages", "description")
    return publishedPagesCache
}

/** Build-time cache backing {@link fetchPublishedPages}. */
let publishedPagesCache: Promise<BuildPage[]> | null = null

/**
 * Fetches every published `posts` entry
 *
 * @returns {Promise<BuildPage[]>} the published posts to prerender, in API order
 */
export function fetchPublishedPosts(): Promise<BuildPage[]> {
    if (!publishedPostsCache) publishedPostsCache = fetchPublishedEntries("posts", "excerpt")
    return publishedPostsCache
}

/** Build-time cache backing {@link fetchPublishedPosts}. */
let publishedPostsCache: Promise<BuildPage[]> | null = null

/**
 * Build-time cache of the General Settings read, for the same reason as {@link getPageHrefMap}
 */
let settingsCache: Promise<BuildSettings> | null = null

/**
 * Fetches EmDash's built-in General Settings (title, tagline)
 *
 * @returns {Promise<BuildSettings>} the resolved settings, or an empty object
 */
export function fetchSettings(): Promise<BuildSettings> {
    if (!settingsCache) {
        settingsCache = emdashGet<BuildSettings>("/_emdash/api/settings").then((data) => data ?? {})
    }
    return settingsCache
}

/**
 * Single-menu envelope (see emdash `handleMenuGet`: `{ ...menu, items }`)
 */
interface ApiMenu {
    items?: Array<{
        label?: string | null
        type?: string | null
        customUrl?: string | null
        referenceCollection?: string | null
        referenceId?: string | null
    }>
}

/**
 * Build-time cache of every published page/post id
 */
let pageHrefCache: Promise<Map<string, string>> | null = null

function getPageHrefMap(): Promise<Map<string, string>> {
    if (!pageHrefCache) {
        pageHrefCache = Promise.all([fetchPublishedPages(), fetchPublishedPosts()]).then(([pages, posts]) => {
            const map = new Map<string, string>()
            // mirrors the two route-naming rules pages/[...slug].astro applies when it emits these same
            // entries as static routes: the "home"-slug page owns "/", and every post sits under "/posts/"
            // (lib/build/route-authority.ts POSTS_PREFIX — inlined here rather than imported, since that
            // module imports BuildPage's *type* from this one and a value import back would invert it)
            for (const page of pages) map.set(`pages:${page.id}`, page.slug === "home" ? "/" : `/${page.slug}`)
            for (const post of posts) map.set(`posts:${post.id}`, `/posts/${post.slug}`)
            return map
        })
    }
    return pageHrefCache
}

/**
 * Fetches the top-level items of a named EmDash menu, resolving each to a {label, href} the chrome can
 * render (a flat list ignores nested children)
 *
 * @param {string} name - the EmDash menu name (e.g. "primary" for the header, "footer" for the footer)
 * @returns {Promise<BuildMenuItem[]>} the menu's links in authored order
 */
export function fetchMenu(name: string): Promise<BuildMenuItem[]> {
    let cached = menuCache.get(name)
    if (!cached) {
        cached = resolveMenu(name)
        menuCache.set(name, cached)
    }
    return cached
}

/** Build-time cache backing {@link fetchMenu}, keyed by menu name. */
const menuCache = new Map<string, Promise<BuildMenuItem[]>>()

async function resolveMenu(name: string): Promise<BuildMenuItem[]> {
    // allowMissing: an unauthored menu (e.g. no "footer" menu created yet) 404s: that's a legitimate site
    // state (chrome falls back to no links), not a CMS outage — see the allowMissing doc on GetOptions.
    const menu = await emdashGet<ApiMenu>(`/_emdash/api/menus/${name}`, { allowMissing: true })
    const items = menu?.items ?? []
    if (items.length === 0) {
        return []
    }

    const hrefMap = items.some((item) => item.type === "page" || item.type === "post") ? await getPageHrefMap() : null

    const resolved: BuildMenuItem[] = []
    for (const item of items) {
        if (!item.label) {
            continue
        }
        if (item.type === "custom") {
            if (item.customUrl) {
                resolved.push({ label: item.label, url: item.customUrl })
            }
            continue
        }
        if ((item.type === "page" || item.type === "post") && item.referenceId && hrefMap) {
            const collection = item.referenceCollection || `${item.type}s`
            const url = hrefMap.get(`${collection}:${item.referenceId}`)
            if (url) {
                resolved.push({ label: item.label, url })
            }
        }
    }
    return resolved
}
