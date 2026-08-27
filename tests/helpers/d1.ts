/**
 * Copyright (C) 2026 Michael Wong.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

const migrationStatementPattern = /CREATE TABLE[\s\S]*?\r?\n\);|CREATE INDEX[^\r\n]+;|CREATE TRIGGER[\s\S]*?\r?\nEND;/g

export async function applySqlMigration(database: D1Database, migration: string): Promise<void> {
    const statements = migration.match(migrationStatementPattern)
    if (!statements || statements.join("\n").replace(/\s/g, "") !== migration.replace(/\s/g, "")) {
        throw new Error("Migration contains an unsupported SQL statement")
    }

    for (const statement of statements) {
        await database.prepare(statement).run()
    }
}
