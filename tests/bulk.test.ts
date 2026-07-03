/**
 * tests/bulk.test.ts
 *
 * Integration tests for the atomic bulk write path that backs the CSV import: the exec_stmt_batch primitive,
 * the batch add functions (addComposersBatch / addContributorsBatch / addCompositionsBatch), and the
 * (composer, name) composition uniqueness enforcement (both the app-model assertion and the composite UNIQUE
 * index). The central guarantee under test is all-or-nothing: a batch that violates a constraint mid-way
 * writes nothing.
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
 *
 * This license is also subject to additional terms as specified in the README.md.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/// <reference path="../src/lib/api/types.d.ts" />

import { describe, it, expect, beforeAll } from "vitest"
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test"

import { exec_string, exec_stmt_batch, COMPOSER } from "../src/lib/api/d1.ts"
import { SQLStatement } from "../src/lib/api/sql.ts"
import { WorkType } from "../src/lib/api/common.ts"
import {
    addComposersBatch,
    addContributorsBatch,
    addCompositionsBatch,
    addComposition,
    findCompositionDuplicates,
    listComposers,
    listCompositions,
    getComposer
} from "../src/lib/api/database.ts"

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
github_username TEXT,
github_user_id INTEGER,
entry_date TEXT NOT NULL,
change_date TEXT NOT NULL
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
entry_date TEXT NOT NULL,
change_date TEXT NOT NULL
);`

const compositions_ddl = `
CREATE TABLE IF NOT EXISTS compositions (
composition_id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
composer_id INTEGER NOT NULL,
contrib_primary_1 INTEGER NOT NULL,
contrib_primary_2 INTEGER,
contrib_addl TEXT,
author_secondary TEXT,
type TEXT NOT NULL,
part TEXT,
rating_suzuki INTEGER,
rating_nyssma INTEGER,
publish_location TEXT NOT NULL,
publish_name TEXT NOT NULL,
publish_year INTEGER NOT NULL,
uri_type TEXT NOT NULL,
uri TEXT,
key TEXT,
range TEXT,
position_highest TEXT,
notes_pedagogical TEXT,
notes_historical TEXT,
notes_other TEXT,
image TEXT,
phases TEXT NOT NULL,
tags TEXT,
entry_date TEXT NOT NULL,
change_date TEXT NOT NULL
);`

const composition_unique_index = `CREATE UNIQUE INDEX IF NOT EXISTS idx_compositions_composer_name ON compositions (composer_id, name);`

async function withCtx<T>(fn: (ctx: ExecutionContext) => Promise<T>): Promise<T> {
    const ctx = createExecutionContext()
    const result = await fn(ctx)
    await waitOnExecutionContext(ctx)
    return result
}

function makeComposer(name: string): Composer {
    return {
        name,
        role: "composer",
        birth_year: 1900,
        death_year: 1950,
        country: "United States",
        bio: "A test composer.",
        image: null,
        tags: []
    }
}

function makeContributor(name: string, identity_email: string): Contributor {
    return {
        name,
        class_year: null,
        major: null,
        phases: null,
        bio: null,
        public_email: null,
        identity_email,
        active: false,
        admin: false,
        roles: [],
        tags: [],
        image: null,
        github_username: null,
        github_user_id: null
    }
}

function makeComposition(name: string, composer_id: number, contrib_id: number): Composition {
    return {
        name,
        composer_id,
        contrib_primary_1: contrib_id,
        contrib_primary_2: null,
        contrib_addl: [],
        author_secondary: [],
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
        phases: [],
        tags: []
    }
}

beforeAll(async () => {
    await exec_string(contributors_ddl)
    await exec_string(composers_ddl)
    await exec_string(compositions_ddl)
    await exec_string(composition_unique_index)
})

describe("exec_stmt_batch", () => {
    it("throws when given no statements", async () => {
        await expect(exec_stmt_batch([])).rejects.toThrow(/No SQL statements/)
    })

    it("returns one result per statement", async () => {
        const results = await exec_stmt_batch([
            new SQLStatement(COMPOSER, "SELECT", "composers"),
            new SQLStatement(COMPOSER, "SELECT", "composers")
        ])
        expect(results).toHaveLength(2)
        expect(results.every((result) => result.success)).toBe(true)
    })
})

describe("batch add functions", () => {
    it("inserts every composer and returns one id per record", async () => {
        const before = (await withCtx((ctx) => listComposers(ctx)))?.length ?? 0
        const ids = await withCtx((ctx) =>
            addComposersBatch(ctx, [makeComposer("Batch Composer A"), makeComposer("Batch Composer B")])
        )
        expect(ids).toHaveLength(2)
        expect(ids.every((id) => id > 0)).toBe(true)
        expect(new Set(ids).size).toBe(2)
        const after = (await withCtx((ctx) => listComposers(ctx)))?.length ?? 0
        expect(after).toBe(before + 2)
        const read = await withCtx((ctx) => getComposer(ctx, "composer_id", String(ids[0])))
        expect(read!.name).toBe("Batch Composer A")
    })

    it("rolls the whole batch back when one record violates a UNIQUE constraint", async () => {
        const before = (await withCtx((ctx) => listComposers(ctx)))?.length ?? 0
        // two records share a name; the second INSERT violates composers.name UNIQUE, aborting the batch
        await expect(
            withCtx((ctx) => addComposersBatch(ctx, [makeComposer("Dup Name"), makeComposer("Dup Name")]))
        ).rejects.toThrow()
        const after = (await withCtx((ctx) => listComposers(ctx)))?.length ?? 0
        expect(after).toBe(before) // nothing was written
    })

    it("inserts placeholder contributors and compositions in a batch", async () => {
        const contribIds = await withCtx((ctx) =>
            addContributorsBatch(ctx, [
                makeContributor("Batch Contrib A", "bca@example.com"),
                makeContributor("Batch Contrib B", "bcb@example.com")
            ])
        )
        expect(contribIds).toHaveLength(2)

        const composerId = await withCtx((ctx) => addComposersBatch(ctx, [makeComposer("Works Batch Composer")]))
        const ids = await withCtx((ctx) =>
            addCompositionsBatch(ctx, [
                makeComposition("Batch Work One", composerId[0], contribIds[0]),
                makeComposition("Batch Work Two", composerId[0], contribIds[0])
            ])
        )
        expect(ids).toHaveLength(2)
        expect(new Set(ids).size).toBe(2)
    })
})

describe("composition (composer, name) uniqueness", () => {
    it("findCompositionDuplicates flags an existing collision and a within-request repeat", async () => {
        const composerId = (await withCtx((ctx) => addComposersBatch(ctx, [makeComposer("Dup Detect Composer")])))[0]
        const contribId = (
            await withCtx((ctx) => addContributorsBatch(ctx, [makeContributor("Dup Detect Contrib", "ddc@example.com")]))
        )[0]
        await withCtx((ctx) => addComposition(ctx, makeComposition("Existing Work", composerId, contribId)))

        const findings = await withCtx((ctx) =>
            findCompositionDuplicates(ctx, [
                { composer_id: composerId, name: "Existing Work" }, // collides with the row just written
                { composer_id: composerId, name: "New Work" },
                { composer_id: composerId, name: "New Work" } // repeats index 1 within the request
            ])
        )
        expect(findings.map((finding) => ({ index: finding.index, reason: finding.reason }))).toEqual([
            { index: 0, reason: "exists" },
            { index: 2, reason: "within-request" }
        ])
    })

    it("addComposition rejects a duplicate (composer, name)", async () => {
        const composerId = (await withCtx((ctx) => addComposersBatch(ctx, [makeComposer("Single Dup Composer")])))[0]
        const contribId = (
            await withCtx((ctx) => addContributorsBatch(ctx, [makeContributor("Single Dup Contrib", "sdc@example.com")]))
        )[0]
        await withCtx((ctx) => addComposition(ctx, makeComposition("Only Once", composerId, contribId)))
        await expect(
            withCtx((ctx) => addComposition(ctx, makeComposition("Only Once", composerId, contribId)))
        ).rejects.toThrow(/already exists/)
    })

    it("addCompositionsBatch rejects a batch containing an internal duplicate and writes nothing", async () => {
        const composerId = (await withCtx((ctx) => addComposersBatch(ctx, [makeComposer("Batch Dup Composer")])))[0]
        const contribId = (
            await withCtx((ctx) => addContributorsBatch(ctx, [makeContributor("Batch Dup Contrib", "bdc@example.com")]))
        )[0]
        const before = (await withCtx((ctx) => listCompositions(ctx)))?.length ?? 0
        await expect(
            withCtx((ctx) =>
                addCompositionsBatch(ctx, [
                    makeComposition("Twin", composerId, contribId),
                    makeComposition("Twin", composerId, contribId)
                ])
            )
        ).rejects.toThrow()
        const after = (await withCtx((ctx) => listCompositions(ctx)))?.length ?? 0
        expect(after).toBe(before) // nothing was written
    })
})
