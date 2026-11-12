/**
 * tests/removal-revokes-tokens.test.ts
 *
 * Copyright (C) 2026 Michael Wong.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/// <reference path="../src/lib/api/types.d.ts" />

import { describe, it, expect, beforeAll, vi } from "vitest"
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test"

vi.mock("../src/lib/api/access_iam_mgmt", () => ({
    add_user: vi.fn(async () => undefined),
    remove_user: vi.fn(async () => undefined),
    list_users: vi.fn(async () => [])
}))

import { exec_string, getRecord, CONTRIBUTOR } from "../src/lib/api/d1.ts"
import { addContributor } from "../src/lib/api/db_contributor.ts"
import { insertApiToken, generateApiTokenSecret, hashToken, resolveApiTokenIdentity } from "../src/lib/api/tokens.ts"
import { deactivateUser, removeUser } from "../src/lib/public/usermgmt.ts"
import { remove_user } from "../src/lib/api/access_iam_mgmt"
import { DELETE as identityDELETE } from "../src/pages/api/v1/identity.ts"

// mirrors the contributors table in d1.ts
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

async function withCtx<T>(fn: (ctx: ExecutionContext) => Promise<T>): Promise<T> {
    const ctx = createExecutionContext()
    const result = await fn(ctx)
    await waitOnExecutionContext(ctx)
    return result
}

/** Adds an active contributor with one live token; returns its id and the token secret */
async function seed(name: string, admin = false): Promise<{ id: number; secret: string }> {
    const id = await withCtx((ctx) =>
        addContributor(ctx, {
            name,
            identity_email: `${name}@example.com`,
            public_email: null,
            class_year: null,
            major: null,
            phases: null,
            bio: "",
            image: null,
            roles: [],
            tags: [],
            active: true,
            admin
        })
    )
    const { secret, prefix } = generateApiTokenSecret()
    const now = Date.now()
    await insertApiToken({
        contributor_id: id,
        label: "t",
        token_hash: await hashToken(secret),
        token_prefix: prefix,
        entry_date: now,
        expires_date: now + 86_400_000
    })
    return { id, secret }
}

async function isActive(id: number): Promise<boolean> {
    return ((await getRecord(CONTRIBUTOR, id)).results[0] as { active: number }).active === 1
}

function removalRequest(email: string, autodeactivation?: boolean) {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (autodeactivation !== undefined) {
        headers["X-MWMSC-Request-Meta"] = JSON.stringify({ autodeactivation })
    }
    return {
        request: new Request("https://localhost/api/v1/identity", {
            method: "DELETE",
            headers,
            body: JSON.stringify([email])
        }),
        locals: {
            cfContext: createExecutionContext(),
            identity: { id: -1, admin: true, active: true, permissions: {}, roles: [] }
        }
    } as any
}

beforeAll(async () => {
    await exec_string(contributors_ddl)
    await exec_string(api_tokens_ddl)
})

describe("deactivation and removal revoke API tokens", () => {
    it("deactivateUser revokes only the target's tokens", async () => {
        const target = await seed("deact-target")
        const bystander = await seed("deact-bystander")
        await withCtx((ctx) => deactivateUser(ctx, target.id))

        expect(await isActive(target.id)).toBe(false)
        expect(await resolveApiTokenIdentity(target.secret, Date.now())).toBeNull()
        expect(await resolveApiTokenIdentity(bystander.secret, Date.now())).not.toBeNull()
    })

    it("removeUser removes from Access, deactivates and revokes an admin's tokens", async () => {
        const admin = await seed("removed-admin", true)
        await withCtx((ctx) => removeUser(ctx, "removed-admin@example.com"))

        expect(remove_user).toHaveBeenCalledWith("removed-admin@example.com")
        expect(await isActive(admin.id)).toBe(false)
        expect(await resolveApiTokenIdentity(admin.secret, Date.now())).toBeNull()
    })

    it("DELETE /identity deactivates and revokes by default", async () => {
        const user = await seed("default-removal")
        const response = await identityDELETE(removalRequest("default-removal@example.com"))

        expect(response.status).toBe(200)
        expect(await isActive(user.id)).toBe(false)
        expect(await resolveApiTokenIdentity(user.secret, Date.now())).toBeNull()
    })

    it("DELETE /identity with autodeactivation=false does neither", async () => {
        const user = await seed("kept-removal")
        const response = await identityDELETE(removalRequest("kept-removal@example.com", false))

        expect(response.status).toBe(200)
        expect(remove_user).toHaveBeenCalledWith("kept-removal@example.com")
        expect(await isActive(user.id)).toBe(true)
        expect(await resolveApiTokenIdentity(user.secret, Date.now())).not.toBeNull()
    })
})
