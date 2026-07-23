/**
 * lib/build/d1-schema.ts
 *
 * Build-safe copies of the D1 table shape (contributors, composers, compositions) for
 * src/lib/build/d1-api.ts. Authoritative schema: src/lib/api/d1.ts (CONTRIBUTOR/COMPOSER/
 * COMPOSITION) — not build-safe, does `import { env } from "cloudflare:workers"` and embeds
 * `db: env.DB_MAIN` at module scope; throws in a plain-Node `astro build`.
 *
 * Duplicates only column lists, primary key, `protected` redaction list. Stable data, but a
 * second copy — keep in sync by hand on any schema change.
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
 * Subset of D1Schema (src/lib/api/types.d.ts) a build-time reader needs: explicit columns (not
 * `*`, so an unschema'd table column doesn't break the build), plus redaction. Omits `db`,
 * `index`, `repr_exclude`, `type_hint`, `locked` — Worker-only concerns.
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
 * Strips a schema's protected columns before a record leaves the build. Mirrors
 * {@link redactProtected} in src/lib/api/d1.ts — public build reads D1 directly, no server-side
 * chokepoint in front of it, so it redacts itself.
 */
export function redactProtected(schema: BuildD1Schema, record: object): Record<string, unknown> {
    const protectedKeys = schema.protected
    if (!protectedKeys || protectedKeys.length === 0) {
        return { ...record }
    }
    return Object.fromEntries(Object.entries(record).filter(([key]) => !protectedKeys.includes(key)))
}
