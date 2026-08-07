/**
 * lib/build/d1-schema.ts
 *
 * Build-safe view of the D1 table shape (contributors, composers, compositions) for
 * src/lib/build/d1-api.ts. Sourced from src/lib/api/tables.ts — the canonical, environment-free
 * table shapes also used by src/lib/api/d1.ts (which adds `db: env.DB_MAIN`, a
 * `cloudflare:workers` binding that throws in a plain-Node `astro build`).
 *
 * BuildD1Schema narrows that shape to just what a build-time reader needs: column lists, primary
 * key, `protected` redaction list.
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

import { CONTRIBUTOR_TABLE, COMPOSER_TABLE, COMPOSITION_TABLE } from "../api/tables"

/**
 * Subset of D1SchemaPrimitive (src/lib/api/types.d.ts) a build-time reader needs: explicit columns
 * (not `*`, so an unschema'd table column doesn't break the build), plus redaction. Omits `index`,
 * `repr_exclude`, `type_hint`, `locked` (Worker-only concerns) and `db` (D1Schema only).
 */
export interface BuildD1Schema {
    readonly name: string
    readonly columns: string[]
    readonly primary_key: string
    readonly protected?: string[]
}

/** Table shape for contributors, from src/lib/api/tables.ts. */
export const CONTRIBUTOR_SCHEMA: BuildD1Schema = CONTRIBUTOR_TABLE

/** Table shape for composers, from src/lib/api/tables.ts. */
export const COMPOSER_SCHEMA: BuildD1Schema = COMPOSER_TABLE

/** Table shape for compositions, from src/lib/api/tables.ts. */
export const COMPOSITION_SCHEMA: BuildD1Schema = COMPOSITION_TABLE

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

/**
 * Tag value that excludes an otherwise-valid contributor record from prerendering. This is the ONLY
 * page-existence exclusion for contributors — `active` (see CONTRIBUTOR_TABLE's `protected` comment in
 * src/lib/api/tables.ts) gates authorization/permissions only, not whether a public page renders; a
 * deactivated contributor still gets a page unless also tagged `hidden`.
 */
export const CONTRIBUTOR_HIDDEN_TAG = "hidden"

/** Whether a contributor record is tagged to be excluded from prerendering (see {@link CONTRIBUTOR_HIDDEN_TAG}). */
export function isHiddenContributor(record: ContributorRecord): boolean {
    return record.tags.includes(CONTRIBUTOR_HIDDEN_TAG)
}
