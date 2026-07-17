/**
 * lib/build/entity-records.ts
 *
 * Normalizes the three D1 readers' (d1-api.ts) return shapes into one uniform record per entity noun,
 * for `src/pages/entity/[noun]/[id].astro` and `.../index.astro`. The one thing this exists to get
 * right: `fetchComposers()`/`fetchContributors()` return bare records, but `fetchCompositions()` returns
 * `{object, names}` (its resolved composer/contributor reference names, kept alongside rather than
 * merged into the record — see `CompositionWithNames`, src/lib/api/types.d.ts). Every other line in the
 * two page files treats a noun's records uniformly only because this module does that unwrapping in
 * exactly one place.
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
 *
 * This license is also subject to additional terms as specified in the README.md.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import type { EntityNoun } from "../compositor/entity-fields"

/** One entity record, normalized to what every noun's render/listing needs regardless of its source shape. */
export interface EntityRecord {
    /** stringified — Astro static route params are always strings */
    id: string
    entry: Record<string, unknown>
    /** only ever set for a composition record; see the module header */
    entryNames?: CompositionNames
}

/**
 * Normalizes one noun's fetched D1 rows into {@link EntityRecord}s. A `null` reader result (D1
 * unconfigured, or that specific table read skipped) contributes no records — the caller's
 * dual-source-dependency gate treats that the same as "no records" either way.
 *
 * @param {EntityNoun} noun - which reader's rows to read (the other two are ignored)
 * @param {ComposerRecord[] | null} composers - `fetchComposers()`'s result
 * @param {ContributorRecord[] | null} contributors - `fetchContributors()`'s result (already active-only, redacted)
 * @param {CompositionWithNames[] | null} compositions - `fetchCompositions()`'s result
 * @returns {EntityRecord[]} that noun's records, in reader order
 */
export function entityRecords(
    noun: EntityNoun,
    composers: ComposerRecord[] | null,
    contributors: ContributorRecord[] | null,
    compositions: CompositionWithNames[] | null
): EntityRecord[] {
    switch (noun) {
        case "composer":
            return (composers ?? []).map((record) => ({ id: String(record.id), entry: record as unknown as Record<string, unknown> }))
        case "contributor":
            return (contributors ?? []).map((record) => ({ id: String(record.id), entry: record as unknown as Record<string, unknown> }))
        case "composition":
            return (compositions ?? []).map((record) => ({
                id: String(record.object.id),
                entry: record.object as unknown as Record<string, unknown>,
                entryNames: record.names
            }))
    }
}
