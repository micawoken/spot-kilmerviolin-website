/// <reference path="../src/lib/api/types.d.ts" />

/**
 * Integration tests for the high-level database services (database.ts)
 * Exercises the full stack: SQLStatement -> caching (Cache API + KV) -> D1
 *
 * Key behavior under test: mutations must invalidate both the KV backing store
 * and the per-table Cache API entry so subsequent reads never serve stale data.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test"

import { exec_string } from "../src/lib/api/d1.ts"
import {
    addComposer, getComposer, listComposers, updateComposer, updateComposerPartial, deleteComposer,
    addContributor, getContributor, updateContributorPartial,
    purgeCacheAll
} from "../src/lib/api/database.ts"

// mirrors the table definitions in d1.ts (the init strings there are module-private)
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
entry_date TEXT NOT NULL
);`

const composers_ddl = `
CREATE TABLE IF NOT EXISTS composers (
composer_id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT UNIQUE NOT NULL,
role TEXT NOT NULL,
birth_year INTEGER NOT NULL,
death_year INTEGER NOT NULL,
country TEXT NOT NULL,
bio TEXT,
image TEXT,
tags TEXT,
entry_date TEXT NOT NULL
);`

// runs a database.ts call with a fresh ExecutionContext and flushes its waitUntil work,
// so cache invalidation scheduled by the call is complete before the next assertion
async function withCtx<T>(fn: (ctx: ExecutionContext) => Promise<T>): Promise<T> {
    const ctx = createExecutionContext()
    const result = await fn(ctx)
    await waitOnExecutionContext(ctx)
    return result
}

function makeComposer(name: string): Composer {
    return {
        name: name,
        role: "composer",
        birth_year: 1900,
        death_year: 1950,
        country: "United States",
        bio: "A test composer.",
        image: null,
        tags: ["test", "baroque"]
    }
}

function makeContributor(name: string, identity_email: string): Contributor {
    return {
        name: name,
        class_year: 2026,
        major: "Music",
        phases: [1, 2],
        bio: "A test contributor.",
        public_email: "pub@example.com",
        identity_email: identity_email,
        active: false,
        admin: false,
        roles: [],
        tags: [],
        image: null
    }
}

beforeAll(async () => {
    await exec_string(contributors_ddl)
    await exec_string(composers_ddl)
})

describe("composer CRUD with cache invalidation", () => {
    it("adds a composer and reads it back through the cached path", async () => {
        const id = await withCtx(ctx => addComposer(ctx, makeComposer("Cache Test Composer")))
        expect(id).toBeGreaterThan(0)

        const record = await withCtx(ctx => getComposer(ctx, "composer_id", String(id)))
        expect(record).not.toBeNull()
        expect(record!.name).toBe("Cache Test Composer")
        expect(record!.birth_year).toBe(1900)
        expect(record!.tags).toEqual(["test", "baroque"])
        expect(record!.image).toBeNull()
    })

    it("list reflects inserts made after the table was cached (Cache API + KV invalidation)", async () => {
        // populate Cache API and KV with the current table contents
        const before = await withCtx(ctx => listComposers(ctx))
        const count_before = before ? before.length : 0

        // mutate; this must evict both caching layers
        await withCtx(ctx => addComposer(ctx, makeComposer("Post-Cache Composer")))

        const after = await withCtx(ctx => listComposers(ctx))
        expect(after).not.toBeNull()
        expect(after!.length).toBe(count_before + 1)
        expect(after!.map(r => r.name)).toContain("Post-Cache Composer")
    })

    it("full update is visible through the cached read path", async () => {
        const id = await withCtx(ctx => addComposer(ctx, makeComposer("Updatable Composer")))
        // prime the cache
        await withCtx(ctx => getComposer(ctx, "composer_id", String(id)))

        const updated = { ...makeComposer("Updatable Composer"), bio: "Updated bio.", death_year: -1 }
        await withCtx(ctx => updateComposer(ctx, id, updated))

        const record = await withCtx(ctx => getComposer(ctx, "composer_id", String(id)))
        expect(record!.bio).toBe("Updated bio.")
        expect(record!.death_year).toBe(-1)
    })

    it("partial update only changes the provided fields", async () => {
        const id = await withCtx(ctx => addComposer(ctx, makeComposer("Partially Updated Composer")))
        await withCtx(ctx => updateComposerPartial(ctx, id, { bio: "Partial bio." }))

        const record = await withCtx(ctx => getComposer(ctx, "composer_id", String(id)))
        expect(record!.bio).toBe("Partial bio.")
        expect(record!.name).toBe("Partially Updated Composer") // untouched
        expect(record!.birth_year).toBe(1900) // untouched
    })

    it("empty partial update is a no-op instead of generating invalid SQL", async () => {
        const id = await withCtx(ctx => addComposer(ctx, makeComposer("No-Op Composer")))
        await expect(withCtx(ctx => updateComposerPartial(ctx, id, {}))).resolves.toBeNull()

        const record = await withCtx(ctx => getComposer(ctx, "composer_id", String(id)))
        expect(record!.name).toBe("No-Op Composer")
    })

    it("delete removes the record from cached reads and lists", async () => {
        const id = await withCtx(ctx => addComposer(ctx, makeComposer("Doomed Composer")))
        // prime the caches
        await withCtx(ctx => listComposers(ctx))

        await withCtx(ctx => deleteComposer(ctx, id))

        const record = await withCtx(ctx => getComposer(ctx, "composer_id", String(id)))
        expect(record).toBeNull()
        const list = await withCtx(ctx => listComposers(ctx))
        expect((list ?? []).map(r => r.id)).not.toContain(id)
    })

    it("getComposer supports lookup by unique name and rejects non-indexed params", async () => {
        await withCtx(ctx => addComposer(ctx, makeComposer("Lookup By Name")))
        const record = await withCtx(ctx => getComposer(ctx, "name", "Lookup By Name"))
        expect(record).not.toBeNull()

        await expect(withCtx(ctx => getComposer(ctx, "bio", "whatever"))).rejects.toThrow(/not a unique column/)
    })
})

describe("contributor boolean and array round-tripping", () => {
    it("converts booleans and arrays to D1 form and back", async () => {
        const id = await withCtx(ctx => addContributor(ctx, makeContributor("Roundtrip Contributor", "rt@example.com")))
        const record = await withCtx(ctx => getContributor(ctx, "contributor_id", String(id)))
        expect(record).not.toBeNull()
        expect(record!.active).toBe(false)
        expect(record!.admin).toBe(false)
        expect(record!.phases).toEqual([1, 2])
        expect(record!.roles).toEqual([])
        expect(record!.tags).toEqual([])
    })

    it("partial updates flip booleans and persist roles (the usermgmt.ts path)", async () => {
        const id = await withCtx(ctx => addContributor(ctx, makeContributor("Activated Contributor", "act@example.com")))

        await withCtx(ctx => updateContributorPartial(ctx, id, { active: true }))
        await withCtx(ctx => updateContributorPartial(ctx, id, { roles: ["reviewer"] }))

        const record = await withCtx(ctx => getContributor(ctx, "contributor_id", String(id)))
        expect(record!.active).toBe(true)
        expect(record!.roles).toEqual(["reviewer"])
        expect(record!.admin).toBe(false) // untouched
    })
})

describe("purgeCacheAll", () => {
    it("purges without error and reads remain correct afterwards", async () => {
        await withCtx(ctx => addComposer(ctx, makeComposer("Purge Survivor")))
        // prime the caches
        await withCtx(ctx => listComposers(ctx))

        const outcome = await purgeCacheAll()
        expect(outcome).toBe(true)

        const list = await withCtx(ctx => listComposers(ctx))
        expect((list ?? []).map(r => r.name)).toContain("Purge Survivor")
    })
})
