/**
 * lib/build/entity-slug.ts
 *
 * Derives a stable, content-only public slug for each composer/contributor/composition record
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

import type { EntityNoun } from "../compositor/entity-fields"
import { fetchAllContributors, fetchComposers, fetchCompositions } from "./d1-api"

/** id -> slug, per entity noun. */
export type EntitySlugIndex = Record<EntityNoun, Map<number, string>>

/**
 * Combining-mark stripper + lowercaser + whitespace remover
 */
function normalizeNamePart(raw: string): string {
    return raw
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, "")
}

/**
 * Calculates the residual from {@link normalizeNamePart} for collision avoidance
 */
function residual(raw: string): string {
    const marks: string[] = []
    let caseBits = ""
    for (const ch of raw.normalize("NFD")) {
        if (/[\u0300-\u036f]/.test(ch)) {
            marks.push(ch.codePointAt(0)!.toString(16))
            continue
        }
        if (/\s/.test(ch)) continue
        caseBits += ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? "1" : "0"
    }
    const wordLengths = raw
        .trim()
        .split(/\s+/)
        .map((word) => word.length)
    return `${marks.join(".")}|${caseBits}|${wordLengths.join("-")}`
}

/** ASCII-fold + hyphenate + truncate at word boundary */
function displayPrefix(raw: string): string {
    const folded = raw
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    if (folded.length <= 24) return folded
    const truncated = folded.slice(0, 24)
    const lastHyphen = truncated.lastIndexOf("-")
    return (lastHyphen > 0 ? truncated.slice(0, lastHyphen) : truncated).replace(/-+$/, "")
}

const FNV64_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV64_PRIME = 0x100000001b3n
const FNV64_MASK = 0xffffffffffffffffn

/**
 * FNV-1a 64-bit over the UTF-8 bytes of `input`, then a splitmix64 finalizer for avalanche
 *
 * Separate from the SQL statement's hasher used in SQLStatement.identifier() since this mechanism needs to be more stable and reliable
 */
function fnv1a64(input: string): bigint {
    let hash = FNV64_OFFSET_BASIS
    for (const byte of new TextEncoder().encode(input)) {
        hash ^= BigInt(byte)
        hash = (hash * FNV64_PRIME) & FNV64_MASK
    }
    // splitmix64 finalizer - mixes FNV's weak low bits before truncation
    hash ^= hash >> 30n
    hash = (hash * 0xbf58476d1ce4e5b9n) & FNV64_MASK
    hash ^= hash >> 27n
    hash = (hash * 0x94d049bb133111ebn) & FNV64_MASK
    hash ^= hash >> 31n
    return hash
}

/** Zero-padded decimal digest of `input`, `digits` long */
export function hashDigits(input: string, digits: number): string {
    const modulus = 10n ** BigInt(digits)
    return (fnv1a64(input) % modulus).toString().padStart(digits, "0")
}

/** Width of nouns (determines collision resistance, see birthday paradox) */
const DIGITS: Record<EntityNoun, number> = {
    contributor: 6,
    composer: 11,
    composition: 13
}

/** name + role -> natural key */
function composerNaturalKey(name: string, role: string): string {
    return `${normalizeNamePart(name)}${residual(name)}|${normalizeNamePart(role)}`
}

export interface SlugCandidate {
    id: number
    naturalKey: string
    display: string
}

/**
 * Resolves same-digit collisions within one noun deterministically
 */
export function resolveHashCollisions(candidates: SlugCandidate[], digits: number): Map<number, string> {
    const byDigits = new Map<string, SlugCandidate[]>()
    for (const candidate of candidates) {
        const digest = hashDigits(candidate.naturalKey, digits)
        const group = byDigits.get(digest)
        if (group) group.push(candidate)
        else byDigits.set(digest, [candidate])
    }

    const slugs = new Map<number, string>()
    for (const [digest, group] of byDigits) {
        if (group.length === 1) {
            slugs.set(group[0].id, `${group[0].display}-${digest}`)
            continue
        }
        const ordered = [...group].sort((a, b) => a.naturalKey.localeCompare(b.naturalKey))
        ordered.forEach((candidate, index) => {
            const suffix = index === 0 ? digest : `${digest}-${index + 1}`
            slugs.set(candidate.id, `${candidate.display}-${suffix}`)
        })
    }
    return slugs
}

/**
 * Builds every noun's id -> slug map from D1 records
 */
export function buildEntitySlugIndex(
    composers: ComposerRecord[] | null,
    allContributors: ContributorRecord[] | null,
    compositions: CompositionRecord[] | null
): EntitySlugIndex {
    const composerKeys = new Map<number, string>()
    const composerCandidates: SlugCandidate[] = []
    for (const record of composers ?? []) {
        const naturalKey = composerNaturalKey(record.name, record.role)
        composerKeys.set(record.id, naturalKey)
        composerCandidates.push({ id: record.id, naturalKey, display: displayPrefix(record.name) })
    }

    const contributorCandidates: SlugCandidate[] = (allContributors ?? []).map((record) => ({
        id: record.id,
        naturalKey: `${normalizeNamePart(record.name)}${residual(record.name)}`,
        display: displayPrefix(record.name)
    }))

    const compositionCandidates: SlugCandidate[] = (compositions ?? []).map((record) => {
        const composerKey = composerKeys.get(record.composer_id) ?? ""
        const part = record.part ?? ""
        const naturalKey =
            `${normalizeNamePart(record.name)}${residual(record.name)}` +
            `|${composerKey}|${normalizeNamePart(part)}${residual(part)}`
        return { id: record.id, naturalKey, display: displayPrefix(record.name) }
    })

    return {
        composer: resolveHashCollisions(composerCandidates, DIGITS.composer),
        contributor: resolveHashCollisions(contributorCandidates, DIGITS.contributor),
        composition: resolveHashCollisions(compositionCandidates, DIGITS.composition)
    }
}

/**
 * Build-time cache for {@link fetchEntitySlugIndex}
 */
let slugIndexCache: Promise<EntitySlugIndex> | null = null

/**
 * Fetches (and build-caches) the id -> slug index over the contributor set
 */
export function fetchEntitySlugIndex(): Promise<EntitySlugIndex> {
    if (!slugIndexCache) {
        slugIndexCache = Promise.all([fetchComposers(), fetchAllContributors(), fetchCompositions()]).then(
            ([composers, allContributors, compositions]) =>
                buildEntitySlugIndex(composers, allContributors, compositions)
        )
    }
    return slugIndexCache
}
