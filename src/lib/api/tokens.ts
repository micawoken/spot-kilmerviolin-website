/**
 * lib/api/tokens.ts
 *
 * Issuance, hashing, and lookup primitives for the two token types: user-scoped API tokens (this file's
 * Stage A surface) and capability-scoped build tokens (Stage B).
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

import { exec_string } from "./d1.ts"
import { authorizeContributorId } from "./authorize.ts"

/** Server-side allowlist for a token's lifetime. The client never supplies a date — only one of these
 * day counts — so "expiration under one year" is structural rather than merely validated. */
export const EXPIRY_WINDOWS_DAYS = [7, 30, 180, 365] as const
export type ExpiryWindowDays = (typeof EXPIRY_WINDOWS_DAYS)[number]
const MS_PER_DAY = 24 * 60 * 60 * 1000

export function isValidExpiryWindow(days: unknown): days is ExpiryWindowDays {
    return typeof days === "number" && (EXPIRY_WINDOWS_DAYS as readonly number[]).includes(days)
}

export function expiryWindowMs(days: ExpiryWindowDays): number {
    return days * MS_PER_DAY
}

/** A build token's lifetime: one of the day-count windows, or "never" for a token that does not expire.
 * Build tokens hold no identity and no write access (see buildTokenRouteAllowed), so an indefinite lifetime
 * only ever grants the same three read-only, full-list routes any other build token grants — it removes
 * rotation, not risk ceiling. User-scoped API tokens deliberately keep a mandatory expiry.
 *
 * That "removes rotation, not risk ceiling" claim did NOT hold while GET /api/v1/contributors served this
 * credential the unredacted table: the ceiling was every enrolled user's sign-in email plus the whole
 * authorization map, which is not a thing to hand out with an indefinite lifetime. The endpoint now
 * redacts server-side for the build-token branch (see BUILD_TOKEN_SCHEMA in pages/api/v1/contributors.ts),
 * which is what makes the rationale above true. If that redaction is ever removed, remove "never" too. */
export type BuildTokenExpiry = ExpiryWindowDays | "never"

export function isValidBuildTokenExpiry(value: unknown): value is BuildTokenExpiry {
    return value === "never" || isValidExpiryWindow(value)
}

/** null means the token never expires (stored as a NULL expires_date). */
export function buildTokenExpiresDate(entry_date: number, expiry: BuildTokenExpiry): number | null {
    return expiry === "never" ? null : entry_date + expiryWindowMs(expiry)
}

interface GeneratedSecret {
    /** The plaintext secret. Shown to the caller exactly once, at issue time; never stored. */
    secret: string
    /** A short, non-sensitive slice of the secret, stored alongside its hash for display/identification. */
    prefix: string
}

function base64url(bytes: Uint8Array): string {
    let binary = ""
    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** 32 random bytes, base64url-encoded, behind a type-identifying prefix (greppable in a leak scan). */
function generateSecret(type_prefix: string): GeneratedSecret {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const secret = `${type_prefix}${base64url(bytes)}`
    // enough of the random part to distinguish a caller's own tokens in a list, without exposing enough
    // to narrow a brute-force search
    return { secret, prefix: secret.slice(0, type_prefix.length + 6) }
}

export function generateApiTokenSecret(): GeneratedSecret {
    return generateSecret("skv_")
}

/** Distinct prefix from generateApiTokenSecret so a leak scan (or the two verification paths) can tell the
 * two token classes apart unambiguously. */
export function generateBuildTokenSecret(): GeneratedSecret {
    return generateSecret("skv_build_")
}

/**
 * SHA-256 of the presented secret, hex-encoded. Bare digest — no salt, no KDF. This is deliberate: a
 * 256-bit random token has no dictionary to defend against and nothing to correlate across users, so a
 * KDF would buy zero security here while adding real per-request latency (the same reasoning behind
 * GitHub's PAT storage). Only ever compared against a hash column; the plaintext is never persisted.
 */
export async function hashToken(secret: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret))
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
}

/** A row as returned to a token owner or admin — metadata only, never token_hash or the plaintext. */
export interface ApiTokenRow {
    id: number
    contributor_id: number
    label: string
    token_prefix: string
    entry_date: number
    expires_date: number
    revoked_date: number | null
}

interface ApiTokenLookupRow {
    id: number
    contributor_id: number
    revoked_date: number | null
    expires_date: number
}

export async function lookupApiTokenByHash(token_hash: string): Promise<ApiTokenLookupRow | null> {
    const result = await exec_string(
        "SELECT id, contributor_id, revoked_date, expires_date FROM api_tokens WHERE token_hash = ?;",
        [token_hash]
    )
    if (!result.success || result.results.length === 0) {
        return null
    }
    return result.results[0] as unknown as ApiTokenLookupRow
}

export async function listApiTokensForContributor(contributor_id: number): Promise<ApiTokenRow[]> {
    const result = await exec_string(
        "SELECT id, contributor_id, label, token_prefix, entry_date, expires_date, revoked_date " +
            "FROM api_tokens WHERE contributor_id = ? ORDER BY entry_date DESC;",
        [contributor_id]
    )
    return result.success ? (result.results as unknown as ApiTokenRow[]) : []
}

export async function listAllApiTokens(): Promise<ApiTokenRow[]> {
    const result = await exec_string(
        "SELECT id, contributor_id, label, token_prefix, entry_date, expires_date, revoked_date " +
            "FROM api_tokens ORDER BY entry_date DESC;"
    )
    return result.success ? (result.results as unknown as ApiTokenRow[]) : []
}

export async function insertApiToken(params: {
    contributor_id: number
    label: string
    token_hash: string
    token_prefix: string
    entry_date: number
    expires_date: number
}): Promise<number> {
    const result = await exec_string(
        "INSERT INTO api_tokens (contributor_id, label, token_hash, token_prefix, entry_date, expires_date) " +
            "VALUES (?, ?, ?, ?, ?, ?);",
        [
            params.contributor_id,
            params.label,
            params.token_hash,
            params.token_prefix,
            params.entry_date,
            params.expires_date
        ]
    )
    if (!result.success || result.meta.last_row_id === undefined) {
        throw new Error("Failed to insert api_tokens row")
    }
    return result.meta.last_row_id
}

/** The owning contributor_id for a token row, or null if no such row exists. Used to authorize a revoke. */
export async function getApiTokenOwner(id: number): Promise<number | null> {
    const result = await exec_string("SELECT contributor_id FROM api_tokens WHERE id = ?;", [id])
    if (!result.success || result.results.length === 0) {
        return null
    }
    return (result.results[0] as { contributor_id: number }).contributor_id
}

/** Idempotent: revoking an already-revoked (or nonexistent) id still reports success; state is untouched. */
export async function revokeApiToken(id: number, revoked_date: number): Promise<boolean> {
    const result = await exec_string("UPDATE api_tokens SET revoked_date = ? WHERE id = ? AND revoked_date IS NULL;", [
        revoked_date,
        id
    ])
    return result.success
}

/**
 * Resolves a presented API-token secret to the Identity of the contributor who issued it, or null when the
 * token is unknown, revoked, expired, or its owning contributor no longer resolves. Does not check the
 * owner's active state — that is left to the endpoint's `auth_check`, exactly as for a cookie-authenticated
 * request, so a deactivated owner's token fails there for free.
 */
export async function resolveApiTokenIdentity(secret: string, now: number): Promise<Identity | null> {
    const hash = await hashToken(secret)
    const row = await lookupApiTokenByHash(hash)
    if (row === null || row.revoked_date !== null || row.expires_date <= now) {
        return null
    }
    return authorizeContributorId(row.contributor_id)
}

/** A row as returned to an admin managing build tokens — metadata only, never token_hash or the plaintext.
 * There is no owning contributor to attribute (the token can never write). expires_date is null for a token
 * issued with "never" as its expiry. */
export interface BuildTokenRow {
    id: number
    label: string
    token_prefix: string
    entry_date: number
    expires_date: number | null
    revoked_date: number | null
}

interface BuildTokenLookupRow {
    id: number
    revoked_date: number | null
    expires_date: number | null
}

export async function lookupBuildTokenByHash(token_hash: string): Promise<BuildTokenLookupRow | null> {
    const result = await exec_string("SELECT id, revoked_date, expires_date FROM build_tokens WHERE token_hash = ?;", [
        token_hash
    ])
    if (!result.success || result.results.length === 0) {
        return null
    }
    return result.results[0] as unknown as BuildTokenLookupRow
}

/** Whether a build_tokens row with this id exists at all (regardless of revoked/expired state). Used only
 * to return 404 vs 204 from the revoke endpoint — build tokens have no owner to authorize against. */
export async function buildTokenExists(id: number): Promise<boolean> {
    const result = await exec_string("SELECT id FROM build_tokens WHERE id = ?;", [id])
    return result.success && result.results.length > 0
}

export async function listBuildTokens(): Promise<BuildTokenRow[]> {
    const result = await exec_string(
        "SELECT id, label, token_prefix, entry_date, expires_date, revoked_date " +
            "FROM build_tokens ORDER BY entry_date DESC;"
    )
    return result.success ? (result.results as unknown as BuildTokenRow[]) : []
}

export async function insertBuildToken(params: {
    label: string
    token_hash: string
    token_prefix: string
    entry_date: number
    expires_date: number | null
}): Promise<number> {
    const result = await exec_string(
        "INSERT INTO build_tokens (label, token_hash, token_prefix, entry_date, expires_date) VALUES (?, ?, ?, ?, ?);",
        [params.label, params.token_hash, params.token_prefix, params.entry_date, params.expires_date]
    )
    if (!result.success || result.meta.last_row_id === undefined) {
        throw new Error("Failed to insert build_tokens row")
    }
    return result.meta.last_row_id
}

/** Idempotent: revoking an already-revoked (or nonexistent) id still reports success; state is untouched. */
export async function revokeBuildToken(id: number, revoked_date: number): Promise<boolean> {
    const result = await exec_string(
        "UPDATE build_tokens SET revoked_date = ? WHERE id = ? AND revoked_date IS NULL;",
        [revoked_date, id]
    )
    return result.success
}

/**
 * Whether a build token exists, is not revoked, and is not expired (a null expires_date never expires).
 * Unlike resolveApiTokenIdentity this resolves no Identity — a build token grants no identity, only (via
 * buildTokenRouteAllowed) access to a small, fixed set of read-only routes.
 */
export async function verifyBuildToken(secret: string, now: number): Promise<boolean> {
    const hash = await hashToken(secret)
    const row = await lookupBuildTokenByHash(hash)
    return row !== null && row.revoked_date === null && (row.expires_date === null || row.expires_date > now)
}

/** The three full-list, read-only collection routes a build token may call. Nothing else — not even
 * /api/v1/composers/[id] — is permitted (D9: capability-scoped, read/list-only, default-deny). */
const BUILD_TOKEN_ALLOWED_PATHS: ReadonlySet<string> = new Set([
    "api/v1/composers",
    "api/v1/works",
    "api/v1/contributors"
])

/**
 * Pure predicate, the single source of truth for what a build token may call: true iff the request is a GET
 * against exactly one of the three whitelisted collection routes. Enforced centrally in
 * middleware/identity.ts so no individual endpoint can forget the check.
 */
export function buildTokenRouteAllowed(method: string, path_components: string[]): boolean {
    return method === "GET" && BUILD_TOKEN_ALLOWED_PATHS.has(path_components.join("/"))
}
