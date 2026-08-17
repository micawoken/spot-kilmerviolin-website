/**
 * lib/api/db_composer.ts
 *
 * Applies composers wrapper to the database.ts wrappers, providing a high-level interface
 *
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

import { COMPOSER } from "./d1.ts"
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
 * Get a composer record based on a unique param
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param param the unique column being queried on
 * @param value the value of the unique column being queried
 * @returns the composer record matching the query, or null if not found
 * @throws an error if the param is not a unique column
 */
export async function getComposer(ctx: ExecutionContext, param: string, value: string): Promise<ComposerRecord | null> {
    // retrieves a composer record based on the unique param
    return _getWrapper(COMPOSER, await _getPrimitive(ctx, COMPOSER, param, value)) as Promise<ComposerRecord | null>
}

/**
 * Add a composer record to the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param record the composer record to add
 * @returns the id of the new record
 * @throws an error if the record is invalid
 */
export async function addComposer(ctx: ExecutionContext, record: Composer): Promise<number> {
    return await _addPrimitive(ctx, COMPOSER, record)
}

/**
 * Add several composer records to the database in a single atomic transaction.
 *
 * Either every record is inserted or none is (see _addPrimitiveBatch). Records must be pre-validated by
 * the caller; a UNIQUE name collision (within the batch or against existing rows) fails the whole batch.
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param records the composer records to add
 * @returns the ids of the new records, in input order
 * @throws an error if the batch fails (nothing is written)
 */
export async function addComposersBatch(ctx: ExecutionContext, records: Composer[]): Promise<number[]> {
    return await _addPrimitiveBatch(ctx, COMPOSER, records)
}

/**
 * Update a composer record in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to update
 * @param record the updated composer record; all fields must be provided
 * @returns null if successful
 * @throws an error if the record is invalid or if the id does not exist
 */
export async function updateComposer(ctx: ExecutionContext, id: number, record: Composer): Promise<null> {
    return await _updatePrimitive(ctx, COMPOSER, id, record)
}

/**
 * Perform a partial update on a composer record in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to update
 * @param record the updated composer record; only provided fields will be updated
 * @returns null if successful
 * @throws an error if the record is invalid or if the id does not exist
 */
export async function updateComposerPartial(
    ctx: ExecutionContext,
    id: number,
    record: Partial<Composer>
): Promise<null> {
    return await _updatePrimitivePartial(ctx, COMPOSER, id, record)
}

/**
 * Delete a composer record from the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to delete
 * @returns null if successful
 * @throws an error if the id does not exist
 */
export async function deleteComposer(ctx: ExecutionContext, id: number): Promise<null> {
    return await _deletePrimitive(ctx, COMPOSER, id)
}

/**
 * List all composer records in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @returns an array of all composer records, or null if no records are found
 * @throws an error if the database query fails
 */
export async function listComposers(ctx: ExecutionContext): Promise<ComposerRecord[] | null> {
    return _listWrapper(COMPOSER, await _listPrimitive(ctx, COMPOSER)) as Promise<ComposerRecord[] | null>
}

/**
 * Conflict-detection hook for composer bulk creates: flags candidate names that already exist or repeat
 * within the request, so the (UNIQUE) idx_composers_name_role collision - on (name, role), not name alone -
 * is reported by the dry-run/preview rather than only surfacing as an aborted atomic write.
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param candidates the composer records about to be written (their names and roles)
 * @returns per-candidate name-conflict findings
 */
export async function findComposerNameConflicts(
    ctx: ExecutionContext,
    candidates: Array<{ name: string; role: string }>
): Promise<Array<{ index: number; reason: "within-request" | "exists"; message: string }>> {
    return findNameConflicts(await listComposers(ctx), candidates, "composer")
}
