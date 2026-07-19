/**
 * lib/build/emdash-api.ts
 *
 * Build-time reader for CMS content served over EmDash's authenticated HTTP API.
 *
 * The public site is prerendered (see src/pages/[...slug].astro getStaticPaths and the chrome readers in
 * src/lib/content/*). Prerendering runs in Node during `astro build` with no D1 binding and no request
 * context, so EmDash's request-scoped readers (getEmDashCollection/getSiteSettings/getMenu) cannot run
 * here — they depend on AsyncLocalStorage + a bound D1. Instead we fetch published content, the general
 * settings, and the primary menu from the *already-deployed* worker's EmDash API (`/_emdash/api/...`).
 *
 * Auth. The endpoints sit behind Cloudflare Access (edge) and EmDash's own permission checks. A Cloudflare
 * Access *service token* (CF-Access-Client-Id/-Secret) passes the edge policy and is mapped by EmDash's
 * access() adapter to the default EDITOR role, which carries content:read, settings:read and menus:read
 * (see @emdash-cms/auth permission→role map). An EmDash personal access token (Authorization: Bearer
 * ec_pat_...) is also sent when configured, as a fallback for setups where the service token does not
 * resolve to EDITOR.
 *
 * Configuration — BUILD-TIME env only; never wrangler runtime secrets/vars:
 *   CONTENT_API_BASE         origin of the deployed site to read from, e.g. https://kilmer.nrnnet.xyz
 *   CF_ACCESS_CLIENT_ID      Cloudflare Access service-token client id
 *   CF_ACCESS_CLIENT_SECRET  Cloudflare Access service-token client secret
 *   EMDASH_API_TOKEN         optional EmDash PAT fallback
 *
 * Failure policy. A build with NO `CONTENT_API_BASE` (the bootstrap build, before any worker exists, and
 * CI's staging preview) reads nothing and completes: content pages are not generated and chrome falls back
 * to the src/consts.ts defaults. But once a CMS IS configured, a failed read **fails the build**
 * (`CmsReadError`). Falling soft there was a live-outage hazard: a rebuild during a CMS outage would emit
 * a `dist/` with every published page missing and deploy it over the working site. Stopping loudly leaves
 * the previously deployed version serving.
 *
 * Patience. Reads are deliberately slow to give up (see READ_TIMEOUT_MS). A short client timeout here does
 * not merely fail the build — it DEGRADES THE CMS for every other caller, because aborting mid-cold-start
 * poisons the worker isolate EmDash is initializing in. See READ_TIMEOUT_MS for the mechanism.
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
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
 * A published entry of a routed content collection (`pages` or `posts`): the fields the untemplated route
 * renders, plus what a design template needs to render it (the pivot's D4/D7 — an entry can name a
 * template that pulls its fields through outlets).
 *
 * One shape serves both collections. Where they differ, the reader normalizes (see
 * {@link fetchPublishedPosts}): a post's `excerpt` lands in `description`, and it has no `published_at`.
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
     * The entry's whole raw data record. An outlet may bind ANY field of the collection, so the named
     * fields above cannot be the only ones carried; they stay because the untemplated render path (D3)
     * consumes exactly them, unchanged.
     */
    fields: Record<string, unknown>
    /**
     * The `design` reference field: the `design_template` the entry renders through, or null when it
     * names none. EmDash's reference field is a raw text box, so this holds whatever the author typed —
     * either the template's **slug** (the human-readable key, e.g. "article") or its item **id**.
     * `route-authority` resolves both (the key spaces are disjoint), so either works.
     */
    designRef: string | null
}

/** The subset of EmDash General Settings the chrome consumes. */
export interface BuildSettings {
    title?: string
    tagline?: string
}

/** A single primary-menu entry, as authored in EmDash → Menus. */
export interface BuildMenuItem {
    label: string
    url: string
}

/** Resolved build-time API configuration; null when CONTENT_API_BASE is unset. */
interface ApiConfig {
    base: string
    headers: Record<string, string>
}

/**
 * Reads a build-time configuration value from either import.meta.env (Astro/Vite) or process.env (Node),
 * so the client works whether invoked through the Astro build or a plain Node context.
 */
function env(name: string): string | undefined {
    // import.meta.env is the Astro/Vite surface; process.env covers CI runners that only export to Node.
    return import.meta.env[name] ?? process.env[name]
}

/**
 * Resolves the API base and auth headers from build env, or returns null when CONTENT_API_BASE is unset
 * (e.g. the bootstrap build before a worker exists). Trailing slashes on the base are trimmed so paths
 * concatenate cleanly.
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
 * How long a single read may wait before the build gives up.
 *
 * This is sized against EmDash's WORST-CASE COLD START, not its typical response time (a healthy cold
 * init measures ~0.4s, and a warm one ~0). The first request into a cold worker isolate claims EmDash's
 * runtime init lock and every other request there queues behind it; a queued request only reclaims an
 * abandoned lock after RUNTIME_INIT_DEADLINE_MS (45s) and only gives up at its maxWait (60s) — see
 * node_modules/emdash/src/utils/init-lock.ts and astro/middleware.ts.
 *
 * Aborting below that budget is worse than slow: EmDash documents a client that disconnects mid-init as
 * poisoning the isolate — the lock's release never runs, so "every subsequent request in the isolate
 * hangs until the platform kills it". A 15s abort here therefore both failed the build AND left the CMS
 * unresponsive to everyone else until the isolate was evicted, which is the API "flapping" we chased.
 *
 * 75s clears the 60s ceiling with headroom. A build has no user waiting on it, so waiting a minute for a
 * cold CMS is strictly better than failing the deploy and degrading the live admin.
 *
 * Exported so a test can pin the invariant that matters — this must stay above EmDash's waiter budget.
 */
export const READ_TIMEOUT_MS = 75_000

/** EmDash's worst-case wait for a queued request (RUNTIME_INIT_DEADLINE_MS + MAX_WAIT_HEADROOM_MS). */
export const EMDASH_MAX_WAIT_MS = 60_000

/**
 * Total attempts per read (one initial + two retries). Retries matter because a lock reclaim surfaces as
 * an error on the request that triggered it, while the isolate is healthy immediately afterwards — so the
 * next attempt succeeds. Only transient failures are retried (see isRetryable).
 */
const READ_ATTEMPTS = 3

/** Linear backoff between attempts: 3s, then 6s. */
const RETRY_BACKOFF_MS = 3_000

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Whether a non-OK status is worth retrying. 5xx and 429 are transient (a cold or reclaiming isolate, a
 * throttle); a 4xx is a standing fact about the request — a bad token or a missing collection will read
 * exactly the same on the next attempt, so retrying only slows the build's failure down.
 */
function isRetryable(status: number): boolean {
    return status >= 500 || status === 429
}

/** Options for a single read. */
interface GetOptions {
    /**
     * Treat a 404 as "there is nothing here" (returns null) rather than a failed read. Only for a
     * collection whose *absence is a legitimate state* — e.g. `design_template` before the setup script
     * has created it. Never for a collection the site's routes depend on.
     */
    allowMissing?: boolean
}

/**
 * Thrown when the CMS is configured but a read did not succeed. Distinct from "no CMS configured", which
 * is a legitimate state (the bootstrap build) and still returns null.
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
 * GETs an EmDash API path and returns its `data` payload. EmDash wraps success responses as `{ data: T }`
 * (see src/api/error.ts apiSuccess); errors are `{ error: {...} }` with a non-2xx status.
 *
 * Failure policy turns on whether a CMS was configured at all:
 *  - **No `CONTENT_API_BASE`** → returns null, with one warning. This is the bootstrap build (and CI's
 *    staging preview), where no worker exists to read from; the site builds with no content by design.
 *  - **Configured but the read failed** (network error, timeout, non-OK status) → **throws**. The CMS was
 *    expected to answer, and a soft fallback here silently drops published pages out of `dist/`, which a
 *    deploy then publishes over the live site. A loud build failure keeps the previous version serving.
 *
 * A transient failure is retried (see READ_ATTEMPTS); only the last reason reaches the thrown error.
 *
 * Exported for `design-api.ts`, which reads the compositor collections over the same authenticated API
 * and must not duplicate the config/auth/timeout/retry handling.
 *
 * @param path an absolute API path beginning with "/_emdash/api/…"
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
 * Normalizes an EmDash slug to a catch-all route param: trims surrounding whitespace and slashes. Returns
 * null for a missing or empty slug (such an item cannot be routed and is skipped). Exported so design
 * pages normalize their slugs identically — the duplicate check in `route-authority.ts` is only sound if
 * both route sources agree on what a slug is.
 */
export function normalizeSlug(slug: string | null): string | null {
    const trimmed = slug?.trim().replace(/^\/+|\/+$/g, "")
    return trimmed ? trimmed : null
}

/**
 * Reads an EmDash `reference` field as the referenced item's id. A reference is stored as TEXT holding
 * that id, so anything else (absent, blank, a non-string) means "no reference" rather than a broken one.
 * Exported so every routed collection reads its `design` pointer identically.
 */
export function normalizeReference(value: unknown): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
}

/**
 * Fetches every published entry of one routed content collection, following cursor pagination to
 * completion. The routable slug is EmDash's top-level item `slug`; an item without one cannot be reached
 * by any URL and is skipped rather than treated as fatal.
 *
 * The whole `data` record is carried through as `fields` (a template's outlets may bind any field), and
 * `design` is surfaced as `designRef` — the pivot's per-entry template pointer (D4).
 *
 * The two routed collections do not agree on which field holds the meta description, so that one key is a
 * parameter; everything else is read by the same name from both. A field the collection does not define
 * (`posts` has no `published_at`) simply reads as absent, which is the D3 render's "no value" state.
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
 * Fetches every published `pages` entry. Field keys (title, description, content, published_at) mirror
 * the `pages` content type defined in the EmDash admin UI.
 *
 * @returns {Promise<BuildPage[]>} the published pages to prerender, in API order
 */
export function fetchPublishedPages(): Promise<BuildPage[]> {
    return fetchPublishedEntries("pages", "description")
}

/**
 * Fetches every published `posts` entry (pivot D8 — posts route through the same pipeline as pages).
 *
 * `posts` is shaped differently from `pages`: its blurb field is **`excerpt`**, and it has **no
 * `published_at`**, so a post carries no "last updated" date into the untemplated render. It does have a
 * `featured_image`, the only `image` field either routed collection defines — and therefore the only
 * field a `ContentImage` outlet can bind to anywhere on the site.
 *
 * The collection is read fail-LOUD (no `allowMissing`), like `pages` and unlike `design_template`: it is
 * an EmDash seed collection that exists in every environment, so a 404 here means the CMS is not the one
 * this build thinks it is, and quietly emitting a site with every post missing is the hazard #32 closed.
 *
 * @returns {Promise<BuildPage[]>} the published posts to prerender, in API order
 */
export function fetchPublishedPosts(): Promise<BuildPage[]> {
    return fetchPublishedEntries("posts", "excerpt")
}

/**
 * Build-time cache of the General Settings read, for the same reason as {@link getPageHrefMap}: every
 * page's chrome (`PublicPage.astro`, `PublicHeader.astro`, `PublicFooter.astro`'s `getFooter()`) calls
 * this once per render, and `astro build` runs prerendering as one Node process — without this, a build
 * of N pages fires 3N redundant reads of the same, rarely-changing settings row.
 */
let settingsCache: Promise<BuildSettings> | null = null

/**
 * Fetches EmDash's built-in General Settings (title, tagline). Returns {} on any read failure so callers
 * apply their own defaults. Cached for the life of one build process (see {@link settingsCache}).
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
 * Single-menu envelope (see emdash `handleMenuGet`: `{ ...menu, items }`). Items are the RAW repository
 * rows, not the resolved-URL shape EmDash's own templates get from its request-scoped `getMenu()` — that
 * resolver runs against a live D1 handle and isn't reachable over this REST endpoint. A "custom" item
 * carries its href in `customUrl`; a reference item ("page"/"post"/"taxonomy"/"collection") carries only
 * `referenceCollection`/`referenceId` and needs a content lookup this reader performs itself for "page"
 * and "post" (see {@link getPageHrefMap}); other reference kinds are still dropped (see fetchMenu).
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
 * Build-time cache of every published page/post id → its public href, keyed `"<collection>:<id>"`. Built
 * lazily the first time a menu names a "page" or "post" reference item (most menus are Custom URL only, so
 * this stays unbuilt for them) and reused for the rest of the build: `astro build` runs prerendering as one
 * Node process, and every page's `getNav`/`getFooterNav` call would otherwise re-read the whole `pages` and
 * `posts` collections from the CMS on every single page render.
 *
 * `referenceId` is the referenced entry's `translation_group` (see emdash's `resolveMenuItem`), not
 * necessarily its row id — but a fresh entry's `translation_group` defaults to its own id (emdash
 * content.ts: `let translationGroup: string = id`), and this project runs no i18n, so every entry is its
 * own translation group and `id` is the correct key.
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
 * render (a flat list ignores nested children). Two authoring shapes resolve:
 *  - **Custom URL** items use their typed-in `customUrl` directly.
 *  - **Page/Post reference** items resolve against the published `pages`/`posts` collections (see
 *    {@link getPageHrefMap}); a reference to a draft, deleted, or otherwise unpublished entry has no
 *    published href and is dropped, same as emdash's own live resolver would drop it.
 * Every other reference kind (taxonomy, custom-collection entries) is still dropped: resolving those needs
 * a content lookup this build-time reader doesn't perform. Author those as "Custom URL" in EmDash → Menus.
 *
 * Returns [] when the menu is missing or the read fails, so a site with no such menu authored simply
 * renders no links rather than failing the build.
 *
 * Cached per name for the life of one build process (see {@link getPageHrefMap}'s rationale — every
 * page's `getNav`/`getFooterNav` call would otherwise re-read and re-resolve the same menu once per page).
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

    const hrefMap = items.some((item) => item.type === "page" || item.type === "post")
        ? await getPageHrefMap()
        : null

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
