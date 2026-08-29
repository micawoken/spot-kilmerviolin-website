/**
 * Copyright (C) 2026 Michael Wong.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { env } from "cloudflare:workers"
import { beforeEach, describe, expect, it } from "vitest"
import { applySqlMigration } from "./helpers/d1"

const migration = Object.values(
    import.meta.glob("../migrations/0001_contact_responses.sql", {
        query: "?raw",
        import: "default",
        eager: true
    })
)[0] as string

beforeEach(async () => {
    await env.DB_MAIN.exec(`
        DROP TABLE IF EXISTS contact_responses;
        DROP TABLE IF EXISTS contact_migration_sentinel;
        CREATE TABLE contact_migration_sentinel (value TEXT NOT NULL);
        INSERT INTO contact_migration_sentinel (value) VALUES ('preserved');
    `)
})

describe("0001_contact_responses migration", () => {
    it("adds the contact schema without changing existing data", async () => {
        await applySqlMigration(env.DB_MAIN, migration)

        const columns = await env.DB_MAIN.prepare("PRAGMA table_info(contact_responses);").all<{ name: string }>()
        expect(columns.results.map((column) => column.name)).toEqual([
            "response_id",
            "subject",
            "name",
            "email",
            "phone",
            "body",
            "source_path",
            "spam_score",
            "spam_flags",
            "read_at",
            "entry_date",
            "change_date"
        ])
        expect(await env.DB_MAIN.prepare("SELECT value FROM contact_migration_sentinel;").first("value")).toBe(
            "preserved"
        )
        const triggers = await env.DB_MAIN.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'contact_responses' ORDER BY name;"
        ).all<{ name: string }>()
        expect(triggers.results.map((trigger) => trigger.name)).toEqual([
            "trg_contact_responses_entry_date_immutable",
            "trg_contact_responses_queue_limit"
        ])
    })

    it("is safe to execute more than once", async () => {
        await applySqlMigration(env.DB_MAIN, migration)
        await expect(applySqlMigration(env.DB_MAIN, migration)).resolves.toBeUndefined()
    })
})
