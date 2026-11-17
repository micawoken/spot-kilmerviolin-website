/**
 * tests/last-admin-guard.test.ts
 *
 * Copyright (C) 2026 Michael Wong.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/// <reference path="../src/lib/api/types.d.ts" />

import { describe, it, expect, beforeAll } from "vitest"
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test"

import { exec_string, getRecord, CONTRIBUTOR } from "../src/lib/api/d1.ts"
import {
    addContributor,
    deleteContributor,
    updateContributor,
    updateContributorPartial,
    LastAdminError
} from "../src/lib/api/db_contributor.ts"

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

async function withCtx<T>(fn: (ctx: ExecutionContext) => Promise<T>): Promise<T> {
    const ctx = createExecutionContext()
    const result = await fn(ctx)
    await waitOnExecutionContext(ctx)
    return result
}

function makeContributor(name: string, admin: boolean): Contributor {
    return {
        name: name,
        class_year: null,
        major: null,
        phases: null,
        bio: "",
        public_email: `${name}@example.com`,
        identity_email: `${name}@example.com`,
        active: true,
        admin: admin,
        roles: [],
        tags: [],
        image: null
    }
}

async function isAdmin(id: number): Promise<boolean> {
    const row = (await getRecord(CONTRIBUTOR, id)).results[0] as { admin: number }
    return row.admin === 1
}

beforeAll(async () => {
    await exec_string(contributors_ddl)
})

describe("last-admin guard", () => {
    it("refuses to demote, overwrite or delete the only admin, and leaves the row unchanged", async () => {
        const only = await withCtx((ctx) => addContributor(ctx, makeContributor("solo-admin", true)))

        await expect(withCtx((ctx) => updateContributorPartial(ctx, only, { admin: false }, true))).rejects.toThrow(
            LastAdminError
        )
        await expect(
            withCtx((ctx) => updateContributor(ctx, only, makeContributor("solo-admin", false)))
        ).rejects.toThrow(LastAdminError)
        await expect(withCtx((ctx) => deleteContributor(ctx, only))).rejects.toThrow(LastAdminError)
        expect(await isAdmin(only)).toBe(true)
    })

    it("allows demoting an admin while another admin remains, then guards the survivor", async () => {
        const a = await withCtx((ctx) => addContributor(ctx, makeContributor("admin-a", true)))
        const b = await withCtx((ctx) => addContributor(ctx, makeContributor("admin-b", true)))
        const solo = (await exec_string("SELECT contributor_id FROM contributors WHERE name = 'solo-admin'"))
            .results[0] as { contributor_id: number }
        await withCtx((ctx) => updateContributorPartial(ctx, solo.contributor_id, { admin: false }, true))

        await withCtx((ctx) => updateContributorPartial(ctx, a, { admin: false }, true))
        expect(await isAdmin(a)).toBe(false)
        await expect(withCtx((ctx) => updateContributorPartial(ctx, b, { admin: false }, true))).rejects.toThrow(
            LastAdminError
        )
        expect(await isAdmin(b)).toBe(true)
    })

    it("does not block writes that leave admin untouched or target a non-admin", async () => {
        const user = await withCtx((ctx) => addContributor(ctx, makeContributor("plain-user", false)))
        await withCtx((ctx) => updateContributorPartial(ctx, user, { bio: "hi" }))
        await withCtx((ctx) => updateContributorPartial(ctx, user, { admin: false }, true))
        await withCtx((ctx) => deleteContributor(ctx, user))
        expect((await getRecord(CONTRIBUTOR, user)).results.length).toBe(0)
    })
})
