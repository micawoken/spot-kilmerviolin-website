/**
 * lib/build/d1-schema.ts
 *
 * Build-safe copies of the D1 table shape for the three public entity tables (contributors,
 * composers, compositions), for use by the build-time D1 reader (src/lib/build/d1-api.ts).
 *
 * The authoritative schema lives in src/lib/api/d1.ts (CONTRIBUTOR/COMPOSER/COMPOSITION), but that
 * module is NOT build-safe: it does `import { env } from "cloudflare:workers"`, and each schema
 * constant embeds `db: env.DB_MAIN` at module top level. Importing it (even just for the schema
 * constants) into a plain-Node `astro build` process throws, because there is no Worker binding
 * available there.
 *
 * Only the static shape the build reader needs is duplicated here: column lists, the primary key,
 * and the `protected` redaction list (used to strip contributor identity fields from public pages).
 * This is stable data — a schema change requires a DB migration plus a src/lib/api/d1.ts edit — but
 * it is a second copy, so keep the two in sync by hand if the source tables change.
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

/**
 * The subset of D1Schema (src/lib/api/types.d.ts) a build-time reader needs: enough to select
 * explicit columns (not `*`, so a table carrying a column not yet in the schema doesn't break the
 * build) and to redact protected columns before a record reaches a public page. Deliberately omits
 * `db` (a runtime D1Database handle), `index`, `repr_exclude`, `type_hint`, and `locked` — none of
 * those are needed outside the Worker's read/write/validation paths.
 */
export interface BuildD1Schema {
    readonly name: string
    readonly columns: string[]
    readonly primary_key: string
    readonly protected?: string[]
}

/** Mirrors CONTRIBUTOR in src/lib/api/d1.ts. */
export const CONTRIBUTOR_SCHEMA: BuildD1Schema = {
    name: "contributors",
    columns: [
        "contributor_id",
        "name",
        "class_year",
        "major",
        "phases",
        "bio",
        "public_email",
        "identity_email",
        "active",
        "roles",
        "admin",
        "image",
        "tags",
        "entry_date",
        "change_date"
    ],
    primary_key: "contributor_id",
    protected: ["roles", "admin", "identity_email"]
}

/** Mirrors COMPOSER in src/lib/api/d1.ts. */
export const COMPOSER_SCHEMA: BuildD1Schema = {
    name: "composers",
    columns: [
        "composer_id",
        "name",
        "role",
        "birth_year",
        "death_year",
        "country",
        "bio",
        "image",
        "tags",
        "entry_date",
        "change_date"
    ],
    primary_key: "composer_id"
}

/** Mirrors COMPOSITION in src/lib/api/d1.ts. */
export const COMPOSITION_SCHEMA: BuildD1Schema = {
    name: "compositions",
    columns: [
        "composition_id",
        "name",
        "composer_id",
        "contrib_primary_1",
        "contrib_primary_2",
        "contrib_addl",
        "author_secondary",
        "type",
        "part",
        "rating_suzuki",
        "rating_nyssma",
        "publish_location",
        "publish_name",
        "publish_year",
        "uri_type",
        "uri",
        "key",
        "range",
        "position_highest",
        "notes_pedagogical",
        "notes_historical",
        "notes_other",
        "image",
        "phases",
        "entry_date",
        "tags",
        "change_date"
    ],
    primary_key: "composition_id"
}

/**
 * Strips a schema's protected columns from a record before it leaves the build. Build-safe mirror
 * of {@link redactProtected} in src/lib/api/d1.ts — the public build reads D1 directly (not through
 * the API's read endpoints), so it must redact itself; there is no server-side chokepoint in front
 * of it.
 *
 * @param schema - the BuildD1Schema whose `protected` list names the columns to remove (no-op when absent)
 * @param record - the record to redact
 * @returns a shallow copy of the record with protected properties removed
 */
export function redactProtected(schema: BuildD1Schema, record: object): Record<string, unknown> {
    const protectedKeys = schema.protected
    if (!protectedKeys || protectedKeys.length === 0) {
        return { ...record }
    }
    return Object.fromEntries(Object.entries(record).filter(([key]) => !protectedKeys.includes(key)))
}
