/**
 * tests/build/entity-slug.test.ts
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

import { describe, expect, it } from "vitest"

import { formatCompFromD1, formatContribFromD1, formatWorkFromD1 } from "../../src/lib/api/common"
import { buildEntitySlugIndex, hashDigits, resolveHashCollisions, type SlugCandidate } from "../../src/lib/build/entity-slug"

// Same base fixtures as entity-records.test.ts, not shared across files by design (each test file's
// fixtures should read standalone).
const composer: D1Composer = {
    composer_id: 1,
    name: "Bach",
    role: "composer",
    birth_year: 1685,
    death_year: 1750,
    country: "DE",
    bio: "",
    image: null,
    tags: "",
    citations: "",
    entry_date: 1767225600000,
    change_date: 1767225600000
}

const contributor: D1Contributor = {
    contributor_id: 2,
    name: "Ada",
    class_year: null,
    major: null,
    phases: null,
    bio: null,
    public_email: null,
    identity_email: "ada@example.test",
    active: 1,
    roles: "",
    admin: 0,
    image: null,
    tags: "",
    entry_date: 1767225600000,
    change_date: 1767225600000
}

const composition: D1Composition = {
    composition_id: 10,
    name: "Concerto",
    composer_id: 1,
    contrib_primary_1: 2,
    contrib_primary_2: null,
    contrib_addl: "",
    author_secondary: "",
    type: "Chamber",
    part: null,
    rating_suzuki: 8,
    rating_nyssma: null,
    publish_location: "Loc",
    publish_name: "Pub",
    publish_year: 2000,
    uri_type: "https",
    uri: "https://example.test/score",
    key: null,
    range: null,
    position_highest: null,
    notes_pedagogical: null,
    notes_historical: null,
    notes_other: null,
    image: null,
    phases: "",
    entry_date: 1767225600000,
    tags: "",
    citations: "",
    change_date: 1767225600000
}

describe("buildEntitySlugIndex - order independence (the whole point)", () => {
    it("produces identical slugs regardless of row order or which numeric ids were assigned", () => {
        const original = [
            { ...composer, composer_id: 1, name: "Bach" },
            { ...composer, composer_id: 2, name: "Mozart" },
            { ...composer, composer_id: 3, name: "Haydn" }
        ].map(formatCompFromD1)

        // Simulates a reimport: different row order AND different assigned PKs
        const reimported = [
            { ...composer, composer_id: 20, name: "Haydn" },
            { ...composer, composer_id: 30, name: "Bach" },
            { ...composer, composer_id: 10, name: "Mozart" }
        ].map(formatCompFromD1)

        const originalIndex = buildEntitySlugIndex(original, [], [])
        const reimportedIndex = buildEntitySlugIndex(reimported, [], [])

        const slugByName = (records: ComposerRecord[], index: ReturnType<typeof buildEntitySlugIndex>, name: string) => {
            const record = records.find((r) => r.name === name)!
            return index.composer.get(record.id)
        }

        for (const name of ["Bach", "Mozart", "Haydn"]) {
            expect(slugByName(original, originalIndex, name)).toBe(slugByName(reimported, reimportedIndex, name))
        }
    })

    it("the same content always yields the same slug regardless of which id it lands on", () => {
        const first = buildEntitySlugIndex([formatCompFromD1({ ...composer, composer_id: 1, name: "Bach" })], [], [])
        const second = buildEntitySlugIndex([formatCompFromD1({ ...composer, composer_id: 99, name: "Bach" })], [], [])
        expect(first.composer.get(1)).toBe(second.composer.get(99))
    })
})

describe("buildEntitySlugIndex - residual disambiguation (accent/case/whitespace)", () => {
    it("gives distinct slugs to names that normalize identically but differ in accent", () => {
        const index = buildEntitySlugIndex(
            [
                { ...composer, composer_id: 1, name: "Renée" },
                { ...composer, composer_id: 2, name: "Renee" }
            ].map(formatCompFromD1),
            [],
            []
        )
        expect(index.composer.get(1)).not.toBe(index.composer.get(2))
    })

    it("gives distinct slugs to names that normalize identically but differ only in case", () => {
        const index = buildEntitySlugIndex(
            [
                { ...composer, composer_id: 1, name: "de la Fontaine" },
                { ...composer, composer_id: 2, name: "De La Fontaine" }
            ].map(formatCompFromD1),
            [],
            []
        )
        expect(index.composer.get(1)).not.toBe(index.composer.get(2))
    })

    it("gives distinct slugs to names that normalize identically but differ only in whitespace layout", () => {
        const index = buildEntitySlugIndex(
            [
                { ...composer, composer_id: 1, name: "A B" },
                { ...composer, composer_id: 2, name: "AB" }
            ].map(formatCompFromD1),
            [],
            []
        )
        expect(index.composer.get(1)).not.toBe(index.composer.get(2))
    })
})

describe("buildEntitySlugIndex - composition chains through the composer's natural key, not composer_id", () => {
    it("a composition's slug changes when its composer's name changes", () => {
        const work = formatWorkFromD1({ ...composition, composition_id: 10, composer_id: 1 })
        const before = buildEntitySlugIndex(
            [formatCompFromD1({ ...composer, composer_id: 1, name: "Bach" })],
            [],
            [work]
        )
        const after = buildEntitySlugIndex(
            [formatCompFromD1({ ...composer, composer_id: 1, name: "Johann Sebastian Bach" })],
            [],
            [work]
        )
        expect(before.composition.get(10)).not.toBe(after.composition.get(10))
    })

    it("a composition's slug does NOT change when only the composer's numeric id changes", () => {
        const before = buildEntitySlugIndex(
            [formatCompFromD1({ ...composer, composer_id: 1, name: "Bach" })],
            [],
            [formatWorkFromD1({ ...composition, composition_id: 10, composer_id: 1 })]
        )
        const after = buildEntitySlugIndex(
            [formatCompFromD1({ ...composer, composer_id: 999, name: "Bach" })],
            [],
            [formatWorkFromD1({ ...composition, composition_id: 500, composer_id: 999 })]
        )
        expect(before.composition.get(10)).toBe(after.composition.get(500))
    })
})

describe("buildEntitySlugIndex - digit widths", () => {
    it("uses 6 digits for contributors, 11 for composers, 13 for compositions", () => {
        const composerRecord = formatCompFromD1(composer)
        const contributorRecord = formatContribFromD1(contributor)
        const workRecord = formatWorkFromD1(composition)
        const index = buildEntitySlugIndex([composerRecord], [contributorRecord], [workRecord])

        const digitsOf = (slug: string) => slug.split("-").pop()!
        expect(digitsOf(index.contributor.get(contributorRecord.id)!)).toMatch(/^\d{6}$/)
        expect(digitsOf(index.composer.get(composerRecord.id)!)).toMatch(/^\d{11}$/)
        expect(digitsOf(index.composition.get(workRecord.id)!)).toMatch(/^\d{13}$/)
    })
})

describe("resolveHashCollisions - the deterministic backstop for two different natural keys hashing alike", () => {
    // At production digit widths (6-13), forcing a real collision would need ~sqrt(10^digits) fixtures.
    // digits=1 (a 10-slot space) makes a collision certain by pigeonhole with 15 distinct candidates,
    // and exercises the exact same grouping/suffixing code resolveHashCollisions uses at any width.
    function manyCandidates(count: number): SlugCandidate[] {
        return Array.from({ length: count }, (_, i) => ({
            id: i,
            naturalKey: `candidate-${i}`,
            display: `candidate-${i}`
        }))
    }

    it("assigns the bare digest to the natural-key-first colliding candidate, and -2/-3/... to the rest, in natural-key order", () => {
        const candidates = manyCandidates(15)
        const slugs = resolveHashCollisions(candidates, 1)

        // Group candidates by their raw 1-digit digest to find an actual colliding bucket
        const byDigest = new Map<string, SlugCandidate[]>()
        for (const candidate of candidates) {
            const digest = hashDigits(candidate.naturalKey, 1)
            const group = byDigest.get(digest) ?? []
            group.push(candidate)
            byDigest.set(digest, group)
        }
        const collidingGroup = [...byDigest.values()].find((group) => group.length > 1)
        expect(collidingGroup).toBeDefined()

        const ordered = [...collidingGroup!].sort((a, b) => a.naturalKey.localeCompare(b.naturalKey))
        const digest = hashDigits(ordered[0].naturalKey, 1)
        expect(slugs.get(ordered[0].id)).toBe(`${ordered[0].display}-${digest}`)
        ordered.slice(1).forEach((candidate, index) => {
            expect(slugs.get(candidate.id)).toBe(`${candidate.display}-${digest}-${index + 2}`)
        })
    })

    it("resolves to the identical id -> slug mapping regardless of candidate array order", () => {
        const candidates = manyCandidates(15)
        const forward = resolveHashCollisions(candidates, 1)
        const reversed = resolveHashCollisions([...candidates].reverse(), 1)
        expect(reversed).toEqual(forward)
    })
})

describe("buildEntitySlugIndex - null and edge tolerance", () => {
    it("yields empty maps, not a crash, when every fetch returns null (build API unconfigured)", () => {
        const index = buildEntitySlugIndex(null, null, null)
        expect(index.composer.size).toBe(0)
        expect(index.contributor.size).toBe(0)
        expect(index.composition.size).toBe(0)
    })

    it("a composition with part: null slugs the same as one with part: \"\" (built separately, so the two don't collide as literal duplicates)", () => {
        const composerRecord = formatCompFromD1(composer)
        const withNullPart = buildEntitySlugIndex(
            [composerRecord],
            [],
            [formatWorkFromD1({ ...composition, composition_id: 10, part: null })]
        )
        const withEmptyPart = buildEntitySlugIndex(
            [composerRecord],
            [],
            [formatWorkFromD1({ ...composition, composition_id: 10, part: "" })]
        )
        expect(withNullPart.composition.get(10)).toBe(withEmptyPart.composition.get(10))
    })

    it("a name that folds to an empty display prefix (all non-ASCII) still produces a valid, digit-suffixed slug", () => {
        const index = buildEntitySlugIndex([formatCompFromD1({ ...composer, name: "谷" })], [], [])
        const slug = index.composer.get(1)
        expect(slug).toBeDefined()
        expect(slug).toMatch(/\d{11}$/)
    })
})

describe("buildEntitySlugIndex - sentinel composers", () => {
    it("'Unknown' and 'Traditional' produce stable slugs despite their build-time nulled birth/death/country", () => {
        const unknown = { ...formatCompFromD1({ ...composer, composer_id: 1, name: "Unknown" }), birth_year: null, death_year: null, country: null }
        const traditional = {
            ...formatCompFromD1({ ...composer, composer_id: 2, name: "Traditional" }),
            birth_year: null,
            death_year: null,
            country: null
        }
        const records = [unknown, traditional] as unknown as ComposerRecord[]

        const first = buildEntitySlugIndex(records, [], [])
        const second = buildEntitySlugIndex(records, [], [])

        expect(first.composer.get(1)).toBe(second.composer.get(1))
        expect(first.composer.get(2)).toBe(second.composer.get(2))
        expect(first.composer.get(1)).not.toBe(first.composer.get(2))
    })
})
