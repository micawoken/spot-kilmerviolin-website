/**
 * lib/build/entity-records.ts
 *
 * Normalizes the three D1 readers' (d1-api.ts) return shapes into one uniform, FLAT record per entity
 * noun, for `src/pages/entity/[noun]/[id].astro` and `.../index.astro`. Reference-fold seam (unified
 * field-outlet rewrite): a composition's foreign keys (`composer_id`, `contrib_primary_1`/`_2`,
 * `contrib_addl`, `author_secondary`) resolved to `{id, name, href}` objects HERE, once — every outlet
 * downstream reads a plain `entry[field]`, no parallel `entryNames`/`CompositionNames` structure, no
 * per-noun render block to reach a reference. `formatWorkFromD1` (api/common.ts) nests D1's flat
 * columns into `rating.*`/`publication_info.*` for the runtime API's `Composition` shape; this module
 * flattens them back — every entity field, composer or composition, a plain top-level key.
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

import { entityHref } from "../compositor/composition-fields"
import type { EntityNoun } from "../compositor/entity-fields"
import { formatLifespan } from "../../scripts/format"
import { isHiddenContributor } from "./d1-schema"

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
    /** the composer's `role` (e.g. "arranger"), carried through only for composer references — undefined
     *  for a contributor reference or an unresolvable id. Only the `author_secondary` outlet (catalog.tsx)
     *  renders it; other composer-referencing fields (e.g. the primary `composer` field) ignore it. */
    role?: string
}

/** One tile in the `RelatedEntries` Puck block (catalog.tsx) — always a work, regardless of which noun's
 *  page it appears on (see `buildRelatedWorksIndex`'s header). */
export interface RelatedWork {
    id: number
    name: string
    /** null when compositions have no published default template this build — see {@link ResolvedReference}. */
    href: string | null
    /** the work's composer display name, for the tile's subtitle; "" when unresolved. */
    composer: string
}

/** name + whether the target noun/record actually gets a public page this build. `role` is only set for
 *  composer targets (see {@link ResolvedReference}). */
interface ReferenceTarget {
    name: string
    hasPage: boolean
    role?: string
}

/** id → {name, hasPage} for each of the two referenceable nouns (composer, contributor). */
export interface EntityReferenceIndex {
    composer: Map<number, ReferenceTarget>
    contributor: Map<number, ReferenceTarget>
}

/**
 * Builds the reference index a composition's foreign keys resolve against. `allContributors` MUST be
 * the unredacted, all-contributors list (`fetchAllContributors` in d1-api.ts), NOT the
 * `fetchContributors` public list — deriving the map from the filtered list would silently blank a
 * reference to any hidden contributor (see d1-api.ts's `fetchContributors` header). Only `id`/`name`/
 * `tags` read off it — nothing else from a hidden contributor's record reaches a public page through
 * this index. `hasPage` for a contributor mirrors `fetchContributors`' own filter exactly
 * (`!isHiddenContributor`), so a reference links if and only if that contributor's own page exists;
 * `active` plays no part — a deactivated contributor still gets a page and a working hyperlink unless
 * also tagged `hidden`. `nounHasPage`: whether each noun has a resolved default template this build — a
 * reference to a noun with no template has nowhere to link.
 */
export function buildReferenceIndex(
    composers: ComposerRecord[] | null,
    allContributors: ContributorRecord[] | null,
    nounHasPage: Record<EntityNoun, boolean>
): EntityReferenceIndex {
    const composer = new Map<number, ReferenceTarget>()
    for (const record of composers ?? []) {
        composer.set(record.id, { name: record.name, hasPage: nounHasPage.composer, role: record.role })
    }

    const contributor = new Map<number, ReferenceTarget>()
    for (const record of allContributors ?? []) {
        contributor.set(record.id, {
            name: record.name,
            hasPage: nounHasPage.contributor && !isHiddenContributor(record)
        })
    }

    return { composer, contributor }
}

/**
 * Builds the id→related-works lists the `RelatedEntries` Puck block (catalog.tsx) renders as tiles —
 * related entries are always works, regardless of which noun's detail page shows them: a composer's
 * tiles are their works, a
 * contributor's tiles are works they contributed to, a work's tiles are other works by the same
 * composer. Keyed `"{noun}:{id}"` so one map serves all three nouns.
 *
 * Owner decision (v1 scope): a work's related list is same-composer-only, no editor-curated list yet.
 *
 * `nounHasPage` only checks "composition" — every related tile links to a work, so only that flag
 * matters. Result order: composer keys list primary credits before secondary-author credits.
 */
export function buildRelatedWorksIndex(
    composers: ComposerRecord[] | null,
    compositions: CompositionRecord[] | null,
    nounHasPage: Record<EntityNoun, boolean>
): Map<string, RelatedWork[]> {
    const composerNames = new Map<number, string>()
    for (const record of composers ?? []) composerNames.set(record.id, record.name)

    const works = compositions ?? []
    // Raw `record.name`, deliberately: the exact-name-match ordering below (composition bucket) compares
    // against CompositionRecord.name directly, so a RelatedWork's own name must stay unmodified here.
    // Automatic disambiguation is applied as a final pass, after ordering, once all lists are built.
    const toRelatedWork = (record: CompositionRecord): RelatedWork => ({
        id: record.id,
        name: record.name,
        href: nounHasPage.composition ? entityHref("composition", record.id) : null,
        composer: composerNames.get(record.composer_id) ?? ""
    })

    const worksById = new Map<number, CompositionRecord>()
    for (const record of works) worksById.set(record.id, record)

    const index = new Map<string, RelatedWork[]>()
    const push = (key: string, work: RelatedWork) => {
        const list = index.get(key)
        if (list) list.push(work)
        else index.set(key, [work])
    }

    // composer -> works: two full passes (not interleaved) so primary credits list before secondary.
    for (const record of works) {
        push(`composer:${record.composer_id}`, toRelatedWork(record))
    }
    for (const record of works) {
        for (const secondaryId of record.author_secondary) {
            if (secondaryId === record.composer_id) continue // already listed as a primary credit above
            push(`composer:${secondaryId}`, toRelatedWork(record))
        }
    }

    // composition -> related works (v1: same composer only, excludes itself; see header).
    for (const record of works) {
        for (const sibling of works) {
            if (sibling.id === record.id || sibling.composer_id !== record.composer_id) continue
            push(`composition:${record.id}`, toRelatedWork(sibling))
        }
    }

    // contributor -> works, across all three credit columns. Set dedupes a contributor id appearing
    // in more than one column on the same work.
    for (const record of works) {
        const contributorIds = new Set<number>([record.contrib_primary_1, ...record.contrib_addl])
        if (record.contrib_primary_2 !== null) contributorIds.add(record.contrib_primary_2)
        for (const contributorId of contributorIds) {
            push(`contributor:${contributorId}`, toRelatedWork(record))
        }
    }

    // Owner decision: each bucket varies its tile order differently rather than always leading with the
    // same first N (database-insertion order).
    //  - composer: seeded by the composer id, so the order is reproducible across rebuilds as long as
    //    that composer's related-works list is unchanged (a new/removed work naturally reshuffles it).
    //  - composition: exact-name matches (other parts/movements of the same piece — the same signal the
    //    composer_id+name+part unique index already keys on) lead, sorted alphabetically by `part` (the
    //    one field that actually differs between them — `name` is identical within this subgroup by
    //    definition); the remaining same-composer works are truly randomized, so they vary on every build.
    //  - contributor: truly randomized, so they vary on every build.
    for (const [key, list] of index) {
        const [noun, idStr] = key.split(":")
        if (noun === "composer") {
            index.set(key, seededShuffle(list, Number(idStr)))
        } else if (noun === "composition") {
            const record = works.find((w) => w.id === Number(idStr))
            const targetName = record?.name.trim()
            const exact = list
                .filter((work) => work.name.trim() === targetName)
                .sort((a, b) => (worksById.get(a.id)?.part ?? "").localeCompare(worksById.get(b.id)?.part ?? ""))
            const rest = list.filter((work) => work.name.trim() !== targetName)
            index.set(key, [...exact, ...randomShuffle(rest)])
        } else if (noun === "contributor") {
            index.set(key, randomShuffle(list))
        }
    }

    // Automatic disambiguation, applied last so it never disturbs the exact-name-match ordering above: a
    // tile's composer subtitle (catalog.tsx) can't tell two same-titled works by the same composer apart
    // — the compositions table's UNIQUE index is (composer_id, name, COALESCE(part,'')), so `part` is the
    // one field that does. Mirrors compositionNameCollisionKey/disambiguatedCompositionName
    // (lib/api/database.ts) for the admin works list; duplicated rather than imported so this build-time
    // module doesn't pull in the worker-only D1 access layer. A part-less work stays ambiguous — there is
    // nothing to disambiguate it WITH — even when its same-named sibling has its own part.
    const nameCollisionCounts = new Map<string, number>()
    for (const record of works) {
        const key = `${record.composer_id} ${record.name.trim().toLowerCase()}`
        nameCollisionCounts.set(key, (nameCollisionCounts.get(key) ?? 0) + 1)
    }
    for (const list of index.values()) {
        for (const work of list) {
            const record = worksById.get(work.id)
            if (!record) continue
            const key = `${record.composer_id} ${record.name.trim().toLowerCase()}`
            const hasCollision = (nameCollisionCounts.get(key) ?? 0) > 1
            if (hasCollision && record.part) work.name = `${record.name} (${record.part})`
        }
    }

    return index
}

/** Deterministic Fisher-Yates shuffle seeded by `seed` (mulberry32): the same seed and input list always
 *  produce the same order, so a composer's related-works tiles are stable across rebuilds unless the
 *  underlying list itself changes. */
function seededShuffle<T>(items: T[], seed: number): T[] {
    let state = seed >>> 0
    const next = () => {
        state = (state + 0x6d2b79f5) | 0
        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const result = items.slice()
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
}

/** Fisher-Yates shuffle with Math.random(): a fresh order on every call (every build), unlike {@link seededShuffle}. */
function randomShuffle<T>(items: T[]): T[] {
    const result = items.slice()
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
}

/** Resolves a single nullable foreign key to a display reference, or null when the key itself is null. */
function resolveRef(
    index: Map<number, ReferenceTarget>,
    id: number | null,
    noun: EntityNoun
): ResolvedReference | null {
    if (id === null) return null
    const target = index.get(id)
    if (!target) return { id, name: "", href: null } // unresolvable id — mirrors the prior "" fallback
    return { id, name: target.name, href: target.hasPage ? entityHref(noun, id) : null, role: target.role }
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
        // Derived, not a D1 column: primary/additional-primary/additional distinction is internal-only
        // (owner decision) — public pages bind this one combined list instead.
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
        citations: record.citations ?? {},
        entry_date: record.entry_date,
        change_date: record.change_date
    }
}

/**
 * Normalizes one noun's fetched D1 rows into {@link EntityRecord}s. `null` reader result (D1
 * unconfigured, or that table read skipped) contributes no records — same as "no records" either way.
 * Contributor records already flat, pass through as `entry` unchanged; composer records flat too but
 * gain one derived field (`life_span`, entity-fields.ts); composition records flattened and
 * reference-resolved via {@link flattenComposition}. `refs` (see {@link buildReferenceIndex}) only
 * consulted for the "composition" noun.
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
            return (contributors ?? []).map((record) => ({
                id: String(record.id),
                entry: record as unknown as Record<string, unknown>
            }))
        case "composition":
            return (compositions ?? []).map((record) => ({
                id: String(record.id),
                entry: flattenComposition(record, refs)
            }))
    }
}
