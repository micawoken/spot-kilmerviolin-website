/**
 * tests/db_contact.test.ts
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

import { describe, it, expect, beforeAll, beforeEach } from "vitest"

import { exec_string } from "../src/lib/api/d1.ts"
import {
    addContactResponse,
    getContactResponse,
    listContactResponses,
    deleteContactResponse,
    deleteContactResponses,
    setContactResponseRead,
    setContactResponsesRead,
    countUnreadContactResponses,
    ContactQueueFullError,
    type NewContactResponse
} from "../src/lib/api/db_contact.ts"

// mirrors db_init.sql's contact_responses table (the init string there is not exported)
const contact_responses_ddl = `
CREATE TABLE IF NOT EXISTS contact_responses (
response_id INTEGER PRIMARY KEY AUTOINCREMENT,
subject TEXT,
name TEXT NOT NULL,
email TEXT,
phone TEXT,
body TEXT NOT NULL,
source_path TEXT,
spam_score INTEGER NOT NULL,
spam_flags TEXT,
read_at INTEGER,
entry_date INTEGER NOT NULL,
change_date INTEGER NOT NULL
);`

const queue_trigger_ddl = `
CREATE TRIGGER trg_contact_responses_queue_limit
BEFORE INSERT ON contact_responses
WHEN (SELECT COUNT(*) FROM contact_responses) >= 3
BEGIN
    DELETE FROM contact_responses
    WHERE response_id = (
        SELECT response_id FROM contact_responses
        WHERE read_at IS NOT NULL
        ORDER BY entry_date ASC, response_id ASC
        LIMIT 1
    );
    SELECT CASE
        WHEN (SELECT COUNT(*) FROM contact_responses) >= 3
        THEN RAISE(ABORT, 'contact_response_queue_full')
    END;
END;`

function makeResponse(overrides: Partial<NewContactResponse> = {}): NewContactResponse {
    return {
        subject: "Hello",
        name: "Ada Lovelace",
        email: "ada@example.test",
        phone: null,
        body: "A test message.",
        source_path: "/entity/composer/ada",
        spam_score: 0,
        spam_flags: [],
        ...overrides
    }
}

beforeAll(async () => {
    await exec_string("DROP TABLE IF EXISTS contact_responses;")
    await exec_string(contact_responses_ddl)
    await exec_string(queue_trigger_ddl)
})

// Queue tests require exact row counts, so every test starts with an empty table.
beforeEach(async () => {
    await exec_string("DELETE FROM contact_responses;")
})

describe("addContactResponse / getContactResponse", () => {
    it("round-trips every field, including JSON-encoded spam flags and a null read state", async () => {
        const id = await addContactResponse(
            makeResponse({ spam_score: 42, spam_flags: ["has-link", "all-caps"], phone: "+1 555-0100" })
        )
        const record = await getContactResponse(id)
        expect(record).not.toBeNull()
        expect(record).toMatchObject({
            id,
            subject: "Hello",
            name: "Ada Lovelace",
            email: "ada@example.test",
            phone: "+1 555-0100",
            body: "A test message.",
            source_path: "/entity/composer/ada",
            spam_score: 42,
            spam_flags: ["has-link", "all-caps"],
            read: false
        })
        expect(record!.entry_date).toEqual(record!.change_date)
    })

    it("stores a null subject/email/phone/source_path as null, and empty spam_flags as []", async () => {
        const id = await addContactResponse(
            makeResponse({ subject: null, email: null, phone: "555-0100 5550100", source_path: null, spam_flags: [] })
        )
        const record = await getContactResponse(id)
        expect(record!.subject).toBeNull()
        expect(record!.email).toBeNull()
        expect(record!.source_path).toBeNull()
        expect(record!.spam_flags).toEqual([])
    })

    it("returns null for an id that does not exist", async () => {
        expect(await getContactResponse(999999)).toBeNull()
    })
})

describe("listContactResponses", () => {
    it("lists newest first", async () => {
        const firstId = await addContactResponse(makeResponse({ name: "First" }))
        // entry_date is epoch milliseconds; force a distinct, later timestamp on the second insert
        await new Promise((resolve) => setTimeout(resolve, 5))
        const secondId = await addContactResponse(makeResponse({ name: "Second" }))
        const list = await listContactResponses()
        expect(list.map((record) => record.id)).toEqual([secondId, firstId])
    })

    it("returns an empty array when the table is empty", async () => {
        expect(await listContactResponses()).toEqual([])
    })
})

describe("setContactResponseRead / countUnreadContactResponses", () => {
    it("marks a response read, then unread again, updating change_date each time", async () => {
        const id = await addContactResponse(makeResponse())
        const original = await getContactResponse(id)

        await setContactResponseRead(id, true)
        const read = await getContactResponse(id)
        expect(read!.read).toBe(true)
        expect(read!.change_date).toBeGreaterThanOrEqual(original!.change_date)

        await setContactResponseRead(id, false)
        const unread = await getContactResponse(id)
        expect(unread!.read).toBe(false)
    })

    it("counts only unread responses", async () => {
        const a = await addContactResponse(makeResponse({ name: "A" }))
        await addContactResponse(makeResponse({ name: "B" }))
        expect(await countUnreadContactResponses()).toBe(2)
        await setContactResponseRead(a, true)
        expect(await countUnreadContactResponses()).toBe(1)
    })

    it("updates multiple responses in one operation", async () => {
        const first = await addContactResponse(makeResponse({ name: "First" }))
        const second = await addContactResponse(makeResponse({ name: "Second" }))
        await setContactResponsesRead([first, second], true)
        expect((await listContactResponses()).every((record) => record.read)).toBe(true)
    })
})

describe("deleteContactResponse", () => {
    it("removes the row", async () => {
        const id = await addContactResponse(makeResponse())
        expect(await deleteContactResponse(id)).toBe(true)
        expect(await getContactResponse(id)).toBeNull()
    })

    it("still reports success when the id does not exist (idempotent)", async () => {
        expect(await deleteContactResponse(999999)).toBe(true)
    })

    it("deletes multiple responses in one operation", async () => {
        const first = await addContactResponse(makeResponse({ name: "First" }))
        const second = await addContactResponse(makeResponse({ name: "Second" }))
        await deleteContactResponses([first, second])
        expect(await listContactResponses()).toEqual([])
    })
})

describe("atomic queue trigger", () => {
    it("does nothing while under the limit", async () => {
        await addContactResponse(makeResponse())
        await addContactResponse(makeResponse())
        expect(await listContactResponses()).toHaveLength(2)
    })

    it("evicts the oldest READ row once at the limit, preserving unread and newer read rows", async () => {
        const oldestRead = await addContactResponse(makeResponse({ name: "Oldest read" }))
        await new Promise((resolve) => setTimeout(resolve, 5))
        const newerRead = await addContactResponse(makeResponse({ name: "Newer read" }))
        await new Promise((resolve) => setTimeout(resolve, 5))
        const unread = await addContactResponse(makeResponse({ name: "Unread" }))
        await setContactResponseRead(oldestRead, true)
        await setContactResponseRead(newerRead, true)

        const inserted = await addContactResponse(makeResponse({ name: "Inserted" }))

        const remaining = (await listContactResponses()).map((record) => record.id)
        expect(remaining).not.toContain(oldestRead)
        expect(remaining).toContain(newerRead)
        expect(remaining).toContain(unread)
        expect(remaining).toContain(inserted)
        expect(remaining).toHaveLength(3)
    })

    it("throws ContactQueueFullError, evicting nothing, when every row at the limit is unread", async () => {
        const first = await addContactResponse(makeResponse({ name: "First" }))
        const second = await addContactResponse(makeResponse({ name: "Second" }))
        const third = await addContactResponse(makeResponse({ name: "Third" }))

        await expect(addContactResponse(makeResponse({ name: "Rejected" }))).rejects.toThrow(ContactQueueFullError)

        const remaining = (await listContactResponses()).map((record) => record.id)
        expect(remaining).toEqual(expect.arrayContaining([first, second, third]))
        expect(remaining).toHaveLength(3)
    })

    it("holds the cap under concurrent inserts", async () => {
        const results = await Promise.allSettled(
            ["One", "Two", "Three", "Four"].map((name) => addContactResponse(makeResponse({ name })))
        )
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3)
        expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
        expect(await listContactResponses()).toHaveLength(3)
    })
})
