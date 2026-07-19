/**
 * lib/build/d1-api.ts
 *
 * Build-time reader for the D1-backed entity tables (composers, contributors, compositions) — the
 * runtime SQLite records administered by src/lib/api/database.ts, not to be confused with EmDash's
 * `pages`/`posts` collections (see emdash-api.ts). Reads Cloudflare's D1 REST query endpoint directly
 * (`POST /accounts/{account}/d1/database/{database}/query`), because `astro build` runs in a plain
 * Node process with no D1 binding — src/lib/api/d1.ts's schema constants embed `env.DB_MAIN` from
 * `cloudflare:workers` at module scope, which only resolves inside a Worker — and no app-level
 * build-token mechanism exists yet for `/api/v1/*` (see docs/dev/handoff-entity-page-generation.md
 * for the full reasoning and the planned future migration to that endpoint).
 *
 * Configuration — BUILD-TIME env only; never wrangler runtime secrets/vars (see .env.example):
 *   D1_API_TOKEN     Cloudflare API token scoped to "D1: Read" on this account
 *   D1_ACCOUNT_ID    Cloudflare account id (not secret; mirrors wrangler.jsonc's top-level account_id)
 *   D1_DATABASE_ID   DB_MAIN's database id (not secret; mirrors wrangler.jsonc's DB_MAIN binding)
 *
 * Failure policy mirrors emdash-api.ts: unconfigured (any of the three unset) returns null and the
 * build completes without entity pages — the bootstrap build has no reason to have these set. Once
 * configured, a failed read THROWS ({@link D1ReadError}) rather than falling soft: silently emitting
 * zero entity records over a build that already has published ones would regress the public site the
 * same way a swallowed EmDash read would (see emdash-api.ts's CmsReadError for the identical
 * reasoning — a build has no user waiting on it, so failing loud and leaving the previous deploy
 * serving beats publishing a site with entity pages missing).
 *
 * Timeout. Unlike emdash-api.ts's 75s READ_TIMEOUT_MS (sized against a possibly-cold EmDash Worker
 * isolate's request-queue init lock), this hits Cloudflare's D1 control-plane REST API, which has no
 * such cold-start hazard. A conventional REST timeout applies here — do not copy the 75s figure or
 * its cold-start reasoning into this module.
 *
 * Columns. Every read selects the schema's explicit column list (see d1-schema.ts), never `SELECT *`.
 * {@link redactProtected} (also d1-schema.ts) is a DENYLIST keyed on the schema's `protected` array —
 * under `SELECT *`, any column the DB later gains would flow through a converter's `...data` spread
 * un-redacted until `protected` is updated to match. An explicit column allowlist forecloses that.
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

import { formatCompFromD1, formatContribFromD1, formatWorkFromD1 } from "../api/common"
import { COMPOSER_SCHEMA, COMPOSITION_SCHEMA, CONTRIBUTOR_SCHEMA, redactProtected, type BuildD1Schema } from "./d1-schema"

/** Resolved build-time D1 REST configuration; null when any of the three env vars is unset. */
interface D1Config {
    accountId: string
    databaseId: string
    token: string
}

/**
 * Reads a build-time configuration value from either import.meta.env (Astro/Vite) or process.env
 * (Node), so the client works whether invoked through the Astro build or a plain Node context.
 * Mirrors emdash-api.ts's identical helper.
 */
function env(name: string): string | undefined {
    return import.meta.env[name] ?? process.env[name]
}

// Emit the "not configured" warning at most once per build so the log stays readable.
let warnedUnconfigured = false

function getConfig(): D1Config | null {
    const accountId = env("D1_ACCOUNT_ID")
    const databaseId = env("D1_DATABASE_ID")
    const token = env("D1_API_TOKEN")
    if (!accountId || !databaseId || !token) {
        if (!warnedUnconfigured) {
            console.warn(
                "[build/d1-api] D1_API_TOKEN/D1_ACCOUNT_ID/D1_DATABASE_ID are not fully set — skipping " +
                    "entity page generation for composers/contributors/compositions."
            )
            warnedUnconfigured = true
        }
        return null
    }
    return { accountId, databaseId, token }
}

/**
 * How long a single query may wait before the build gives up. Sized as a conventional REST timeout —
 * see the module header for why this is deliberately NOT emdash-api.ts's 75s cold-start figure.
 */
export const D1_READ_TIMEOUT_MS = 20_000

/** Total attempts per query (one initial + two retries), for transient failures only (see isRetryable). */
const READ_ATTEMPTS = 3

/** Linear backoff between attempts: 1s, then 2s. */
const RETRY_BACKOFF_MS = 1_000

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 5xx and 429 are transient (an overloaded or throttling API); a 4xx is a standing fact about the request. */
function isRetryable(status: number): boolean {
    return status >= 500 || status === 429
}

/**
 * Thrown when D1 is configured but a query did not succeed. Distinct from "not configured", which is
 * a legitimate state (the bootstrap build) and returns null instead.
 */
export class D1ReadError extends Error {
    constructor(table: string, reason: string) {
        super(
            `[build/d1-api] query on '${table}' failed: ${reason}\n` +
                "D1_API_TOKEN/D1_ACCOUNT_ID/D1_DATABASE_ID are set, so the read was expected to succeed. " +
                "The build is stopping rather than emitting entity pages with records silently missing."
        )
        this.name = "D1ReadError"
    }
}

/** Cloudflare's D1 query API response envelope (subset). */
interface D1QueryResponse {
    success?: boolean
    errors?: Array<{ message: string }>
    result?: Array<{ results?: Record<string, string | number | null>[] }>
}

/**
 * Queries every row of one table, selecting exactly the schema's column list (never `*`; see the
 * module header). Returns null when D1 is unconfigured; throws {@link D1ReadError} when configured
 * but the read does not succeed.
 *
 * @param schema the table's build-safe schema (see d1-schema.ts)
 * @returns the raw rows (D1 column shapes, not yet converted), or null when unconfigured
 * @throws {D1ReadError} when a configured read fails
 */
async function fetchTable(schema: BuildD1Schema): Promise<Record<string, string | number | null>[] | null> {
    const config = getConfig()
    if (!config) return null

    const url = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${config.databaseId}/query`
    const sql = `SELECT ${schema.columns.join(", ")} FROM ${schema.name};`

    let reason = "no attempt was made"

    for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
        if (attempt > 1) {
            console.warn(
                `[build/d1-api] query on '${schema.name}' failed (${reason}); retrying ` +
                    `(attempt ${attempt} of ${READ_ATTEMPTS})`
            )
            await sleep(RETRY_BACKOFF_MS * (attempt - 1))
        }

        let response: Response
        try {
            response = await fetch(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${config.token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ sql }),
                signal: AbortSignal.timeout(D1_READ_TIMEOUT_MS)
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

        let body: D1QueryResponse
        try {
            body = await response.json()
        } catch (error) {
            reason = `invalid JSON response: ${error instanceof Error ? error.message : String(error)}`
            continue
        }

        if (!body.success) {
            // An API-level failure (bad SQL, a token scoped wrong) reads the same on every retry.
            reason = body.errors?.map((e) => e.message).join("; ") || "the API reported failure with no error detail"
            break
        }

        return body.result?.[0]?.results ?? []
    }

    throw new D1ReadError(schema.name, reason)
}

/**
 * Fetches every composer record. Composers have no protected columns — the record is returned as-is.
 *
 * @returns every composer, or null when D1 is unconfigured
 * @throws {D1ReadError} when D1 is configured but the read fails
 */
export async function fetchComposers(): Promise<ComposerRecord[] | null> {
    const rows = await fetchTable(COMPOSER_SCHEMA)
    if (!rows) return null
    return rows.map((row) => formatCompFromD1(row as unknown as D1Composer))
}

/**
 * Fetches every contributor record, unredacted, active or not. Exported for `entity-records.ts`'s
 * `buildReferenceIndex`, which needs `id`/`name`/`active` for EVERY contributor a composition might
 * reference — a composition may legitimately reference an inactive or otherwise non-public contributor,
 * and `name` alone is not a protected column. Never pass this array's rows to a public page directly;
 * only the resolved `{id, name, href}` reference the normalizer builds from it may reach a render — use
 * {@link fetchContributors} for a contributor's own public page.
 *
 * @returns every contributor, unredacted, or null when D1 is unconfigured
 * @throws {D1ReadError} when D1 is configured but the read fails
 */
export async function fetchAllContributors(): Promise<ContributorRecord[] | null> {
    const rows = await fetchTable(CONTRIBUTOR_SCHEMA)
    if (!rows) return null
    return rows.map((row) => formatContribFromD1(row as unknown as D1Contributor))
}

/**
 * Fetches the contributor records eligible for their own public page: only `active` contributors,
 * each with its protected/identity columns (`roles`, `admin`, `identity_email`) stripped. The public
 * build reads D1 directly rather than through `/api/v1/*`, so this reader must redact itself — see
 * the module header.
 *
 * @returns active, redacted contributors, or null when D1 is unconfigured
 * @throws {D1ReadError} when D1 is configured but the read fails
 */
export async function fetchContributors(): Promise<ContributorRecord[] | null> {
    const all = await fetchAllContributors()
    if (!all) return null
    return all
        .filter((contributor) => contributor.active)
        .map((contributor) => redactProtected(CONTRIBUTOR_SCHEMA, contributor) as unknown as ContributorRecord)
}

/**
 * Fetches every composition, in its flat D1 record shape. Foreign-key resolution (composer/contributor
 * names, public-page hrefs) is no longer done here — `entity-records.ts`'s `entityRecords`/
 * `buildReferenceIndex` do it once, for every noun uniformly, as part of the unified field-outlet
 * rewrite. This function is now a thin mirror of `fetchComposers`/`fetchContributors`.
 *
 * @returns every composition, or null when D1 is unconfigured
 * @throws {D1ReadError} when D1 is configured but the read fails
 */
export async function fetchCompositions(): Promise<CompositionRecord[] | null> {
    const rows = await fetchTable(COMPOSITION_SCHEMA)
    if (!rows) return null
    return rows.map((row) => formatWorkFromD1(row as unknown as D1Composition))
}
