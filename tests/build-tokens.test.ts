/**
 * tests/build-tokens.test.ts
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
 * Tests for the build-token primitives (docs/dev/plan-prelaunch-features.md §2, Stage B, decision D9):
 * secret generation (src/lib/api/tokens.ts), the buildTokenRouteAllowed default-deny predicate, DB-backed
 * issue/lookup/verify/revoke, the D2 guard on the management endpoints (a token-authenticated request
 * cannot manage tokens), and the "meta full:true required" validation on the three whitelisted collection
 * GETs. Mirrors tests/tokens.test.ts's Stage A conventions: function-level, not middleware-level — the full
 * request path (Access + X-Build-Token, the middleware's route whitelist enforcement) is covered by the
 * plan's manual staging E2E, not here (see the plan's Verification section for why: this project's identity
 * middleware short-circuits authorization checks entirely for a "localhost"-hostname request, which is what
 * every in-process test constructs, so testing auth_check's admin/permission enforcement through it here
 * would assert nothing real).
 */

import { describe, it, expect, beforeAll } from "vitest"

import {
    generateBuildTokenSecret,
    generateApiTokenSecret,
    hashToken,
    expiryWindowMs,
    lookupBuildTokenByHash,
    listBuildTokens,
    insertBuildToken,
    revokeBuildToken,
    buildTokenExists,
    verifyBuildToken,
    buildTokenRouteAllowed,
    isValidBuildTokenExpiry,
    buildTokenExpiresDate
} from "../src/lib/api/tokens.ts"
import { exec_string } from "../src/lib/api/d1.ts"
import { GET as buildTokensGET, POST as buildTokensPOST } from "../src/pages/api/v1/tokens/build.ts"
import { DELETE as buildTokenDELETE } from "../src/pages/api/v1/tokens/build/[id].ts"
import { GET as composersGET } from "../src/pages/api/v1/composers.ts"
import { GET as worksGET } from "../src/pages/api/v1/works.ts"
import { GET as contributorsGET } from "../src/pages/api/v1/contributors.ts"

// mirrors db_add_build_tokens.sql
const build_tokens_ddl = `
CREATE TABLE IF NOT EXISTS build_tokens (
id INTEGER PRIMARY KEY AUTOINCREMENT,
label TEXT NOT NULL,
token_hash TEXT NOT NULL UNIQUE,
token_prefix TEXT NOT NULL,
entry_date INTEGER NOT NULL,
expires_date INTEGER,
revoked_date INTEGER
);`

/** Builds a minimal admin Identity for the endpoint-level tests below (D2 guard, validation). */
function makeAdminIdentity(): Identity {
    return {
        sub: "sub-test",
        email: "build-token-test@example.com",
        nbf: 0,
        exp: Number.POSITIVE_INFINITY,
        allowed: true,
        active: true,
        enrollable: false,
        roles: [],
        id: 1,
        admin: true,
        userinfo: {
            ok: true,
            name: "Admin",
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
        permissions: {} as IdentityPermissions
    }
}

beforeAll(async () => {
    await exec_string(build_tokens_ddl)
})

describe("generateBuildTokenSecret", () => {
    it("is distinctly prefixed from generateApiTokenSecret, so a leak scan tells the two apart", () => {
        const build = generateBuildTokenSecret()
        const api = generateApiTokenSecret()
        expect(build.secret.startsWith("skv_build_")).toBe(true)
        expect(build.prefix.startsWith("skv_build_")).toBe(true)
        expect(api.secret.startsWith("skv_build_")).toBe(false)
    })
})

describe("buildTokenRouteAllowed — the single default-deny chokepoint", () => {
    it("allows GET on exactly the three whitelisted collection routes", () => {
        expect(buildTokenRouteAllowed("GET", ["api", "v1", "composers"])).toBe(true)
        expect(buildTokenRouteAllowed("GET", ["api", "v1", "works"])).toBe(true)
        expect(buildTokenRouteAllowed("GET", ["api", "v1", "contributors"])).toBe(true)
    })

    it("denies every non-GET method on an otherwise-whitelisted route", () => {
        expect(buildTokenRouteAllowed("POST", ["api", "v1", "composers"])).toBe(false)
        expect(buildTokenRouteAllowed("PATCH", ["api", "v1", "composers"])).toBe(false)
        expect(buildTokenRouteAllowed("PUT", ["api", "v1", "composers"])).toBe(false)
        expect(buildTokenRouteAllowed("DELETE", ["api", "v1", "composers"])).toBe(false)
    })

    it("denies a single-record route", () => {
        expect(buildTokenRouteAllowed("GET", ["api", "v1", "composers", "1"])).toBe(false)
    })

    it("denies the token-management routes themselves", () => {
        expect(buildTokenRouteAllowed("GET", ["api", "v1", "tokens"])).toBe(false)
        expect(buildTokenRouteAllowed("GET", ["api", "v1", "tokens", "build"])).toBe(false)
    })

    it("denies an unrelated route", () => {
        expect(buildTokenRouteAllowed("GET", ["api", "v1", "identity"])).toBe(false)
        expect(buildTokenRouteAllowed("GET", ["admin"])).toBe(false)
    })
})

describe("build_tokens DB operations and verification", () => {
    it("issues, looks up, lists, and verifies a valid token", async () => {
        const { secret, prefix } = generateBuildTokenSecret()
        const token_hash = await hashToken(secret)
        const entry_date = Date.now()
        const expires_date = entry_date + expiryWindowMs(30)
        const id = await insertBuildToken({ label: "ci build", token_hash, token_prefix: prefix, entry_date, expires_date })
        expect(id).toBeGreaterThan(0)

        const lookup = await lookupBuildTokenByHash(token_hash)
        expect(lookup).not.toBeNull()
        expect(lookup!.revoked_date).toBeNull()

        const all = await listBuildTokens()
        expect(all.some((row) => row.id === id)).toBe(true)
        // token_hash must never appear in a listing row
        expect(all.find((row) => row.id === id)).not.toHaveProperty("token_hash")

        expect(await verifyBuildToken(secret, Date.now())).toBe(true)
        expect(await buildTokenExists(id)).toBe(true)
    })

    it("fails verification for an unknown token", async () => {
        expect(await verifyBuildToken("skv_build_does-not-exist", Date.now())).toBe(false)
    })

    it("fails verification for a revoked token, and revoke is idempotent", async () => {
        const { secret } = generateBuildTokenSecret()
        const token_hash = await hashToken(secret)
        const entry_date = Date.now()
        const id = await insertBuildToken({
            label: "to revoke",
            token_hash,
            token_prefix: "skv_build_x",
            entry_date,
            expires_date: entry_date + expiryWindowMs(30)
        })

        expect(await verifyBuildToken(secret, Date.now())).toBe(true)
        expect(await revokeBuildToken(id, Date.now())).toBe(true)
        expect(await verifyBuildToken(secret, Date.now())).toBe(false)

        // revoking an already-revoked token is idempotent: still reports success, state unchanged
        expect(await revokeBuildToken(id, Date.now())).toBe(true)
        const lookup = await lookupBuildTokenByHash(token_hash)
        expect(lookup!.revoked_date).not.toBeNull()
    })

    it("fails verification for an expired token", async () => {
        const { secret } = generateBuildTokenSecret()
        const token_hash = await hashToken(secret)
        const now = Date.now()
        await insertBuildToken({
            label: "already expired",
            token_hash,
            token_prefix: "skv_build_y",
            entry_date: now - 1000,
            expires_date: now - 1 // expired one millisecond ago
        })
        expect(await verifyBuildToken(secret, now)).toBe(false)
    })

    it("buildTokenExists is false for a nonexistent id", async () => {
        expect(await buildTokenExists(999999)).toBe(false)
    })

    it("issues and verifies a token with expiry 'never' (null expires_date, no future expiration)", async () => {
        const { secret, prefix } = generateBuildTokenSecret()
        const token_hash = await hashToken(secret)
        const entry_date = Date.now()
        const expires_date = buildTokenExpiresDate(entry_date, "never")
        expect(expires_date).toBeNull()

        const id = await insertBuildToken({ label: "never expires", token_hash, token_prefix: prefix, entry_date, expires_date })
        expect(id).toBeGreaterThan(0)

        const lookup = await lookupBuildTokenByHash(token_hash)
        expect(lookup!.expires_date).toBeNull()
        // still valid arbitrarily far in the future
        expect(await verifyBuildToken(secret, Date.now() + expiryWindowMs(365) * 100)).toBe(true)
    })
})

describe("isValidBuildTokenExpiry / buildTokenExpiresDate", () => {
    it("accepts every allowed day window and 'never'", () => {
        for (const days of [7, 30, 180, 365]) {
            expect(isValidBuildTokenExpiry(days)).toBe(true)
        }
        expect(isValidBuildTokenExpiry("never")).toBe(true)
    })

    it("rejects an out-of-allowlist number and other strings", () => {
        expect(isValidBuildTokenExpiry(999)).toBe(false)
        expect(isValidBuildTokenExpiry("forever")).toBe(false)
        expect(isValidBuildTokenExpiry(undefined)).toBe(false)
    })

    it("computes a concrete future date for a day window, null for 'never'", () => {
        const entry_date = Date.now()
        expect(buildTokenExpiresDate(entry_date, 30)).toBe(entry_date + expiryWindowMs(30))
        expect(buildTokenExpiresDate(entry_date, "never")).toBeNull()
    })
})

describe("GET/POST /api/v1/tokens/build refuse token-authenticated requests (D2)", () => {
    it("GET refuses a token-authenticated caller", async () => {
        const response = await buildTokensGET({
            request: new Request("https://localhost/api/v1/tokens/build"),
            locals: { identity: makeAdminIdentity(), tokenAuth: true }
        } as any)
        expect(response.status).toBe(403)
    })

    it("POST refuses a token-authenticated caller", async () => {
        const response = await buildTokensPOST({
            request: new Request("https://localhost/api/v1/tokens/build", { method: "POST" }),
            locals: { identity: makeAdminIdentity(), tokenAuth: true }
        } as any)
        expect(response.status).toBe(403)
    })

    it("DELETE refuses a token-authenticated caller", async () => {
        const response = await buildTokenDELETE({
            params: { id: "1" },
            request: new Request("https://localhost/api/v1/tokens/build/1", { method: "DELETE" }),
            locals: { identity: makeAdminIdentity(), tokenAuth: true }
        } as any)
        expect(response.status).toBe(403)
    })
})

describe("POST /api/v1/tokens/build validation", () => {
    it("rejects a missing label", async () => {
        const response = await buildTokensPOST({
            request: new Request("https://localhost/api/v1/tokens/build", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify([{ expiry_days: 30 }])
            }),
            locals: { identity: makeAdminIdentity() }
        } as any)
        expect(response.status).toBe(400)
    })

    it("rejects an out-of-allowlist expiry_days", async () => {
        const response = await buildTokensPOST({
            request: new Request("https://localhost/api/v1/tokens/build", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify([{ label: "test", expiry_days: 999 }])
            }),
            locals: { identity: makeAdminIdentity() }
        } as any)
        expect(response.status).toBe(400)
    })

    it("accepts expiry_days 'never' and returns a null expires_date", async () => {
        const response = await buildTokensPOST({
            request: new Request("https://localhost/api/v1/tokens/build", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify([{ label: "indefinite", expiry_days: "never" }])
            }),
            locals: { identity: makeAdminIdentity() }
        } as any)
        expect(response.status).toBe(201)
        const issued = (await response.json()) as { payload: { expires_date: number | null } }
        expect(issued.payload.expires_date).toBeNull()
    })
})

describe("full build-token lifecycle through the endpoints", () => {
    it("issues, lists, and revokes a build token; the plaintext secret is never persisted", async () => {
        const issueResponse = await buildTokensPOST({
            request: new Request("https://localhost/api/v1/tokens/build", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify([{ label: "issued via test", expiry_days: 7 }])
            }),
            locals: { identity: makeAdminIdentity() }
        } as any)
        expect(issueResponse.status).toBe(201)
        const issued = (await issueResponse.json()) as { payload: { id: number; secret: string } }
        expect(issued.payload.secret.startsWith("skv_build_")).toBe(true)
        expect(issued.payload).not.toHaveProperty("token_hash")

        const listResponse = await buildTokensGET({
            request: new Request("https://localhost/api/v1/tokens/build"),
            locals: { identity: makeAdminIdentity() }
        } as any)
        expect(listResponse.status).toBe(200)
        const listed = await listResponse.text()
        expect(listed).not.toContain(issued.payload.secret)

        const deleteResponse = await buildTokenDELETE({
            params: { id: String(issued.payload.id) },
            request: new Request(`https://localhost/api/v1/tokens/build/${issued.payload.id}`, { method: "DELETE" }),
            locals: { identity: makeAdminIdentity() }
        } as any)
        expect(deleteResponse.status).toBe(204)
        expect(await verifyBuildToken(issued.payload.secret, Date.now())).toBe(false)

        // idempotent: revoking again still succeeds
        const deleteAgain = await buildTokenDELETE({
            params: { id: String(issued.payload.id) },
            request: new Request(`https://localhost/api/v1/tokens/build/${issued.payload.id}`, { method: "DELETE" }),
            locals: { identity: makeAdminIdentity() }
        } as any)
        expect(deleteAgain.status).toBe(204)
    })

    it("DELETE returns 404 for a nonexistent id", async () => {
        const response = await buildTokenDELETE({
            params: { id: "999999" },
            request: new Request("https://localhost/api/v1/tokens/build/999999", { method: "DELETE" }),
            locals: { identity: makeAdminIdentity() }
        } as any)
        expect(response.status).toBe(404)
    })
})

describe("GET /api/v1/{composers,works,contributors} build-token branch requires meta full:true", () => {
    it("composers: 400 without full:true", async () => {
        const response = await composersGET({
            request: new Request("https://localhost/api/v1/composers"),
            locals: { buildTokenAuth: true }
        } as any)
        expect(response.status).toBe(400)
    })

    it("works: 400 without full:true", async () => {
        const response = await worksGET({
            request: new Request("https://localhost/api/v1/works"),
            locals: { buildTokenAuth: true }
        } as any)
        expect(response.status).toBe(400)
    })

    it("contributors: 400 without full:true", async () => {
        const response = await contributorsGET({
            request: new Request("https://localhost/api/v1/contributors"),
            locals: { buildTokenAuth: true }
        } as any)
        expect(response.status).toBe(400)
    })
})
