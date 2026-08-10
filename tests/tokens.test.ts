/**
 * tests/tokens.test.ts
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

/// <reference path="../src/lib/api/types.d.ts" />

/**
 * Tests for the user-scoped API token primitives (docs/dev/plan-prelaunch-features.md §2, Stage A):
 * secret generation/hashing (src/lib/api/tokens.ts), DB-backed lookup/issue/revoke, resolution to an
 * Identity (authorizeContributorId), and the D2 guard (token-authenticated requests cannot manage tokens).
 */

import { describe, it, expect, beforeAll } from "vitest"
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test"

import {
    EXPIRY_WINDOWS_DAYS,
    isValidExpiryWindow,
    expiryWindowMs,
    generateApiTokenSecret,
    hashToken,
    lookupApiTokenByHash,
    listApiTokensForContributor,
    listAllApiTokens,
    insertApiToken,
    getApiTokenOwner,
    revokeApiToken,
    resolveApiTokenIdentity
} from "../src/lib/api/tokens.ts"
import { authorizeContributorId, requiresAllOf } from "../src/lib/api/authorize.ts"
import { exec_string } from "../src/lib/api/d1.ts"
import { addContributor } from "../src/lib/api/db_contributor.ts"
import { GET as tokensGET, POST as tokensPOST } from "../src/pages/api/v1/tokens.ts"
import { DELETE as tokenDELETE } from "../src/pages/api/v1/tokens/[id].ts"

// mirrors the contributors table definition in d1.ts (the init string there is module-private)
const contributors_ddl = `
CREATE TABLE IF NOT EXISTS contributors (
contributor_id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT UNIQUE NOT NULL,
class_year INTEGER,
major TEXT,
phases TEXT,
bio TEXT,
public_email TEXT,
identity_email TEXT UNIQUE NOT NULL,
active INTEGER NOT NULL,
roles TEXT NOT NULL,
admin INTEGER NOT NULL,
image TEXT,
tags TEXT,
entry_date INTEGER NOT NULL,
change_date INTEGER NOT NULL
);`

// mirrors db_add_api_tokens.sql
const api_tokens_ddl = `
CREATE TABLE IF NOT EXISTS api_tokens (
id INTEGER PRIMARY KEY AUTOINCREMENT,
contributor_id INTEGER NOT NULL,
label TEXT NOT NULL,
token_hash TEXT NOT NULL UNIQUE,
token_prefix TEXT NOT NULL,
entry_date INTEGER NOT NULL,
expires_date INTEGER NOT NULL,
revoked_date INTEGER,
FOREIGN KEY (contributor_id) REFERENCES contributors(contributor_id) ON UPDATE CASCADE ON DELETE CASCADE
);`

function makeContributor(overrides: Partial<Contributor> & Pick<Contributor, "name" | "identity_email">): Contributor {
    return {
        class_year: 2026,
        major: "Music",
        phases: [1, 2],
        bio: "A test contributor.",
        public_email: "pub@example.com",
        active: true,
        admin: false,
        roles: [],
        tags: [],
        image: null,
        ...overrides
    }
}

async function withCtx<T>(fn: (ctx: ExecutionContext) => Promise<T>): Promise<T> {
    const ctx = createExecutionContext()
    const result = await fn(ctx)
    await waitOnExecutionContext(ctx)
    return result
}

/** Builds a minimal Identity for the endpoint-level tests below (D2 guard, validation). */
function makeIdentity(overrides: Partial<Identity> = {}): Identity {
    const base = {
        sub: "sub-test",
        email: "token-test@example.com",
        nbf: 0,
        exp: Number.POSITIVE_INFINITY,
        allowed: true,
        active: true,
        enrollable: false,
        roles: [] as string[],
        id: 1,
        admin: false,
        userinfo: {
            ok: true,
            name: "User",
            tags: [],
            phases: [],
            entry_date: null,
            class_year: null,
            major: null,
            bio: null,
            public_email: null,
            image: null,
            change_date: null
        },
        permissions: {} as IdentityPermissions,
        ...overrides
    }
    return base
}

beforeAll(async () => {
    await exec_string(contributors_ddl)
    await exec_string(api_tokens_ddl)
})

describe("generateApiTokenSecret / hashToken", () => {
    it("generates distinct, skv_-prefixed secrets", () => {
        const a = generateApiTokenSecret()
        const b = generateApiTokenSecret()
        expect(a.secret).not.toBe(b.secret)
        expect(a.secret.startsWith("skv_")).toBe(true)
        expect(a.prefix.startsWith("skv_")).toBe(true)
        expect(a.secret.startsWith(a.prefix)).toBe(true)
    })

    it("hashes to a stable, lowercase hex digest that differs from the input", async () => {
        const { secret } = generateApiTokenSecret()
        const hash1 = await hashToken(secret)
        const hash2 = await hashToken(secret)
        expect(hash1).toBe(hash2)
        expect(hash1).not.toBe(secret)
        expect(hash1).toMatch(/^[0-9a-f]{64}$/)
    })

    it("hashes different secrets to different digests", async () => {
        const a = await hashToken(generateApiTokenSecret().secret)
        const b = await hashToken(generateApiTokenSecret().secret)
        expect(a).not.toBe(b)
    })
})

describe("expiry window validation", () => {
    it("accepts every allowlisted window", () => {
        for (const days of EXPIRY_WINDOWS_DAYS) {
            expect(isValidExpiryWindow(days)).toBe(true)
        }
    })

    it("rejects an out-of-set or non-numeric value", () => {
        expect(isValidExpiryWindow(1)).toBe(false)
        expect(isValidExpiryWindow(90)).toBe(false)
        expect(isValidExpiryWindow("30")).toBe(false)
        expect(isValidExpiryWindow(undefined)).toBe(false)
    })

    it("computes the expiry window in milliseconds", () => {
        expect(expiryWindowMs(7)).toBe(7 * 24 * 60 * 60 * 1000)
        expect(expiryWindowMs(365)).toBe(365 * 24 * 60 * 60 * 1000)
    })
})

describe("api_tokens DB operations and resolution", () => {
    it("issues, looks up, lists, and resolves a valid token to its owner's Identity", async () => {
        const contributor_id = await withCtx((ctx) =>
            addContributor(
                ctx,
                makeContributor({
                    name: "Token Owner",
                    identity_email: "token-owner@example.com",
                    active: true,
                    roles: ["reviewer"]
                })
            )
        )

        const { secret, prefix } = generateApiTokenSecret()
        const token_hash = await hashToken(secret)
        const entry_date = Date.now()
        const expires_date = entry_date + expiryWindowMs(30)
        const id = await insertApiToken({
            contributor_id,
            label: "test token",
            token_hash,
            token_prefix: prefix,
            entry_date,
            expires_date
        })
        expect(id).toBeGreaterThan(0)

        const lookup = await lookupApiTokenByHash(token_hash)
        expect(lookup).not.toBeNull()
        expect(lookup!.contributor_id).toBe(contributor_id)
        expect(lookup!.revoked_date).toBeNull()

        const owned = await listApiTokensForContributor(contributor_id)
        expect(owned.some((row) => row.id === id)).toBe(true)
        // token_hash must never appear in a listing row
        expect(owned.find((row) => row.id === id)).not.toHaveProperty("token_hash")

        const all = await listAllApiTokens()
        expect(all.some((row) => row.id === id)).toBe(true)

        const owner = await getApiTokenOwner(id)
        expect(owner).toBe(contributor_id)

        const identity = await resolveApiTokenIdentity(secret, Date.now())
        expect(identity).not.toBeNull()
        expect(identity!.id).toBe(contributor_id)
        expect(identity!.email).toBe("token-owner@example.com")
        expect(identity!.roles).toEqual(["reviewer"])
    })

    it("returns null for an unknown hash", async () => {
        expect(await lookupApiTokenByHash("0".repeat(64))).toBeNull()
        expect(await resolveApiTokenIdentity("skv_does-not-exist", Date.now())).toBeNull()
    })

    it("returns null for a revoked token", async () => {
        const contributor_id = await withCtx((ctx) =>
            addContributor(ctx, makeContributor({ name: "Revoked Owner", identity_email: "revoked-owner@example.com" }))
        )
        const { secret } = generateApiTokenSecret()
        const token_hash = await hashToken(secret)
        const entry_date = Date.now()
        const id = await insertApiToken({
            contributor_id,
            label: "to be revoked",
            token_hash,
            token_prefix: "skv_xx",
            entry_date,
            expires_date: entry_date + expiryWindowMs(30)
        })

        expect(await resolveApiTokenIdentity(secret, Date.now())).not.toBeNull()

        const revoked_ok = await revokeApiToken(id, Date.now())
        expect(revoked_ok).toBe(true)
        expect(await resolveApiTokenIdentity(secret, Date.now())).toBeNull()

        // revoking an already-revoked token is idempotent: still reports success, state unchanged
        const revoked_again = await revokeApiToken(id, Date.now())
        expect(revoked_again).toBe(true)
        const lookup = await lookupApiTokenByHash(token_hash)
        expect(lookup!.revoked_date).not.toBeNull()
    })

    it("returns null for an expired token", async () => {
        const contributor_id = await withCtx((ctx) =>
            addContributor(ctx, makeContributor({ name: "Expired Owner", identity_email: "expired-owner@example.com" }))
        )
        const { secret } = generateApiTokenSecret()
        const token_hash = await hashToken(secret)
        const now = Date.now()
        await insertApiToken({
            contributor_id,
            label: "already expired",
            token_hash,
            token_prefix: "skv_xx",
            entry_date: now - 1000,
            expires_date: now - 1 // expired one millisecond ago
        })
        expect(await resolveApiTokenIdentity(secret, now)).toBeNull()
    })

    it("resolves to an inactive Identity when the owning contributor has been deactivated", async () => {
        const contributor_id = await withCtx((ctx) =>
            addContributor(
                ctx,
                makeContributor({ name: "Inactive Owner", identity_email: "inactive-owner@example.com", active: false })
            )
        )
        const { secret } = generateApiTokenSecret()
        const token_hash = await hashToken(secret)
        const entry_date = Date.now()
        await insertApiToken({
            contributor_id,
            label: "inactive owner token",
            token_hash,
            token_prefix: "skv_xx",
            entry_date,
            expires_date: entry_date + expiryWindowMs(30)
        })

        const identity = await resolveApiTokenIdentity(secret, Date.now())
        // resolution itself succeeds (the token is valid); active-state enforcement is left to the
        // endpoint's auth_check, mirroring the cookie-authenticated path
        expect(identity).not.toBeNull()
        expect(identity!.active).toBe(false)
    })

    it("returns null when the owning contributor id no longer resolves", async () => {
        expect(await authorizeContributorId(999999)).toBeNull()
    })
})

describe("no escalation: a token inherits only its owner's permissions", () => {
    it("denies a permission the owner's roles do not grant", async () => {
        const contributor_id = await withCtx((ctx) =>
            addContributor(
                ctx,
                makeContributor({
                    name: "Limited Owner",
                    identity_email: "limited-owner@example.com",
                    roles: ["reviewer"] // does not carry user_addition
                })
            )
        )
        const identity = await authorizeContributorId(contributor_id)
        expect(identity).not.toBeNull()
        expect(requiresAllOf(["user_addition"], identity!)).toBe(false)
        expect(requiresAllOf(["overrides_lockout"], identity!)).toBe(true)
    })
})

describe("POST/GET/DELETE /api/v1/tokens refuse token-authenticated requests (D2)", () => {
    const request = new Request("https://localhost/api/v1/tokens")

    it("GET refuses a token-authenticated caller", async () => {
        const response = await tokensGET({
            request,
            locals: { identity: makeIdentity(), tokenAuth: true }
        } as any)
        expect(response.status).toBe(403)
    })

    it("POST refuses a token-authenticated caller", async () => {
        const response = await tokensPOST({
            request: new Request("https://localhost/api/v1/tokens", { method: "POST" }),
            locals: { identity: makeIdentity(), tokenAuth: true }
        } as any)
        expect(response.status).toBe(403)
    })

    it("DELETE refuses a token-authenticated caller", async () => {
        const response = await tokenDELETE({
            params: { id: "1" },
            request: new Request("https://localhost/api/v1/tokens/1", { method: "DELETE" }),
            locals: { identity: makeIdentity(), tokenAuth: true }
        } as any)
        expect(response.status).toBe(403)
    })
})

describe("POST /api/v1/tokens validation", () => {
    it("rejects a missing label", async () => {
        const response = await tokensPOST({
            request: new Request("https://localhost/api/v1/tokens", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify([{ expiry_days: 30 }])
            }),
            locals: { identity: makeIdentity() }
        } as any)
        expect(response.status).toBe(400)
    })

    it("rejects an out-of-allowlist expiry_days", async () => {
        const response = await tokensPOST({
            request: new Request("https://localhost/api/v1/tokens", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify([{ label: "test", expiry_days: 999 }])
            }),
            locals: { identity: makeIdentity() }
        } as any)
        expect(response.status).toBe(400)
    })

    it("issues a token and returns the plaintext secret exactly once, never a hash", async () => {
        const contributor_id = await withCtx((ctx) =>
            addContributor(ctx, makeContributor({ name: "Issuer", identity_email: "issuer@example.com" }))
        )
        const response = await tokensPOST({
            request: new Request("https://localhost/api/v1/tokens", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify([{ label: "issued via test", expiry_days: 7 }])
            }),
            locals: { identity: makeIdentity({ id: contributor_id }) }
        } as any)
        expect(response.status).toBe(201)
        const body = (await response.json()) as { payload: { id: number; secret: string; token_prefix: string } }
        expect(typeof body.payload.secret).toBe("string")
        expect(body.payload.secret.startsWith("skv_")).toBe(true)
        expect(body.payload).not.toHaveProperty("token_hash")

        // the row stored server-side carries only the hash/prefix, never the plaintext
        const owned = await listApiTokensForContributor(contributor_id)
        const row = owned.find((r) => r.id === body.payload.id)
        expect(row).toBeDefined()
        expect(JSON.stringify(row)).not.toContain(body.payload.secret)
    })
})
