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
 * All reads fail soft: on missing config, a network/auth error, or a non-OK response they log loudly and
 * return empty data so the build still completes (notably the first build, before any worker is deployed).
 * Content pages are then simply not generated, and chrome falls back to the src/consts.ts defaults.
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

/** A published CMS page, flattened to the fields the public route renders. */
export interface BuildPage {
    /** the on-site path segment(s), without a leading or trailing slash (e.g. "about", "docs/setup") */
    slug: string
    title: string
    description: string
    /** the rich-text body as an EmDash Portable-Text block array (rendered via emdash/ui PortableText) */
    content: unknown
    /** the authored publish date, or null when the field is blank */
    published_at: string | null
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
 * GETs an EmDash API path and returns its `data` payload, or null on any failure. EmDash wraps success
 * responses as `{ data: T }` (see src/api/error.ts apiSuccess); errors are `{ error: {...} }` with a
 * non-2xx status. Failures are logged and swallowed so the caller can fall back.
 *
 * Exported for `design-api.ts`, which reads the compositor collections over the same authenticated API
 * and must not duplicate the config/auth/timeout handling.
 *
 * @param path an absolute API path beginning with "/_emdash/api/…"
 */
export async function emdashGet<T>(path: string): Promise<T | null> {
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

    try {
        // Bound the request so a slow or unreachable API can never hang the build; a timeout fails soft
        // like any other read error.
        const response = await fetch(`${config.base}${path}`, {
            headers: config.headers,
            signal: AbortSignal.timeout(15000)
        })
        if (!response.ok) {
            console.error(
                `[build/emdash-api] GET ${path} → ${response.status} ${response.statusText}; ` +
                    "check the Access service token and that its EmDash role grants read permission."
            )
            return null
        }
        const body = (await response.json()) as { data?: T }
        return body.data ?? null
    } catch (error) {
        console.error(`[build/emdash-api] GET ${path} failed:`, error)
        return null
    }
}

/** EmDash content item as returned by the list API (subset; see emdash `ContentItem`). */
export interface ApiContentItem {
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
 * Fetches every published entry of the `pages` content type, following cursor pagination to completion.
 * Field keys (title, description, content, published_at) mirror the `pages` content type defined in the
 * EmDash admin UI; the routable slug is EmDash's top-level item `slug`. Returns [] on any read failure.
 *
 * @returns {Promise<BuildPage[]>} the published pages to prerender, in API order
 */
export async function fetchPublishedPages(): Promise<BuildPage[]> {
    const pages: BuildPage[] = []
    let cursor: string | undefined

    do {
        const query = new URLSearchParams({ status: "published", limit: "100" })
        if (cursor) query.set("cursor", cursor)
        const result = await emdashGet<ApiListResult>(`/_emdash/api/content/pages?${query.toString()}`)
        if (!result?.items) break

        for (const item of result.items) {
            const slug = normalizeSlug(item.slug)
            if (!slug) continue
            const data = item.data ?? {}
            pages.push({
                slug,
                title: typeof data.title === "string" ? data.title : "",
                description: typeof data.description === "string" ? data.description : "",
                content: data.content ?? [],
                published_at: typeof data.published_at === "string" ? data.published_at : null
            })
        }
        cursor = result.nextCursor
    } while (cursor)

    return pages
}

/**
 * Fetches EmDash's built-in General Settings (title, tagline). Returns {} on any read failure so callers
 * apply their own defaults.
 *
 * @returns {Promise<BuildSettings>} the resolved settings, or an empty object
 */
export async function fetchSettings(): Promise<BuildSettings> {
    const data = await emdashGet<BuildSettings>("/_emdash/api/settings")
    return data ?? {}
}

/** Single-menu envelope (see emdash `handleMenuGet`: `{ ...menu, items }`). */
interface ApiMenu {
    items?: Array<{ label?: string | null; url?: string | null }>
}

/**
 * Fetches the top-level items of the `primary` menu, keeping only entries with both a label and a URL
 * (a flat header ignores nested children). Returns [] when the menu is missing or the read fails.
 *
 * @returns {Promise<BuildMenuItem[]>} the header links in authored order
 */
export async function fetchPrimaryMenu(): Promise<BuildMenuItem[]> {
    const menu = await emdashGet<ApiMenu>("/_emdash/api/menus/primary")
    return (menu?.items ?? [])
        .filter((item): item is { label: string; url: string } => Boolean(item.label) && Boolean(item.url))
        .map((item) => ({ label: item.label, url: item.url }))
}
