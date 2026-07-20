/**
 * tests/database.test.ts
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
 * Integration tests for the high-level database services (database.ts)
 * Exercises the full stack: SQLStatement -> caching (Cache API + KV) -> D1
 *
 * Key behavior under test: mutations must invalidate both the KV backing store
 * and the per-table Cache API entry so subsequent reads never serve stale data.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test"

import { exec_string } from "../src/lib/api/d1.ts"
import { WorkType } from "../src/lib/api/common.ts"
import {
    addComposer, getComposer, listComposers, updateComposer, updateComposerPartial, deleteComposer,
    addContributor, getContributor, updateContributorPartial,
    attachCompositionNames, purgeCacheAll
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
entry_date INTEGER NOT NULL,
change_date INTEGER NOT NULL
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
citations TEXT,
entry_date INTEGER NOT NULL,
change_date INTEGER NOT NULL
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

// builds a minimal valid CompositionRecord; attachCompositionNames only reads the reference fields
// (composer_id and author_secondary for composers; contrib_primary_1, contrib_primary_2, and contrib_addl
// for contributors), so the remaining fields are filler and the compositions table is not needed
function makeCompositionRecord(overrides: Partial<CompositionRecord>): CompositionRecord {
    return {
        id: 1,
        entry_date: Date.now(),
        change_date: Date.now(),
        name: "Test Work",
        composer_id: 0,
        contrib_primary_1: 1,
        contrib_primary_2: null,
        type: "solo" as WorkType,
        part: null,
        key: null,
        range: null,
        position_highest: null,
        notes_pedagogical: null,
        notes_historical: null,
        notes_other: null,
        image: null,
        rating: { suzuki: null, nyssma: null },
        publication_info: { name: "", location: "", year: 2000, uri_type: "https", uri: "" },
        contrib_addl: [],
        author_secondary: [],
        phases: [],
        tags: [],
        ...overrides
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

    it("citations is optional: a composer created without it defaults to an empty object", async () => {
        const id = await withCtx(ctx => addComposer(ctx, makeComposer("No-Citations Composer")))
        const record = await withCtx(ctx => getComposer(ctx, "composer_id", String(id)))
        expect(record!.citations).toEqual({})
    })

    it("a well-formed citations map round-trips through the D1 write/read path", async () => {
        const composer = { ...makeComposer("Cited Composer"), citations: { IMSLP: "https://imslp.org/wiki/Cited" } }
        const id = await withCtx(ctx => addComposer(ctx, composer))
        const record = await withCtx(ctx => getComposer(ctx, "composer_id", String(id)))
        expect(record!.citations).toEqual({ IMSLP: "https://imslp.org/wiki/Cited" })
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
        // roles is a protected column: the data layer refuses to write it unless the caller authorizes it
        // (the usermgmt role/admin functions pass allowProtected after their own admin check)
        await expect(withCtx(ctx => updateContributorPartial(ctx, id, { roles: ["reviewer"] })))
            .rejects.toThrow(/protected column/)
        await withCtx(ctx => updateContributorPartial(ctx, id, { roles: ["reviewer"] }, true))

        const record = await withCtx(ctx => getContributor(ctx, "contributor_id", String(id)))
        expect(record!.active).toBe(true)
        expect(record!.roles).toEqual(["reviewer"])
        expect(record!.admin).toBe(false) // untouched
    })
})

describe("attachCompositionNames", () => {
    it("resolves composer_name and author_secondary_names from the composer table", async () => {
        const main = await withCtx(ctx => addComposer(ctx, makeComposer("Names Main Composer")))
        const sec1 = await withCtx(ctx => addComposer(ctx, makeComposer("Names Secondary One")))
        const sec2 = await withCtx(ctx => addComposer(ctx, makeComposer("Names Secondary Two")))

        const composition = makeCompositionRecord({ composer_id: main, author_secondary: [sec1, sec2] })
        const [enhanced] = await withCtx(ctx => attachCompositionNames(ctx, [composition]))

        // the original record is preserved whole under "object"
        expect(enhanced.object).toBe(composition)
        expect(enhanced.names.composer_name).toBe("Names Main Composer")
        expect(enhanced.names.author_secondary_names).toEqual(["Names Secondary One", "Names Secondary Two"])
    })

    it("yields an empty string for unresolvable references and preserves array alignment", async () => {
        const main = await withCtx(ctx => addComposer(ctx, makeComposer("Names Solo Composer")))
        // 999999 does not exist; its slot must remain so names stay positionally aligned with author_secondary
        const composition = makeCompositionRecord({ composer_id: main, author_secondary: [999999] })
        const [enhanced] = await withCtx(ctx => attachCompositionNames(ctx, [composition]))

        expect(enhanced.names.composer_name).toBe("Names Solo Composer")
        expect(enhanced.names.author_secondary_names).toEqual([""])
    })

    it("resolves names across multiple compositions with a single composer read", async () => {
        const a = await withCtx(ctx => addComposer(ctx, makeComposer("Names Composer A")))
        const b = await withCtx(ctx => addComposer(ctx, makeComposer("Names Composer B")))

        const comps = [
            makeCompositionRecord({ composer_id: a, author_secondary: [] }),
            makeCompositionRecord({ composer_id: b, author_secondary: [a] }),
        ]
        const enhanced = await withCtx(ctx => attachCompositionNames(ctx, comps))

        expect(enhanced.map(e => e.names.composer_name)).toEqual(["Names Composer A", "Names Composer B"])
        expect(enhanced[1].names.author_secondary_names).toEqual(["Names Composer A"])
    })

    it("resolves contributor names for the primary and additional contributor references", async () => {
        const composer = await withCtx(ctx => addComposer(ctx, makeComposer("Names Contrib Composer")))
        const p1 = await withCtx(ctx => addContributor(ctx, makeContributor("Names Contrib Primary One", "names-c1@example.com")))
        const p2 = await withCtx(ctx => addContributor(ctx, makeContributor("Names Contrib Primary Two", "names-c2@example.com")))
        const a1 = await withCtx(ctx => addContributor(ctx, makeContributor("Names Contrib Addl One", "names-c3@example.com")))
        const a2 = await withCtx(ctx => addContributor(ctx, makeContributor("Names Contrib Addl Two", "names-c4@example.com")))

        const composition = makeCompositionRecord({
            composer_id: composer,
            contrib_primary_1: p1,
            contrib_primary_2: p2,
            contrib_addl: [a1, a2],
        })
        const [enhanced] = await withCtx(ctx => attachCompositionNames(ctx, [composition]))

        expect(enhanced.names.contrib_primary_1_name).toBe("Names Contrib Primary One")
        expect(enhanced.names.contrib_primary_2_name).toBe("Names Contrib Primary Two")
        expect(enhanced.names.contrib_addl_names).toEqual(["Names Contrib Addl One", "Names Contrib Addl Two"])
    })

    it("yields an empty string for a null contrib_primary_2 and for unresolvable contributor ids", async () => {
        const composer = await withCtx(ctx => addComposer(ctx, makeComposer("Names Contrib Edge Composer")))
        const p1 = await withCtx(ctx => addContributor(ctx, makeContributor("Names Contrib Resolvable", "names-c5@example.com")))

        // contrib_primary_2 is null (omitted) and one contrib_addl id (999999) does not exist; the latter's
        // slot must remain so contrib_addl_names stays positionally aligned with contrib_addl
        const composition = makeCompositionRecord({
            composer_id: composer,
            contrib_primary_1: p1,
            contrib_primary_2: null,
            contrib_addl: [p1, 999999],
        })
        const [enhanced] = await withCtx(ctx => attachCompositionNames(ctx, [composition]))

        expect(enhanced.names.contrib_primary_1_name).toBe("Names Contrib Resolvable")
        expect(enhanced.names.contrib_primary_2_name).toBe("")
        expect(enhanced.names.contrib_addl_names).toEqual(["Names Contrib Resolvable", ""])
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
