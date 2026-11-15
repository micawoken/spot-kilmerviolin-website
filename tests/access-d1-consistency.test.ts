/**
 * tests/access-d1-consistency.test.ts
 *
 * Copyright (C) 2026 Michael Wong.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/// <reference path="../src/lib/api/types.d.ts" />

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest"
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test"

const access = vi.hoisted(() => {
    const users = new Set<string>()
    return {
        users,
        add_user: vi.fn(async (email: string) => {
            users.add(email.trim().toLowerCase())
        }),
        remove_user: vi.fn(async (email: string) => {
            users.delete(email.trim().toLowerCase())
        }),
        list_users: vi.fn(async () => [...users])
    }
})

vi.mock("../src/lib/api/access_iam_mgmt", () => ({
    add_user: access.add_user,
    remove_user: access.remove_user,
    list_users: access.list_users
}))

import { exec_string, getRecord, CONTRIBUTOR } from "../src/lib/api/d1.ts"
import { addContributor } from "../src/lib/api/db_contributor.ts"
import { _changeLoginEmail, createUser } from "../src/lib/public/usermgmt.ts"
import { PATCH as contributorPATCH, PUT as contributorPUT } from "../src/pages/api/v1/contributors/[id].ts"

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

const admin_identity = { id: -1, admin: true, active: true, permissions: {}, roles: [] } as unknown as Identity

async function withCtx<T>(fn: (ctx: ExecutionContext) => Promise<T>): Promise<T> {
    const ctx = createExecutionContext()
    const result = await fn(ctx)
    await waitOnExecutionContext(ctx)
    return result
}

/** Adds a contributor, enrolling it in Access unless told otherwise; returns its id */
async function seed(name: string, in_access = true): Promise<number> {
    const email = `${name}@example.com`
    if (in_access) access.users.add(email)
    return withCtx((ctx) =>
        addContributor(ctx, {
            name,
            identity_email: email,
            public_email: null,
            class_year: null,
            major: null,
            phases: null,
            bio: "",
            image: null,
            roles: [],
            tags: [],
            active: true,
            admin: false
        })
    )
}

function contributorRequest(method: "PUT" | "PATCH", id: number, body: object, flags: Record<string, boolean>) {
    const url = new URL(`https://localhost/api/v1/contributors/${id}`)
    for (const [key, value] of Object.entries(flags)) url.searchParams.set(key, String(value))
    return {
        params: { id: String(id) },
        request: new Request(url, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([body])
        }),
        locals: { cfContext: createExecutionContext(), identity: admin_identity }
    } as any
}

function patchEmail(id: number, identity_email: string | null, flags: Record<string, boolean> = {}) {
    return contributorPATCH(contributorRequest("PATCH", id, { identity_email }, { elevate: true, ...flags }))
}

async function identityEmail(id: number): Promise<string> {
    return ((await getRecord(CONTRIBUTOR, id)).results[0] as { identity_email: string }).identity_email
}

beforeAll(async () => {
    await exec_string(contributors_ddl)
})

beforeEach(() => {
    vi.clearAllMocks()
})

describe("_changeLoginEmail keeps Access and D1 consistent", () => {
    it("moves the Access entry and the record to the new email", async () => {
        const id = await seed("mover")
        await withCtx((ctx) => _changeLoginEmail(ctx, id, "mover@example.com", "Moved@Example.com"))

        expect(await identityEmail(id)).toBe("moved@example.com")
        expect(access.users.has("moved@example.com")).toBe(true)
        expect(access.users.has("mover@example.com")).toBe(false)
    })

    it("undoes its Access addition when the record update fails", async () => {
        const id = await seed("collider")
        await seed("unlinked-holder", false)

        await expect(
            withCtx((ctx) => _changeLoginEmail(ctx, id, "collider@example.com", "unlinked-holder@example.com"))
        ).rejects.toThrow()
        expect(await identityEmail(id)).toBe("collider@example.com")
        expect(access.users.has("collider@example.com")).toBe(true)
        expect(access.users.has("unlinked-holder@example.com")).toBe(false)
    })

    it("never removes an Access entry it did not add", async () => {
        const id = await seed("collider-2")
        await seed("linked-holder")

        await expect(
            withCtx((ctx) => _changeLoginEmail(ctx, id, "collider-2@example.com", "linked-holder@example.com"))
        ).rejects.toThrow()
        expect(access.users.has("linked-holder@example.com")).toBe(true)
        expect(access.users.has("collider-2@example.com")).toBe(true)
        expect(access.remove_user).not.toHaveBeenCalled()
    })

    it("keeps the Access entry on a case-only change", async () => {
        const id = await seed("casey")
        await withCtx((ctx) => _changeLoginEmail(ctx, id, "casey@example.com", "CASEY@example.com"))

        expect(await identityEmail(id)).toBe("casey@example.com")
        expect(access.users.has("casey@example.com")).toBe(true)
        expect(access.remove_user).not.toHaveBeenCalled()
    })

    it("reports a failed removal of the old email after the change is applied", async () => {
        const id = await seed("stuck")
        access.remove_user.mockRejectedValueOnce(new Error("Access down"))

        await expect(
            withCtx((ctx) => _changeLoginEmail(ctx, id, "stuck@example.com", "unstuck@example.com"))
        ).rejects.toThrow(/removing stuck@example\.com from Access failed: Access down/)
        expect(await identityEmail(id)).toBe("unstuck@example.com")
        expect(access.users.has("unstuck@example.com")).toBe(true)
    })
})

describe("contributor PUT/PATCH move the Access entry with identity_email", () => {
    it("PATCH moves a linked contributor's Access entry", async () => {
        const id = await seed("patch-linked")
        const response = await patchEmail(id, "patch-linked-new@example.com")

        expect(response.status).toBe(204)
        expect(await identityEmail(id)).toBe("patch-linked-new@example.com")
        expect(access.users.has("patch-linked-new@example.com")).toBe(true)
        expect(access.users.has("patch-linked@example.com")).toBe(false)
    })

    it("PATCH blanking the email removes the Access entry and enrolls nothing", async () => {
        const id = await seed("patch-blanked")
        const response = await patchEmail(id, "")

        expect(response.status).toBe(204)
        expect(await identityEmail(id)).not.toBe("patch-blanked@example.com")
        expect(access.users.has("patch-blanked@example.com")).toBe(false)
        expect(access.add_user).not.toHaveBeenCalled()
    })

    it("PATCH leaves an unlinked contributor out of Access", async () => {
        const id = await seed("patch-unlinked", false)
        const response = await patchEmail(id, "patch-unlinked-new@example.com")

        expect(response.status).toBe(204)
        expect(access.add_user).not.toHaveBeenCalled()
        expect(access.users.has("patch-unlinked-new@example.com")).toBe(false)
    })

    it("PATCH with accesssync=false changes only the record", async () => {
        const id = await seed("patch-drift")
        const response = await patchEmail(id, "patch-drift-new@example.com", { accesssync: false })

        expect(response.status).toBe(204)
        expect(await identityEmail(id)).toBe("patch-drift-new@example.com")
        expect(access.users.has("patch-drift@example.com")).toBe(true)
        expect(access.list_users).not.toHaveBeenCalled()
    })

    it("PATCH without an email change does not call Access", async () => {
        const id = await seed("patch-bio")
        const response = await contributorPATCH(contributorRequest("PATCH", id, { bio: "hello" }, { elevate: true }))

        expect(response.status).toBe(204)
        expect(access.list_users).not.toHaveBeenCalled()
    })

    it("PUT moves a linked contributor's Access entry", async () => {
        const id = await seed("put-linked")
        const response = await contributorPUT(
            contributorRequest(
                "PUT",
                id,
                {
                    name: "put-linked",
                    identity_email: "put-linked-new@example.com",
                    public_email: null,
                    class_year: null,
                    major: null,
                    phases: null,
                    bio: "",
                    image: null,
                    roles: [],
                    tags: [],
                    active: true,
                    admin: false
                },
                {}
            )
        )

        expect(response.status).toBe(204)
        expect(await identityEmail(id)).toBe("put-linked-new@example.com")
        expect(access.users.has("put-linked-new@example.com")).toBe(true)
        expect(access.users.has("put-linked@example.com")).toBe(false)
    })
})

describe("createUser undoes its Access addition when the record insert fails", () => {
    it("removes the new Access entry on a name collision", async () => {
        await seed("taken-name")

        await expect(
            withCtx((ctx) => createUser(ctx, admin_identity, false, "fresh@example.com", "taken-name", null, null))
        ).rejects.toThrow()
        expect(access.users.has("fresh@example.com")).toBe(false)
    })

    it("reports both errors when the undo also fails", async () => {
        await seed("taken-name-2")
        access.remove_user.mockRejectedValueOnce(new Error("Access down"))

        await expect(
            withCtx((ctx) => createUser(ctx, admin_identity, false, "fresh-2@example.com", "taken-name-2", null, null))
        ).rejects.toThrow(/removing fresh-2@example\.com from Access to undo the change also failed: Access down/)
    })

    it("creates the record and the Access entry on success", async () => {
        await withCtx((ctx) => createUser(ctx, admin_identity, false, "newbie@example.com", "newbie", null, null))

        expect(access.users.has("newbie@example.com")).toBe(true)
    })
})
