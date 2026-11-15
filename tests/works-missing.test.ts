/**
 * tests/works-missing.test.ts
 *
 * Copyright (C) 2026 Michael Wong.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/// <reference path="../src/lib/api/types.d.ts" />

import { describe, it, expect, beforeAll } from "vitest"
import { createExecutionContext } from "cloudflare:test"
import { exec_string } from "../src/lib/api/d1.ts"
import { getComposition, getCompositionCacheless } from "../src/lib/api/db_composition.ts"
import { DELETE as worksDELETE, PATCH as worksPATCH } from "../src/pages/api/v1/works/[id].ts"

// mirrors the compositions table in d1.ts
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
citations TEXT,
entry_date INTEGER NOT NULL,
change_date INTEGER NOT NULL
);`

function workRequest(method: string, body?: unknown) {
    return {
        params: { id: "987654" },
        request: new Request("https://localhost/api/v1/works/987654", {
            method,
            headers: { "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body)
        }),
        locals: {
            cfContext: createExecutionContext(),
            identity: { id: -1, admin: true, active: true, permissions: {}, roles: [] }
        }
    } as any
}

beforeAll(async () => {
    await exec_string(compositions_ddl)
})

describe("works/[id] on a missing composition", () => {
    it("DELETE returns 404", async () => {
        expect((await worksDELETE(workRequest("DELETE"))).status).toBe(404)
    })

    it("PATCH returns 404", async () => {
        expect((await worksPATCH(workRequest("PATCH", [{ name: "renamed" }]))).status).toBe(404)
    })
})

describe("getCompositionCacheless", () => {
    it("sees a primary-contributor change that the cached read has not", async () => {
        await exec_string(
            `INSERT INTO compositions (composition_id, name, composer_id, contrib_primary_1, type, publish_location, publish_name, publish_year, uri_type, phases, entry_date, change_date) VALUES (4242, 'Cached work', 1, 11, 'piece', 'x', 'x', 2000, 'none', '[]', 0, 0)`
        )
        const ctx = createExecutionContext()
        expect((await getComposition(ctx, "composition_id", "4242"))?.contrib_primary_1).toBe(11)

        await exec_string(`UPDATE compositions SET contrib_primary_1 = 12 WHERE composition_id = 4242`)

        expect((await getComposition(ctx, "composition_id", "4242"))?.contrib_primary_1).toBe(11)
        expect((await getCompositionCacheless("composition_id", "4242"))?.contrib_primary_1).toBe(12)
    })
})
