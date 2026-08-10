/**
 * lib/api/db_composition.ts
 *
 * Composition CRUD (built on the generic engine in database.ts) plus the composition-identity helpers
 * layered on top of it: the (composer, name, part) duplicate check backing the composite UNIQUE index,
 * and the same-name disambiguation used by list/tile display.
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

import { COMPOSITION } from "./d1.ts"
import {
    _addPrimitive,
    _addPrimitiveBatch,
    _getPrimitive,
    _updatePrimitive,
    _updatePrimitivePartial,
    _deletePrimitive,
    _listPrimitive,
    _getWrapper,
    _listWrapper
} from "./database.ts"
import { listComposers } from "./db_composer.ts"
import { listContributors } from "./db_contributor.ts"

/**
 * Normalizes a composition (composer_id, name, part) triple into a comparison key.
 *
 * A composition's identity is (composer_id, name, part): the same piece by the same composer for a different
 * part (e.g. "Violin I" vs "Violin II") is distinct, but two rows agreeing on all three collide. SQLite
 * cannot enforce this through a generated column (the value depends on a cross-table lookup), so a composite
 * UNIQUE index on (composer_id, name, COALESCE(part,'')) is the database backstop and this key is the
 * application-model mirror. Name and part are compared case-insensitively and whitespace-trimmed so trivial
 * variants collide as intended, and a null part is treated as an empty part so two part-less rows still
 * conflict. The NUL separator cannot appear in a name or part, so distinct triples never alias.
 *
 * @param composer_id the referenced composer id
 * @param name the composition name
 * @param part the composition part, or null for a part-less work
 * @returns a stable key identifying the (composer, name, part) triple
 */
function compositionDuplicateKey(composer_id: number, name: string, part: string | null): string {
    return `${composer_id} ${name.trim().toLowerCase()} ${(part ?? "").trim().toLowerCase()}`
}

/**
 * Groups compositions by their (composer_id, name) pair — the two components of the compositions
 * table's UNIQUE index (composer_id, name, COALESCE(part,'')) that on their own do NOT guarantee
 * uniqueness; `part` is the index's third, disambiguating component. Two compositions sharing this key
 * are indistinguishable by name+composer alone and need their `part` surfaced in a display name to
 * tell them apart. Case-insensitive, whitespace-trimmed to mirror {@link compositionDuplicateKey}.
 */
export function compositionNameCollisionKey(composer_id: number, name: string): string {
    return `${composer_id} ${name.trim().toLowerCase()}`
}

/**
 * A composition's display name, with its `part` appended in parentheses when another composition
 * shares the exact same (composer, name) pair — automatic disambiguation for list/tile contexts that
 * show a composition's name next to its composer but have no other way to tell same-titled works
 * apart. A part-less composition stays ambiguous even when a same-named sibling has its own part: there
 * is nothing to disambiguate it WITH.
 */
export function disambiguatedCompositionName(name: string, part: string | null, hasCollision: boolean): string {
    return hasCollision && part ? `${name} (${part})` : name
}

/**
 * Enforces that no two compositions share a composer, (normalized) name, and part, at the application model
 * level. Checks the candidate triples against each other (catching duplicates inside a single bulk upload)
 * and against every existing composition (excluding excludeId, so a record does not conflict with itself
 * on update). This complements the composite UNIQUE index added in db_add_composition_part_unique.sql: the
 * index is the authoritative guard, while this produces a clear, early error before the write is attempted
 * and covers the cached read model uniformly across the single, batch, and update paths.
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param candidates the (composer_id, name, part) triples about to be written
 * @param excludeId a composition id to ignore among existing rows (the record being updated), if any
 * @throws an Error naming the offending composition if a duplicate is found
 */
export async function findCompositionDuplicates(
    ctx: ExecutionContext,
    candidates: Array<{ composer_id: number; name: string; part: string | null }>,
    excludeId?: number
): Promise<Array<{ index: number; reason: "within-request" | "exists"; message: string }>> {
    const findings: Array<{ index: number; reason: "within-request" | "exists"; message: string }> = []
    // collisions with existing compositions (excluding the record being updated, if any)
    const existing = await listCompositions(ctx)
    const existing_keys = new Set<string>()
    if (existing) {
        for (const composition of existing) {
            if (excludeId !== undefined && composition.id === excludeId) {
                continue
            }
            existing_keys.add(compositionDuplicateKey(composition.composer_id, composition.name, composition.part))
        }
    }
    // walk candidates in order: an earlier candidate with the same key makes a later one a within-request
    // duplicate; a match against existing rows is an "exists" duplicate
    const seen = new Set<string>()
    for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index]
        const key = compositionDuplicateKey(candidate.composer_id, candidate.name, candidate.part)
        if (seen.has(key)) {
            findings.push({
                index,
                reason: "within-request",
                message: `"${candidate.name.trim()}" appears more than once for the same composer in this request`
            })
        } else if (existing_keys.has(key)) {
            findings.push({
                index,
                reason: "exists",
                message: `A composition named "${candidate.name.trim()}" already exists for this composer`
            })
        }
        seen.add(key)
    }
    return findings
}

/**
 * Throwing wrapper over {@link findCompositionDuplicates} used on the write paths (single add, batch add,
 * and update). Throws on the first duplicate so a write is never attempted when the (composer, name, part)
 * invariant would be violated; the composite UNIQUE index remains the authoritative backstop.
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param candidates the (composer_id, name, part) triples about to be written
 * @param excludeId a composition id to ignore among existing rows (the record being updated), if any
 * @throws an Error naming the offending composition if a duplicate is found
 */
async function _assertNoCompositionDuplicates(
    ctx: ExecutionContext,
    candidates: Array<{ composer_id: number; name: string; part: string | null }>,
    excludeId?: number
): Promise<void> {
    const findings = await findCompositionDuplicates(ctx, candidates, excludeId)
    if (findings.length > 0) {
        throw new Error(findings[0].message)
    }
}

/**
 * Get a composition record based on a unique param
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param param the unique column being queried on
 * @param value the value of the unique column being queried
 * @returns the composition record matching the query, or null if not found
 * @throws an error if the param is not a unique column
 */
export async function getComposition(
    ctx: ExecutionContext,
    param: string,
    value: string
): Promise<CompositionRecord | null> {
    return _getWrapper(
        COMPOSITION,
        await _getPrimitive(ctx, COMPOSITION, param, value)
    ) as Promise<CompositionRecord | null>
}

/**
 * Add a composition record to the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param record the composition record to add
 * @returns the id of the new record
 * @throws an error if the record is invalid
 */
export async function addComposition(ctx: ExecutionContext, record: Composition): Promise<number> {
    // enforce the (composer, name, part) uniqueness invariant before writing (mirrors the composite UNIQUE index)
    await _assertNoCompositionDuplicates(ctx, [
        { composer_id: record.composer_id, name: record.name, part: record.part }
    ])
    return await _addPrimitive(ctx, COMPOSITION, record)
}

/**
 * Add several composition records to the database in a single atomic transaction.
 *
 * Enforces the (composer, name) uniqueness invariant across the batch and against existing rows before
 * writing (see _assertNoCompositionDuplicates), then commits atomically (see _addPrimitiveBatch): either
 * every record is inserted or none is. Records must otherwise be pre-validated (and their name references
 * already resolved to ids) by the caller.
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param records the composition records to add
 * @returns the ids of the new records, in input order
 * @throws an error on a duplicate (composer, name) or if the batch fails (nothing is written)
 */
export async function addCompositionsBatch(ctx: ExecutionContext, records: Composition[]): Promise<number[]> {
    await _assertNoCompositionDuplicates(
        ctx,
        records.map((record) => ({ composer_id: record.composer_id, name: record.name, part: record.part }))
    )
    return await _addPrimitiveBatch(ctx, COMPOSITION, records)
}

/**
 * Update a composition record in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to update
 * @param record the updated composition record; all fields must be provided
 * @returns null if successful
 * @throws an error if the record is invalid or if the id does not exist
 */
export async function updateComposition(ctx: ExecutionContext, id: number, record: Composition): Promise<null> {
    // enforce (composer, name, part) uniqueness, ignoring this record's own existing row
    await _assertNoCompositionDuplicates(
        ctx,
        [{ composer_id: record.composer_id, name: record.name, part: record.part }],
        id
    )
    return await _updatePrimitive(ctx, COMPOSITION, id, record)
}

/**
 * Perform a partial update on a composition record in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to update
 * @param record the updated composition record; only provided fields will be updated
 * @returns null if successful
 * @throws an error if the record is invalid or if the id does not exist
 */
export async function updateCompositionPartial(
    ctx: ExecutionContext,
    id: number,
    record: Partial<Composition>
): Promise<null> {
    // a partial update only risks a (composer, name, part) collision when it changes the name, composer, or
    // part; resolve the effective triple from the patch (falling back to the current row for untouched
    // fields) and enforce uniqueness, ignoring this record's own existing row
    if (record.name !== undefined || record.composer_id !== undefined || record.part !== undefined) {
        const current = await getComposition(ctx, "composition_id", id.toString())
        if (current) {
            await _assertNoCompositionDuplicates(
                ctx,
                [
                    {
                        composer_id: record.composer_id ?? current.composer_id,
                        name: record.name ?? current.name,
                        part: record.part !== undefined ? record.part : current.part
                    }
                ],
                id
            )
        }
    }
    return await _updatePrimitivePartial(ctx, COMPOSITION, id, record)
}

/**
 * Delete a composition record from the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to delete
 * @returns null if successful
 * @throws an error if the id does not exist
 */
export async function deleteComposition(ctx: ExecutionContext, id: number): Promise<null> {
    return await _deletePrimitive(ctx, COMPOSITION, id)
}

/**
 * List all composition records in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @returns an array of all composition records, or null if no records are found
 * @throws an error if the database query fails
 */
export async function listCompositions(ctx: ExecutionContext): Promise<CompositionRecord[] | null> {
    return _listWrapper(COMPOSITION, await _listPrimitive(ctx, COMPOSITION)) as Promise<CompositionRecord[] | null>
}

/**
 * Pairs each composition with the human-readable names referenced by its numeric fields
 *
 * A composition stores only numeric references: composer_id and the author_secondary id list point into
 * the composer table, while contrib_primary_1, contrib_primary_2, and contrib_addl point into the
 * contributor table. This resolves all of them to names. Each table is fetched once (both are served from
 * the caching layer) and indexed, so resolving a list of compositions costs a single read per table
 * rather than one per reference. Unresolvable ids yield an empty string, keeping author_secondary_names
 * and contrib_addl_names aligned positionally with their source arrays; a null contrib_primary_2 also
 * yields an empty string.
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param compositions the composition records to resolve names for
 * @returns each composition paired with its resolved composer and contributor names
 */
export async function attachCompositionNames(
    ctx: ExecutionContext,
    compositions: CompositionRecord[]
): Promise<CompositionWithNames[]> {
    const composers = await listComposers(ctx)
    const composer_names = new Map<number, string>()
    if (composers) {
        for (const composer of composers) {
            composer_names.set(composer.id, composer.name)
        }
    }
    const contributors = await listContributors(ctx)
    const contributor_names = new Map<number, string>()
    if (contributors) {
        for (const contributor of contributors) {
            contributor_names.set(contributor.id, contributor.name)
        }
    }
    return compositions.map((composition) => ({
        object: composition,
        names: {
            composer_name: composer_names.get(composition.composer_id) ?? "",
            author_secondary_names: composition.author_secondary.map((id) => composer_names.get(id) ?? ""),
            contrib_primary_1_name: contributor_names.get(composition.contrib_primary_1) ?? "",
            contrib_primary_2_name:
                composition.contrib_primary_2 === null
                    ? ""
                    : (contributor_names.get(composition.contrib_primary_2) ?? ""),
            contrib_addl_names: composition.contrib_addl.map((id) => contributor_names.get(id) ?? "")
        }
    }))
}
