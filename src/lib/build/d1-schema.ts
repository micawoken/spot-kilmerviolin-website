/**
 * lib/build/d1-schema.ts
 *
 * Build-safe view of the D1 table shape (contributors, composers, compositions) for
 * src/lib/build/d1-api.ts
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
 * Subset of D1SchemaPrimitive (src/lib/api/types.d.ts) a build-time reader needs
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
 * Strips a schema's protected columns before a record leaves the build
 */
export function redactProtected(schema: BuildD1Schema, record: object): Record<string, unknown> {
    const protectedKeys = schema.protected
    if (!protectedKeys || protectedKeys.length === 0) {
        return { ...record }
    }
    return Object.fromEntries(Object.entries(record).filter(([key]) => !protectedKeys.includes(key)))
}

/**
 * Tag value that excludes an otherwise-valid contributor record from prerendering
 */
export const CONTRIBUTOR_HIDDEN_TAG = "hidden"

/** Whether a contributor record is tagged to be excluded from prerendering (see {@link CONTRIBUTOR_HIDDEN_TAG}). */
export function isHiddenContributor(record: ContributorRecord): boolean {
    return record.tags.includes(CONTRIBUTOR_HIDDEN_TAG)
}
