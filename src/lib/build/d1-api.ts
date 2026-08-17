/**
 * lib/build/d1-api.ts
 *
 * Build-time reader for the D1-backed entity tables
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

import { CONTRIBUTOR_SCHEMA, isHiddenContributor, redactProtected } from "./d1-schema"

/** Resolved build-time API configuration; null when any of the four env vars is unset. */
interface BuildApiConfig {
    base: string
    headers: Record<string, string>
}

/** Build-time config value: `import.meta.env`, fallback `process.env`. Deliberate duplicate of emdash-api.ts's helper, not shared (see module header). */
function env(name: string): string | undefined {
    return import.meta.env[name] ?? process.env[name]
}

// Emit the "not configured" warning at most once per build so the log stays readable.
let warnedUnconfigured = false

/**
 * Resolves the API base and auth headers from build env, or returns null when any of
 * CONTENT_API_BASE/CF_ACCESS_CLIENT_ID/CF_ACCESS_CLIENT_SECRET/BUILD_API_TOKEN is unset
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
                    "are not fully set - skipping entity page generation for composers/contributors/compositions."
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
 * How long a single query may wait before the build gives up. Sized as a conventional REST timeout -
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
            console.warn(
                `[build/d1-api] GET ${path} failed (${reason}); retrying (attempt ${attempt} of ${READ_ATTEMPTS})`
            )
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
 * Fetches every composer record. Composers have no protected columns - the record is returned as-is.
 * Cached for the life of one build process (see {@link composersCache}).
 *
 * @returns every composer, or null when the build API is unconfigured
 * @throws {BuildTokenReadError} when configured but the read fails
 */
export function fetchComposers(): Promise<ComposerRecord[] | null> {
    if (!composersCache) composersCache = fetchFullCollection<ComposerRecord>("/api/v1/composers")
    return composersCache
}

/**
 * Build-time cache backing {@link fetchComposers}, same rationale as design-api.ts's `themeCache`/
 * `pageHrefCache`
 */
let composersCache: Promise<ComposerRecord[] | null> | null = null

/**
 * Fetches every contributor record, unredacted, hidden or not
 *
 * Cached for the life of one build process (see {@link allContributorsCache}).
 *
 * @returns every contributor, unredacted, or null when the build API is unconfigured
 * @throws {BuildTokenReadError} when configured but the read fails
 */
export function fetchAllContributors(): Promise<ContributorRecord[] | null> {
    if (!allContributorsCache) allContributorsCache = fetchFullCollection<ContributorRecord>("/api/v1/contributors")
    return allContributorsCache
}

/** Build-time cache backing {@link fetchAllContributors} (and, through it, {@link fetchContributors}) - same rationale as {@link composersCache}. */
let allContributorsCache: Promise<ContributorRecord[] | null> | null = null

/**
 * Fetches the contributor records eligible for their own public page: every contributor NOT tagged
 * `hidden` (see {@link isHiddenContributor})
 *
 * @returns redacted, non-hidden contributors, or null when the build API is unconfigured
 * @throws {BuildTokenReadError} when configured but the read fails
 */
export async function fetchContributors(): Promise<ContributorRecord[] | null> {
    const all = await fetchAllContributors()
    if (!all) return null
    return all
        .filter((contributor) => !isHiddenContributor(contributor))
        .map((contributor) => redactProtected(CONTRIBUTOR_SCHEMA, contributor) as unknown as ContributorRecord)
}

/**
 * Fetches every composition, in its already-resolved record shape
 *
 * Cached for the life of one build process (see {@link compositionsCache})
 *
 * @returns every composition, or null when the build API is unconfigured
 * @throws {BuildTokenReadError} when configured but the read fails
 */
export function fetchCompositions(): Promise<CompositionRecord[] | null> {
    if (!compositionsCache) compositionsCache = fetchFullCollection<CompositionRecord>("/api/v1/works")
    return compositionsCache
}

/** Build-time cache backing {@link fetchCompositions} - same rationale as {@link composersCache}. */
let compositionsCache: Promise<CompositionRecord[] | null> | null = null
