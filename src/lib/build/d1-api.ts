/**
 * lib/build/d1-api.ts
 *
 * Build-time reader for the D1-backed entity tables (composers, contributors, compositions) — the
 * runtime SQLite records administered by src/lib/api/database.ts, not to be confused with EmDash's
 * `pages`/`posts` collections (see emdash-api.ts). Reads the deployed Worker's own
 * `GET /api/v1/{composers,contributors,works}` endpoints, authenticated with a build token (see
 * src/lib/api/tokens.ts, docs/dev/plan-prelaunch-features.md §2 D9), because `astro build` runs in a
 * plain Node process with no D1 binding — src/lib/api/d1.ts's schema constants embed `env.DB_MAIN` from
 * `cloudflare:workers` at module scope, which only resolves inside a Worker.
 *
 * This supersedes an earlier version of this file that read Cloudflare's D1 REST query endpoint
 * directly with a broad, account-scoped "D1: Read" API token. A build token is scoped to exactly these
 * three read-only routes and carries no write/admin capability, so a leaked build token exposes far
 * less than a leaked D1 REST token did (see docs/dev/handoff-entity-page-generation.md for the original
 * reasoning this replaces).
 *
 * Response shape. Unlike the old D1 REST reads (raw D1 rows requiring formatCompFromD1/
 * formatContribFromD1/formatWorkFromD1 to convert), GET /api/v1/{composers,contributors,works} with
 * meta.full=true already returns the application-level *Record shape (the same one listComposers/
 * listContributors/listCompositions produce) as its JSON `payload` — so this reader no longer converts
 * anything, only fetches and trusts the shape.
 *
 * Configuration — BUILD-TIME env only; never wrangler runtime secrets/vars (see .env.example):
 *   CONTENT_API_BASE         origin of the deployed site (shared with emdash-api.ts)
 *   CF_ACCESS_CLIENT_ID      Cloudflare Access service-token client id (shared with emdash-api.ts;
 *   CF_ACCESS_CLIENT_SECRET  mandatory here too — a build token alone authenticates nothing, D3)
 *   BUILD_API_TOKEN          the app-issued build token (X-Build-Token); see /admin/advanced/tokens/build
 *
 * Failure policy mirrors the file this replaces: unconfigured (any of the four unset) returns null and
 * the build completes without entity pages — the bootstrap build has no reason to have these set. Once
 * configured, a failed read THROWS ({@link BuildTokenReadError}) rather than falling soft: silently
 * emitting zero entity records over a build that already has published ones would regress the public
 * site the same way a swallowed EmDash read would (see emdash-api.ts's CmsReadError for the identical
 * reasoning).
 *
 * Timeout. This hits the same deployed Worker as emdash-api.ts, but NOT the EmDash package's own
 * cold-start init-lock path (that lock lives inside node_modules/emdash and only guards `/_emdash/*`) —
 * an Astro API route has no such hazard, so a conventional REST timeout applies here. Do not copy
 * emdash-api.ts's 75s READ_TIMEOUT_MS or its cold-start reasoning into this module.
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

import { CONTRIBUTOR_SCHEMA, redactProtected } from "./d1-schema"

/** Resolved build-time API configuration; null when any of the four env vars is unset. */
interface BuildApiConfig {
    base: string
    headers: Record<string, string>
}

/**
 * Reads a build-time configuration value from either import.meta.env (Astro/Vite) or process.env
 * (Node), so the client works whether invoked through the Astro build or a plain Node context. Mirrors
 * emdash-api.ts's identical helper.
 */
function env(name: string): string | undefined {
    return import.meta.env[name] ?? process.env[name]
}

// Emit the "not configured" warning at most once per build so the log stays readable.
let warnedUnconfigured = false

/**
 * Resolves the API base and auth headers from build env, or returns null when any of
 * CONTENT_API_BASE/CF_ACCESS_CLIENT_ID/CF_ACCESS_CLIENT_SECRET/BUILD_API_TOKEN is unset (e.g. the
 * bootstrap build before a worker exists). The Access service-token headers are mandatory here (unlike
 * emdash-api.ts, where they are an optional fallback path) because Access is the mandatory outer gate
 * for every token type (D3) — a build token alone authenticates nothing.
 */
function getConfig(): BuildApiConfig | null {
    const base = env("CONTENT_API_BASE")?.replace(/\/+$/, "")
    const clientId = env("CF_ACCESS_CLIENT_ID")
    const clientSecret = env("CF_ACCESS_CLIENT_SECRET")
    const buildToken = env("BUILD_API_TOKEN")
    if (!base || !clientId || !clientSecret || !buildToken) {
        if (!warnedUnconfigured) {
            console.warn(
                "[build/d1-api] CONTENT_API_BASE/CF_ACCESS_CLIENT_ID/CF_ACCESS_CLIENT_SECRET/BUILD_API_TOKEN " +
                    "are not fully set — skipping entity page generation for composers/contributors/compositions."
            )
            warnedUnconfigured = true
        }
        return null
    }
    return {
        base,
        headers: {
            Accept: "application/json",
            "CF-Access-Client-Id": clientId,
            "CF-Access-Client-Secret": clientSecret,
            "X-Build-Token": buildToken,
            "X-MWMSC-Request-Meta": JSON.stringify({ full: true })
        }
    }
}

/**
 * How long a single query may wait before the build gives up. Sized as a conventional REST timeout —
 * see the module header for why this is deliberately NOT emdash-api.ts's 75s cold-start figure.
 */
export const BUILD_API_READ_TIMEOUT_MS = 20_000

/** Total attempts per query (one initial + two retries), for transient failures only (see isRetryable). */
const READ_ATTEMPTS = 3

/** Linear backoff between attempts: 1s, then 2s. */
const RETRY_BACKOFF_MS = 1_000

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 5xx and 429 are transient (an overloaded or throttling Worker); a 4xx is a standing fact about the request. */
function isRetryable(status: number): boolean {
    return status >= 500 || status === 429
}

/**
 * Thrown when the build API is configured but a query did not succeed. Distinct from "not configured",
 * which is a legitimate state (the bootstrap build) and returns null instead.
 */
export class BuildTokenReadError extends Error {
    constructor(path: string, reason: string) {
        super(
            `[build/d1-api] GET ${path} failed: ${reason}\n` +
                "CONTENT_API_BASE/CF_ACCESS_CLIENT_ID/CF_ACCESS_CLIENT_SECRET/BUILD_API_TOKEN are all set, " +
                "so the read was expected to succeed. The build is stopping rather than emitting entity " +
                "pages with records silently missing."
        )
        this.name = "BuildTokenReadError"
    }
}

/** The app's standard API envelope (see src/lib/api/common.ts createAPIPayload). */
interface ApiEnvelope<T> {
    success: boolean
    payload: T | null
    comment: string
}

/**
 * GETs one of the three build-token-whitelisted collection routes with meta.full=true and returns its
 * already-formatted records. Returns null when the build API is unconfigured; throws
 * {@link BuildTokenReadError} when configured but the read does not succeed.
 *
 * @param path an absolute API path, one of "/api/v1/composers", "/api/v1/contributors", "/api/v1/works"
 * @returns the record array, or null when unconfigured
 * @throws {BuildTokenReadError} when a configured read fails
 */
async function fetchFullCollection<T>(path: string): Promise<T[] | null> {
    const config = getConfig()
    if (!config) return null

    let reason = "no attempt was made"

    for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
        if (attempt > 1) {
            console.warn(`[build/d1-api] GET ${path} failed (${reason}); retrying (attempt ${attempt} of ${READ_ATTEMPTS})`)
            await sleep(RETRY_BACKOFF_MS * (attempt - 1))
        }

        let response: Response
        try {
            response = await fetch(`${config.base}${path}`, {
                headers: config.headers,
                signal: AbortSignal.timeout(BUILD_API_READ_TIMEOUT_MS)
            })
        } catch (error) {
            reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
            continue
        }

        if (!response.ok) {
            reason = `${response.status} ${response.statusText}`
            if (!isRetryable(response.status)) break
            continue
        }

        let body: ApiEnvelope<T[]>
        try {
            body = await response.json()
        } catch (error) {
            reason = `invalid JSON response: ${error instanceof Error ? error.message : String(error)}`
            continue
        }

        if (!body.success) {
            // An API-level failure (invalid meta, an unrecognized token) reads the same on every retry.
            reason = body.comment || "the API reported failure with no error detail"
            break
        }

        return body.payload ?? []
    }

    throw new BuildTokenReadError(path, reason)
}

/**
 * Fetches every composer record. Composers have no protected columns — the record is returned as-is.
 *
 * @returns every composer, or null when the build API is unconfigured
 * @throws {BuildTokenReadError} when configured but the read fails
 */
export function fetchComposers(): Promise<ComposerRecord[] | null> {
    return fetchFullCollection<ComposerRecord>("/api/v1/composers")
}

/**
 * Fetches every contributor record, unredacted, active or not. Exported for `entity-records.ts`'s
 * `buildReferenceIndex`, which needs `id`/`name`/`active` for EVERY contributor a composition might
 * reference — a composition may legitimately reference an inactive or otherwise non-public contributor,
 * and `name` alone is not a protected column. Never pass this array's rows to a public page directly;
 * only the resolved `{id, name, href}` reference the normalizer builds from it may reach a render — use
 * {@link fetchContributors} for a contributor's own public page.
 *
 * @returns every contributor, unredacted, or null when the build API is unconfigured
 * @throws {BuildTokenReadError} when configured but the read fails
 */
export function fetchAllContributors(): Promise<ContributorRecord[] | null> {
    return fetchFullCollection<ContributorRecord>("/api/v1/contributors")
}

/**
 * Fetches the contributor records eligible for their own public page: only `active` contributors, each
 * with its protected/identity columns (`roles`, `admin`, `identity_email`) stripped. The build-token
 * endpoint branch returns the complete, unredacted set (same as the identity.admin branch) with no
 * active-filter, so this reader still redacts and filters itself — there is no server-side chokepoint
 * scoped to "public build reader" specifically.
 *
 * @returns active, redacted contributors, or null when the build API is unconfigured
 * @throws {BuildTokenReadError} when configured but the read fails
 */
export async function fetchContributors(): Promise<ContributorRecord[] | null> {
    const all = await fetchAllContributors()
    if (!all) return null
    return all
        .filter((contributor) => contributor.active)
        .map((contributor) => redactProtected(CONTRIBUTOR_SCHEMA, contributor) as unknown as ContributorRecord)
}

/**
 * Fetches every composition, in its already-resolved record shape. Foreign-key resolution
 * (composer/contributor names, public-page hrefs) is done once, for every noun uniformly, by
 * `entity-records.ts`'s `entityRecords`/`buildReferenceIndex` as part of the unified field-outlet
 * rewrite — this function is a thin mirror of `fetchComposers`/`fetchContributors`.
 *
 * @returns every composition, or null when the build API is unconfigured
 * @throws {BuildTokenReadError} when configured but the read fails
 */
export function fetchCompositions(): Promise<CompositionRecord[] | null> {
    return fetchFullCollection<CompositionRecord>("/api/v1/works")
}
