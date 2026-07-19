/**
 * lib/build/entity-records.ts
 *
 * Normalizes the three D1 readers' (d1-api.ts) return shapes into one uniform, FLAT record per entity
 * noun, for `src/pages/entity/[noun]/[id].astro` and `.../index.astro`. This is the reference-fold
 * seam (unified field-outlet rewrite): a composition's foreign keys (`composer_id`,
 * `contrib_primary_1`/`_2`, `contrib_addl`, `author_secondary`) are resolved to `{id, name, href}`
 * objects HERE, once, so every outlet downstream reads a plain `entry[field]` — no parallel
 * `entryNames`/`CompositionNames` structure, no dedicated per-noun render block needed to reach a
 * reference. `formatWorkFromD1` (api/common.ts) nests D1's already-flat columns into
 * `rating.*`/`publication_info.*` for the runtime API's `Composition` shape; this module flattens them
 * back so every entity field — composer or composition — is a plain top-level key.
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

import { entityHref } from "../compositor/composition-fields"
import type { EntityNoun } from "../compositor/entity-fields"
import { formatLifespan } from "../../scripts/format"

/** One entity record, normalized to a flat `entry` every noun's render/listing reads uniformly. */
export interface EntityRecord {
    /** stringified — Astro static route params are always strings */
    id: string
    entry: Record<string, unknown>
}

/** A resolved foreign-key reference, as it appears on a normalized composition's `entry`. */
export interface ResolvedReference {
    id: number
    name: string
    /** null when the target has no public page (unresolvable id, inactive contributor, or that noun has
     *  no published default template this build) — the outlet renders the name as plain text, not a link
     *  to a 404. */
    href: string | null
}

/** name + whether the target noun/record actually gets a public page this build. */
interface ReferenceTarget {
    name: string
    hasPage: boolean
}

/** id → {name, hasPage} for each of the two referenceable nouns (composer, contributor). */
export interface EntityReferenceIndex {
    composer: Map<number, ReferenceTarget>
    contributor: Map<number, ReferenceTarget>
}

/**
 * Builds the reference index a composition's foreign keys resolve against. `allContributors` MUST be the
 * unredacted, all-contributors list (`fetchAllContributors`/`fetchAllContributorsForBuild` in d1-api.ts),
 * NOT the active-only public list — a composition may legitimately reference an inactive contributor, and
 * deriving the map from the active-only list would silently render every such reference as a blank name
 * (see d1-api.ts's `fetchContributors` header). Only `id`/`name`/`active` are read off it; nothing else
 * from an inactive contributor's record reaches a public page through this index.
 *
 * @param {ComposerRecord[] | null} composers - every composer (composers have no active/inactive concept)
 * @param {ContributorRecord[] | null} allContributors - every contributor, unredacted, active or not
 * @param {Record<EntityNoun, boolean>} nounHasPage - whether each noun has a resolved default template
 *   this build (`resolveEntityTemplates`) — a reference to a noun with no template has nowhere to link
 * @returns {EntityReferenceIndex} the id→target maps `entityRecords` resolves composition FKs against
 */
export function buildReferenceIndex(
    composers: ComposerRecord[] | null,
    allContributors: ContributorRecord[] | null,
    nounHasPage: Record<EntityNoun, boolean>
): EntityReferenceIndex {
    const composer = new Map<number, ReferenceTarget>()
    for (const record of composers ?? []) {
        composer.set(record.id, { name: record.name, hasPage: nounHasPage.composer })
    }

    const contributor = new Map<number, ReferenceTarget>()
    for (const record of allContributors ?? []) {
        contributor.set(record.id, { name: record.name, hasPage: nounHasPage.contributor && record.active })
    }

    return { composer, contributor }
}

/** Resolves a single nullable foreign key to a display reference, or null when the key itself is null. */
function resolveRef(index: Map<number, ReferenceTarget>, id: number | null, noun: EntityNoun): ResolvedReference | null {
    if (id === null) return null
    const target = index.get(id)
    if (!target) return { id, name: "", href: null } // unresolvable id — mirrors the prior "" fallback
    return { id, name: target.name, href: target.hasPage ? entityHref(noun, id) : null }
}

/** Resolves a list of foreign keys, preserving order and length (an unresolvable id still gets an entry). */
function resolveRefList(index: Map<number, ReferenceTarget>, ids: number[], noun: EntityNoun): ResolvedReference[] {
    return ids.map((id) => resolveRef(index, id, noun) as ResolvedReference)
}

/** Flattens one CompositionRecord (nested `rating`/`publication_info`) into a normalized flat entry. */
function flattenComposition(record: CompositionRecord, refs: EntityReferenceIndex): Record<string, unknown> {
    const contrib_primary_1 = resolveRef(refs.contributor, record.contrib_primary_1, "contributor")
    const contrib_primary_2 = resolveRef(refs.contributor, record.contrib_primary_2, "contributor")
    const contrib_addl = resolveRefList(refs.contributor, record.contrib_addl, "contributor")
    return {
        id: record.id,
        name: record.name,
        type: record.type,
        part: record.part,
        image: record.image,
        composer: resolveRef(refs.composer, record.composer_id, "composer"),
        author_secondary: resolveRefList(refs.composer, record.author_secondary, "composer"),
        contrib_primary_1,
        contrib_primary_2,
        contrib_addl,
        // Derived, not a D1 column: primary/additional-primary/additional is an internal-only distinction
        // (owner decision) — public pages bind this single combined list instead, in one line.
        contributors: [contrib_primary_1, contrib_primary_2, ...contrib_addl].filter(
            (ref): ref is ResolvedReference => ref !== null
        ),
        phases: record.phases,
        key: record.key,
        range: record.range,
        position_highest: record.position_highest,
        rating_suzuki: record.rating.suzuki,
        rating_nyssma: record.rating.nyssma,
        publish_name: record.publication_info.name,
        publish_location: record.publication_info.location,
        publish_year: record.publication_info.year,
        publication_uri: { uriType: record.publication_info.uri_type, uri: record.publication_info.uri },
        notes_historical: record.notes_historical,
        notes_pedagogical: record.notes_pedagogical,
        notes_other: record.notes_other,
        tags: record.tags,
        entry_date: record.entry_date,
        change_date: record.change_date
    }
}

/**
 * Normalizes one noun's fetched D1 rows into {@link EntityRecord}s. A `null` reader result (D1
 * unconfigured, or that specific table read skipped) contributes no records — the caller's
 * dual-source-dependency gate treats that the same as "no records" either way. Contributor records are
 * already flat (`ContributorRecord`) and pass through as `entry` unchanged; composer records are already
 * flat too but gain one derived field (`life_span`, see entity-fields.ts); composition records are
 * flattened and reference-resolved via {@link flattenComposition}.
 *
 * @param {EntityNoun} noun - which reader's rows to read (the other two are ignored)
 * @param {ComposerRecord[] | null} composers - `fetchComposers()`'s result
 * @param {ContributorRecord[] | null} contributors - `fetchContributors()`'s result (already active-only, redacted)
 * @param {CompositionRecord[] | null} compositions - `fetchCompositions()`'s result
 * @param {EntityReferenceIndex} refs - the reference index (see {@link buildReferenceIndex}); only
 *   consulted for the "composition" noun
 * @returns {EntityRecord[]} that noun's records, in reader order
 */
export function entityRecords(
    noun: EntityNoun,
    composers: ComposerRecord[] | null,
    contributors: ContributorRecord[] | null,
    compositions: CompositionRecord[] | null,
    refs: EntityReferenceIndex
): EntityRecord[] {
    switch (noun) {
        case "composer":
            // life_span (entity-fields.ts) is derived, not a D1 column: pre-built here, once per record,
            // from birth_year/death_year so a template can bind the whole range as a single field.
            return (composers ?? []).map((record) => ({
                id: String(record.id),
                entry: {
                    ...record,
                    life_span: formatLifespan(record.birth_year, record.death_year)
                } as unknown as Record<string, unknown>
            }))
        case "contributor":
            return (contributors ?? []).map((record) => ({ id: String(record.id), entry: record as unknown as Record<string, unknown> }))
        case "composition":
            return (compositions ?? []).map((record) => ({ id: String(record.id), entry: flattenComposition(record, refs) }))
    }
}
