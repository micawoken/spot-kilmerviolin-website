/**
 * lib/api/db_contributor.ts
 *
 * Applies contributors wrapper to the database.ts wrappers, providing a high-level interface
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
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

import { CONTRIBUTOR } from "./d1.ts"
import {
    _addPrimitive,
    _addPrimitiveBatch,
    _getPrimitive,
    _updatePrimitive,
    _updatePrimitivePartial,
    _deletePrimitive,
    _listPrimitive,
    _getWrapper,
    _listWrapper,
    findNameConflicts
} from "./database.ts"

/**
 * Get a contributor record based on a unique param
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param param the unique column being queried on (from D1Schema.index, i.e. the D1 types, not API types)
 * @param value the value of the unique column being queried
 * @returns the contributor record matching the query, or null if not found
 * @throws an error if the param is not a unique column
 */
export async function getContributor(
    ctx: ExecutionContext,
    param: string,
    value: string
): Promise<ContributorRecord | null> {
    // given the unique param and its value, return the contributor record
    // caching is implemented at the primitive level
    return _getWrapper(
        CONTRIBUTOR,
        await _getPrimitive(ctx, CONTRIBUTOR, param, value)
    ) as Promise<ContributorRecord | null>
}

/**
 * Add a contributor record to the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param record the contributor record to add
 * @returns the id of the new record
 */
export async function addContributor(ctx: ExecutionContext, record: Contributor): Promise<number> {
    // adds a contributor record to the database, returning the new record's id
    return await _addPrimitive(ctx, CONTRIBUTOR, record)
}

/**
 * Add several contributor records to the database in a single atomic transaction.
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param records the contributor records to add
 * @returns the ids of the new records, in input order
 * @throws an error if the batch fails (nothing is written)
 */
export async function addContributorsBatch(ctx: ExecutionContext, records: Contributor[]): Promise<number[]> {
    return await _addPrimitiveBatch(ctx, CONTRIBUTOR, records)
}

/**
 * Update a contributor record in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to update
 * @param record the updated contributor record; all fields must be provided
 * @returns null if successful
 * @throws an error if the record is invalid or if the id does not exist
 */
export async function updateContributor(ctx: ExecutionContext, id: number, record: Contributor): Promise<null> {
    // updates a contributor record in the database, returning null if successful
    return await _updatePrimitive(ctx, CONTRIBUTOR, id, record)
}

/**
 * Perform a partial update on a contributor record in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to update
 * @param record the updated contributor record; only provided fields will be updated
 * @param allowProtected whether the caller has authorized writing protected columns (roles/admin/
 *   identity_email); the caller must perform its own elevation/permission check before passing true
 * @returns null if successful
 * @throws an error if the record is invalid, if the id does not exist, or if it writes a protected column without authorization
 */
export async function updateContributorPartial(
    ctx: ExecutionContext,
    id: number,
    record: Partial<Contributor>,
    allowProtected: boolean = false
): Promise<null> {
    return await _updatePrimitivePartial(ctx, CONTRIBUTOR, id, record, allowProtected)
}

/**
 * Delete a contributor record from the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to delete
 * @returns null if successful
 * @throws an error if the id does not exist
 */
export async function deleteContributor(ctx: ExecutionContext, id: number): Promise<null> {
    return await _deletePrimitive(ctx, CONTRIBUTOR, id)
}

/**
 * List all contributor records in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @returns an array of all contributor records, or null if no records are found
 * @throws an error if the database query fails
 */
export async function listContributors(ctx: ExecutionContext): Promise<ContributorRecord[] | null> {
    return _listWrapper(CONTRIBUTOR, await _listPrimitive(ctx, CONTRIBUTOR)) as Promise<ContributorRecord[] | null>
}

/**
 * Conflict-detection hook for contributor bulk creates: flags candidate names that already exist or repeat
 * within the request (mirrors db_composer.ts's findComposerNameConflicts for the contributors.name UNIQUE column).
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param candidates the contributor records about to be written (their names)
 * @returns per-candidate name-conflict findings
 */
export async function findContributorNameConflicts(
    ctx: ExecutionContext,
    candidates: Array<{ name: string }>
): Promise<Array<{ index: number; reason: "within-request" | "exists"; message: string }>> {
    return findNameConflicts(await listContributors(ctx), candidates, "contributor")
}
