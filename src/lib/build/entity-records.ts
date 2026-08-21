/**
 * lib/build/entity-records.ts
 *
 * Normalizes the three D1 readers' (d1-api.ts) return shapes into one uniform, flat record
 *
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

import { isSentinelComposerName } from "../api/composer_sentinel"
import { entityHref } from "../compositor/composition-fields"
import type { EntityNoun } from "../compositor/entity-fields"
import { formatLifespan } from "../../scripts/format"
import { isHiddenContributor } from "./d1-schema"
import type { EntitySlugIndex } from "./entity-slug"

/** One entity record, normalized to a flat `entry` every noun's render/listing reads uniformly. */
export interface EntityRecord {
    /** stringified - Astro static route params are always strings */
    id: string
    /** content-derived, stable public route param used in place of id */
    slug: string
    entry: Record<string, unknown>
}

/** A resolved foreign-key reference, as it appears on a normalized composition's `entry`. */
export interface ResolvedReference {
    id: number
    name: string
    /** null when the target has no public page */
    href: string | null
    /** the composer's `role` (e.g. "arranger"), carried through only for composer references */
    role?: string
}

/** One tile in the `RelatedEntries` Puck block (catalog.tsx) */
export interface RelatedWork {
    id: number
    name: string
    /** null when compositions have no published default template this build - see {@link ResolvedReference}. */
    href: string | null
    /** the work's composer display name, for the tile's subtitle; "" when unresolved. */
    composer: string
}

/** name + resolved public href; `role` is only set for composer targets (see {@link ResolvedReference}) */
interface ReferenceTarget {
    name: string
    href: string | null
    role?: string
}

/** id -> {name, href} for each of the two referenceable nouns (composer, contributor). */
export interface EntityReferenceIndex {
    composer: Map<number, ReferenceTarget>
    contributor: Map<number, ReferenceTarget>
}

/**
 * Builds the reference index a composition's foreign keys resolve against
 */
export function buildReferenceIndex(
    composers: ComposerRecord[] | null,
    allContributors: ContributorRecord[] | null,
    nounHasPage: Record<EntityNoun, boolean>,
    slugIndex: EntitySlugIndex
): EntityReferenceIndex {
    const composer = new Map<number, ReferenceTarget>()
    for (const record of composers ?? []) {
        const slug = slugIndex.composer.get(record.id)
        composer.set(record.id, {
            name: record.name,
            href: nounHasPage.composer && slug ? entityHref("composer", slug) : null,
            role: record.role
        })
    }

    const contributor = new Map<number, ReferenceTarget>()
    for (const record of allContributors ?? []) {
        const slug = slugIndex.contributor.get(record.id)
        const hasPage = nounHasPage.contributor && !isHiddenContributor(record)
        contributor.set(record.id, {
            name: record.name,
            href: hasPage && slug ? entityHref("contributor", slug) : null
        })
    }

    return { composer, contributor }
}

// Hosts that are encyclopedic/database entries, not a shared publication
const ENCYCLOPEDIC_HOSTS = ["wikipedia.org", "imslp.org"]

function isEncyclopedicHost(url: string): boolean {
    let host: string
    try {
        host = new URL(url).hostname.toLowerCase()
    } catch {
        return false
    }
    return ENCYCLOPEDIC_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

/**
 * A composition's normalized "same publication" identity, or null when it declares no isbn/doi/https
 * source, or an https source on an encyclopedic/database host
 */
function publicationKey(record: CompositionRecord): string | null {
    const { uri_type, uri } = record.publication_info
    if (uri_type !== "isbn" && uri_type !== "doi" && uri_type !== "https") return null
    const trimmed = uri?.trim()
    if (!trimmed) return null
    if (uri_type === "https" && isEncyclopedicHost(trimmed)) return null
    const normalized = uri_type === "isbn" ? trimmed.replace(/[\s-]/g, "") : trimmed
    return `${uri_type}:${normalized.toLowerCase()}`
}

/**
 * Builds the id -> related-works lists the `RelatedEntries` Puck block (catalog.tsx) renders as tiles
 */
export function buildRelatedWorksIndex(
    composers: ComposerRecord[] | null,
    compositions: CompositionRecord[] | null,
    nounHasPage: Record<EntityNoun, boolean>,
    slugIndex: EntitySlugIndex
): Map<string, RelatedWork[]> {
    const composerNames = new Map<number, string>()
    for (const record of composers ?? []) composerNames.set(record.id, record.name)

    // Unknown/Traditional composer ids are shared by many unrelated real works, so equal composerId
    // there doesn't imply "same real composer" - movement clustering must not trust it (see groupMovements).
    const sentinelComposerIds = new Set<number>()
    for (const record of composers ?? []) if (isSentinelComposerName(record.name)) sentinelComposerIds.add(record.id)

    const works = compositions ?? []
    const toRelatedWork = (record: CompositionRecord): RelatedWork => {
        const slug = slugIndex.composition.get(record.id)
        return {
            id: record.id,
            name: record.name,
            href: nounHasPage.composition && slug ? entityHref("composition", slug) : null,
            composer: composerNames.get(record.composer_id) ?? ""
        }
    }

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

    // composition -> related works (v1: same composer, plus same-publication; excludes itself; see header).
    for (const record of works) {
        for (const sibling of works) {
            if (sibling.id === record.id || sibling.composer_id !== record.composer_id) continue
            push(`composition:${record.id}`, toRelatedWork(sibling))
        }
    }
    // composition -> same-publication works (isbn/doi/https source, excluding encyclopedic/database hosts)
    for (const record of works) {
        const key = publicationKey(record)
        if (key === null) continue
        for (const sibling of works) {
            if (sibling.id === record.id || sibling.composer_id === record.composer_id) continue
            if (publicationKey(sibling) !== key) continue
            push(`composition:${record.id}`, toRelatedWork(sibling))
        }
    }

    // contributor -> works, across all three credit columns
    for (const record of works) {
        const contributorIds = new Set<number>([record.contrib_primary_1, ...record.contrib_addl])
        if (record.contrib_primary_2 !== null) contributorIds.add(record.contrib_primary_2)
        for (const contributorId of contributorIds) {
            push(`contributor:${contributorId}`, toRelatedWork(record))
        }
    }

    for (const [key, list] of index) {
        const [noun, idStr] = key.split(":")
        if (noun === "composer") {
            index.set(key, seededShuffle(groupMovements(list, worksById, sentinelComposerIds), Number(idStr)).flat())
        } else if (noun === "composition") {
            const record = works.find((w) => w.id === Number(idStr))
            const targetName = record?.name.trim()
            const sameComposer = list.filter((work) => worksById.get(work.id)?.composer_id === record?.composer_id)
            const otherPublication = list.filter((work) => worksById.get(work.id)?.composer_id !== record?.composer_id)
            const exact = sameComposer
                .filter((work) => work.name.trim() === targetName)
                .sort((a, b) => (worksById.get(a.id)?.part ?? "").localeCompare(worksById.get(b.id)?.part ?? ""))
            const rest = sameComposer.filter((work) => work.name.trim() !== targetName)
            index.set(key, [
                ...exact,
                ...randomShuffle(groupMovements(rest, worksById, sentinelComposerIds)).flat(),
                ...randomShuffle(groupMovements(otherPublication, worksById, sentinelComposerIds)).flat()
            ])
        } else if (noun === "contributor") {
            index.set(key, randomShuffle(groupMovements(list, worksById, sentinelComposerIds)).flat())
        }
    }

    // Automatic disambiguation, applied last so it never disturbs the exact-name-match ordering above
    const disambiguatedNames = disambiguatedCompositionNames(works)
    for (const list of index.values()) {
        for (const work of list) {
            work.name = disambiguatedNames.get(work.id) ?? work.name
        }
    }

    return index
}

/**
 * id -> display name, with `part` appended in parentheses
 */
export function disambiguatedCompositionNames(compositions: CompositionRecord[] | null): Map<number, string> {
    const works = compositions ?? []
    const collisionCounts = new Map<string, number>()
    for (const record of works) {
        const key = `${record.composer_id} ${record.name.trim().toLowerCase()}`
        collisionCounts.set(key, (collisionCounts.get(key) ?? 0) + 1)
    }

    const names = new Map<number, string>()
    for (const record of works) {
        const key = `${record.composer_id} ${record.name.trim().toLowerCase()}`
        const hasCollision = (collisionCounts.get(key) ?? 0) > 1
        names.set(record.id, hasCollision && record.part ? `${record.name} (${record.part})` : record.name)
    }
    return names
}

/** Deterministic Fisher-Yates shuffle seeded by `seed` (mulberry32) */
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

const MOVEMENT_MARKER =
    /(?:[,;:\-–—]\s*|\b(?:mvt|mov(?:t|ement)?)\.?\s+)(?:(?:mvt|mov(?:t|ement)?)\.?\s*)?(?<num>[ivxlcdm]+|\d+)(?:[.:)]|\s|$)/gi

// Lower-priority fallback: "Op. #, No. #" (the "Op. #," part is optional; "No."/"Nos." is fuzzy-matched)
const OPUS_NO_MARKER =
    /(?:[,;:\-–—]\s*)?(?:\bop\.?\s*(?<opus>\d+)\s*,?\s*)?\bno(?:s)?\b\.?\s*(?<num>[ivxlcdm]+|\d+)(?:[.:)]|\s|$)/gi

function matchLastMarker(name: string, pattern: RegExp): { base: string; number: number; opus: number | null } | null {
    const matches = [...name.matchAll(pattern)]
    if (matches.length === 0) return null
    const match = matches[matches.length - 1]
    const base = name.slice(0, match.index).trim()
    if (!base) return null
    const number = romanOrArabicToNumber(match.groups!.num)
    if (number === null) return null
    const opusRaw = match.groups!.opus
    return { base, number, opus: opusRaw ? Number(opusRaw) : null }
}

/** Splits a work name at its movement marker, preferring the movement marker over opus */
function splitMovementMarker(
    name: string
): { base: string; number: number; fuzzy: boolean; opus: number | null } | null {
    const primary = matchLastMarker(name, MOVEMENT_MARKER)
    if (primary) return { ...primary, fuzzy: false }
    const secondary = matchLastMarker(name, OPUS_NO_MARKER)
    return secondary ? { ...secondary, fuzzy: true } : null
}

const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }

/** Parses a movement-marker numeral token as an arabic number or a roman numeral. Returns null for
 *  neither - defensive; {@link MOVEMENT_MARKER} should never actually capture one. */
function romanOrArabicToNumber(token: string): number | null {
    if (/^\d+$/.test(token)) return Number(token)
    let total = 0
    const letters = token.toLowerCase().split("")
    for (let i = 0; i < letters.length; i++) {
        const value = ROMAN_VALUES[letters[i]]
        if (value === undefined) return null
        const next = ROMAN_VALUES[letters[i + 1]]
        total += next !== undefined && value < next ? -value : value
    }
    return total > 0 ? total : null
}

// middle-ground config
const PARTIAL_MATCH_PERCENT = 0.5
const PARTIAL_MATCH_MIN_CHARS = 12

/**
 * Whether two base titles (see {@link splitMovementMarker}) share enough of a common prefix OR
 * suffix, case-insensitive, to count as movements of the same work
 */
function baseTitlesMatch(a: string, b: string, bothFuzzy: boolean): boolean {
    const x = a.toLowerCase()
    const y = b.toLowerCase()
    const shorterLen = Math.min(x.length, y.length)
    if (shorterLen === 0) return false
    let prefixLen = 0
    while (prefixLen < shorterLen && x[prefixLen] === y[prefixLen]) prefixLen++
    let suffixLen = 0
    while (suffixLen < shorterLen && x[x.length - 1 - suffixLen] === y[y.length - 1 - suffixLen]) suffixLen++
    const sharedLen = Math.max(prefixLen, suffixLen)
    if (sharedLen / shorterLen < PARTIAL_MATCH_PERCENT) return false
    if (sharedLen >= PARTIAL_MATCH_MIN_CHARS) return true
    return bothFuzzy && x === y
}

/**
 * Groups a related-works list into shuffle units
 *
 */
function groupMovements(
    list: RelatedWork[],
    worksById: Map<number, CompositionRecord>,
    sentinelComposerIds: Set<number>
): RelatedWork[][] {
    interface Candidate {
        work: RelatedWork
        composerId: number
        base: string
        movementNumber: number
        fuzzy: boolean
        opus: number | null
    }
    const candidates: Candidate[] = []
    const units: RelatedWork[][] = []

    for (const work of list) {
        const record = worksById.get(work.id)
        const split = record && splitMovementMarker(record.name)
        if (record && split)
            candidates.push({
                work,
                composerId: record.composer_id,
                base: split.base,
                movementNumber: split.number,
                fuzzy: split.fuzzy,
                opus: split.opus
            })
        else units.push([work])
    }

    const clusters: Candidate[][] = []
    for (const candidate of candidates) {
        const cluster = clusters.find((c) => {
            if (c[0].composerId !== candidate.composerId) return false
            const bothFuzzy = c[0].fuzzy && candidate.fuzzy
            // Two "No. #" works only belong to the same published set when their opus numbers agree
            // (or neither names one)
            if (bothFuzzy && c[0].opus !== candidate.opus) return false
            // A shared Unknown/Traditional id doesn't mean "same real composer"
            const waiveFloor = bothFuzzy && !sentinelComposerIds.has(candidate.composerId)
            return baseTitlesMatch(c[0].base, candidate.base, waiveFloor)
        })
        if (cluster) cluster.push(candidate)
        else clusters.push([candidate])
    }
    for (const cluster of clusters) {
        cluster.sort((a, b) => a.movementNumber - b.movementNumber)
        // The fuzzy "No. #" fallback only forms a group when the numbers actually vary
        const isStaleFuzzyCluster =
            cluster.every((c) => c.fuzzy) && new Set(cluster.map((c) => c.movementNumber)).size < 2
        if (isStaleFuzzyCluster) for (const c of cluster) units.push([c.work])
        else units.push(cluster.map((c) => c.work))
    }

    return units
}

/**
 * Resolves a single nullable foreign key to a display reference, or null when the key itself is null
 */
function resolveRef(index: Map<number, ReferenceTarget>, id: number | null): ResolvedReference | null {
    if (id === null) return null
    const target = index.get(id)
    if (!target) return { id, name: "", href: null } // unresolvable id - mirrors the prior "" fallback
    return { id, name: target.name, href: target.href, role: target.role }
}

/**
 * Resolves a list of foreign keys, preserving order and length (an unresolvable id still gets an entry).
 */
function resolveRefList(index: Map<number, ReferenceTarget>, ids: number[]): ResolvedReference[] {
    return ids.map((id) => resolveRef(index, id) as ResolvedReference)
}

/**
 * Flattens one CompositionRecord (nested `rating`/`publication_info`) into a normalized flat entry.
 */
function flattenComposition(record: CompositionRecord, refs: EntityReferenceIndex): Record<string, unknown> {
    const contrib_primary_1 = resolveRef(refs.contributor, record.contrib_primary_1)
    const contrib_primary_2 = resolveRef(refs.contributor, record.contrib_primary_2)
    const contrib_addl = resolveRefList(refs.contributor, record.contrib_addl)
    return {
        id: record.id,
        name: record.name,
        type: record.type,
        part: record.part,
        image: record.image,
        composer: resolveRef(refs.composer, record.composer_id),
        author_secondary: resolveRefList(refs.composer, record.author_secondary),
        contrib_primary_1,
        contrib_primary_2,
        contrib_addl,
        // Derived, not a D1 column: primary/additional-primary/additional distinction is internal-only
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
 * Normalizes one noun's fetched D1 rows into {@link EntityRecord}s
 */
export function entityRecords(
    noun: EntityNoun,
    composers: ComposerRecord[] | null,
    contributors: ContributorRecord[] | null,
    compositions: CompositionRecord[] | null,
    refs: EntityReferenceIndex,
    slugIndex: EntitySlugIndex
): EntityRecord[] {
    switch (noun) {
        case "composer":
            // life_span (entity-fields.ts) is derived, not a D1 column; sentinel composers
            // are auto-nulled
            return (composers ?? []).map((record) => ({
                id: String(record.id),
                slug: slugIndex.composer.get(record.id) ?? String(record.id),
                entry: {
                    ...record,
                    life_span:
                        typeof record.birth_year === "number" && typeof record.death_year === "number"
                            ? formatLifespan(record.birth_year, record.death_year)
                            : undefined
                } as unknown as Record<string, unknown>
            }))
        case "contributor":
            return (contributors ?? []).map((record) => ({
                id: String(record.id),
                slug: slugIndex.contributor.get(record.id) ?? String(record.id),
                entry: record as unknown as Record<string, unknown>
            }))
        case "composition":
            return (compositions ?? []).map((record) => ({
                id: String(record.id),
                slug: slugIndex.composition.get(record.id) ?? String(record.id),
                entry: flattenComposition(record, refs)
            }))
    }
}
