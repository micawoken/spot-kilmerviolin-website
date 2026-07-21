/**
 * lib/api/tokens.ts
 *
 * Issuance, hashing, and lookup primitives for the two token types defined in
 * docs/dev/plan-prelaunch-features.md §2: user-scoped API tokens (this file's Stage A surface) and
 * capability-scoped build tokens (Stage B).
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
