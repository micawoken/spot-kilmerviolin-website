/**
 * tests/build/entity-records.test.ts
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
import {
    buildReferenceIndex,
    buildRelatedWorksIndex,
    entityRecords,
    type EntityReferenceIndex
} from "../../src/lib/build/entity-records"
import type { EntityNoun } from "../../src/lib/compositor/entity-fields"

// Built via the real D1 converters (same fixture shape tests/build/d1-api.test.ts uses), not hand-authored
// record literals — the point is to exercise entityRecords against the actual shapes the readers produce.
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

const activeContributor: D1Contributor = {
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

const inactiveContributor: D1Contributor = {
    ...activeContributor,
    contributor_id: 3,
    name: "Retired Ray",
    active: 0
}

const hiddenContributor: D1Contributor = {
    ...activeContributor,
    contributor_id: 4,
    name: "Hidden Hank",
    tags: "hidden"
}

const composition: D1Composition = {
    composition_id: 10,
    name: "Concerto",
    composer_id: 1,
    contrib_primary_1: 2,
    contrib_primary_2: 3,
    contrib_addl: "3",
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

const ALL_PAGES: Record<EntityNoun, boolean> = { composer: true, composition: true, contributor: true }

describe("buildReferenceIndex", () => {
    it("resolves a composer/contributor by id to its name, with hasPage from the noun's page status", () => {
        const composerRecord = formatCompFromD1(composer)
        const contributorRecord = formatContribFromD1(activeContributor)
        const refs = buildReferenceIndex([composerRecord], [contributorRecord], ALL_PAGES)

        expect(refs.composer.get(1)).toEqual({ name: "Bach", hasPage: true })
        expect(refs.contributor.get(2)).toEqual({ name: "Ada", hasPage: true })
    })

    it("hasPage is false for a composer/contributor whose noun has no published default template", () => {
        const composerRecord = formatCompFromD1(composer)
        const refs = buildReferenceIndex([composerRecord], [], { ...ALL_PAGES, composer: false })
        expect(refs.composer.get(1)?.hasPage).toBe(false)
    })

    it("hasPage is true for an INACTIVE contributor when the noun has a template — active no longer gates page existence, only a `hidden` tag does", () => {
        const contributorRecord = formatContribFromD1(inactiveContributor)
        const refs = buildReferenceIndex([], [contributorRecord], ALL_PAGES)
        expect(refs.contributor.get(3)).toEqual({ name: "Retired Ray", hasPage: true })
    })

    it("REGRESSION GUARD: hasPage is false for a contributor tagged `hidden` even when the noun has a template", () => {
        const contributorRecord = formatContribFromD1(hiddenContributor)
        const refs = buildReferenceIndex([], [contributorRecord], ALL_PAGES)
        expect(refs.contributor.get(4)).toEqual({ name: "Hidden Hank", hasPage: false })
    })

    it("REGRESSION GUARD: resolves a hidden contributor's NAME at all — must be built from the unredacted all-contributors list, not fetchContributors' filtered public list", () => {
        // The whole point of buildReferenceIndex taking `allContributors`: a filtered-list caller would
        // never see contributor 4 in its input at all, and every reference to it would resolve blank.
        const refs = buildReferenceIndex([], [formatContribFromD1(hiddenContributor)], ALL_PAGES)
        expect(refs.contributor.get(4)?.name).toBe("Hidden Hank")
    })
})

describe("entityRecords — composer/contributor (bare records, pass through)", () => {
    const emptyRefs: EntityReferenceIndex = { composer: new Map(), contributor: new Map() }

    it("stringifies id and passes the record through as entry, plus the derived life_span field", () => {
        const record = formatCompFromD1(composer)
        expect(entityRecords("composer", [record], null, null, emptyRefs)).toEqual([
            { id: "1", entry: { ...record, life_span: "1685–1750" } }
        ])
    })

    it("renders a living composer's life_span with the Present sentinel", () => {
        const record = formatCompFromD1({ ...composer, death_year: -1 })
        const [result] = entityRecords("composer", [record], null, null, emptyRefs)
        expect(result.entry.life_span).toBe("1685–Present")
    })

    it("does the same for a contributor record, unchanged (no derived fields)", () => {
        const record = formatContribFromD1(activeContributor)
        expect(entityRecords("contributor", null, [record], null, emptyRefs)).toEqual([{ id: "2", entry: record }])
    })
})

describe("entityRecords — composition (the reference-fold linchpin)", () => {
    it("flattens rating/publication_info back to flat columns and resolves every foreign key", () => {
        const composerRecord = formatCompFromD1(composer)
        const activeRecord = formatContribFromD1(activeContributor)
        const hiddenRecord = formatContribFromD1(hiddenContributor)
        // References the HIDDEN contributor (id 4) — a local override, not the shared `composition`
        // fixture, which buildRelatedWorksIndex's tests below also depend on referencing contributor 3.
        const object = formatWorkFromD1({ ...composition, contrib_primary_2: 4, contrib_addl: "4" })
        const refs = buildReferenceIndex([composerRecord], [activeRecord, hiddenRecord], ALL_PAGES)

        const [result] = entityRecords("composition", null, null, [object], refs)

        expect(result.id).toBe("10")
        expect(result.entry.name).toBe("Concerto")
        expect(result.entry.rating_suzuki).toBe(8)
        expect(result.entry.rating_nyssma).toBeNull()
        expect(result.entry.publish_name).toBe("Pub")
        expect(result.entry.publish_location).toBe("Loc")
        expect(result.entry.publish_year).toBe(2000)
        expect(result.entry.publication_uri).toEqual({ uriType: "https", uri: "https://example.test/score" })

        expect(result.entry.composer).toEqual({ id: 1, name: "Bach", href: "/entity/composer/1" })
        expect(result.entry.contrib_primary_1).toEqual({ id: 2, name: "Ada", href: "/entity/contributor/2" })
        // REGRESSION GUARD: contrib_primary_2 references the HIDDEN contributor. Its name still
        // resolves (unredacted map), but href is null — a hidden contributor has no public page.
        expect(result.entry.contrib_primary_2).toEqual({ id: 4, name: "Hidden Hank", href: null })
        expect(result.entry.contrib_addl).toEqual([{ id: 4, name: "Hidden Hank", href: null }])
        expect(result.entry.author_secondary).toEqual([])
    })

    it("an unresolvable reference id resolves to an empty name and a null href, not a crash", () => {
        const object = formatWorkFromD1({ ...composition, composer_id: 999 })
        const refs = buildReferenceIndex([], [], ALL_PAGES)

        const [result] = entityRecords("composition", null, null, [object], refs)

        expect(result.entry.composer).toEqual({ id: 999, name: "", href: null })
    })

    it("a null optional reference (contrib_primary_2) resolves to null, not a reference object", () => {
        const object = formatWorkFromD1({ ...composition, contrib_primary_2: null })
        const refs = buildReferenceIndex([], [], ALL_PAGES)

        const [result] = entityRecords("composition", null, null, [object], refs)

        expect(result.entry.contrib_primary_2).toBeNull()
    })

    it("a reference to a real record resolves to no href when that noun has no published default template", () => {
        const composerRecord = formatCompFromD1(composer)
        const object = formatWorkFromD1(composition)
        const refs = buildReferenceIndex([composerRecord], [], { ...ALL_PAGES, composer: false })

        const [result] = entityRecords("composition", null, null, [object], refs)

        expect(result.entry.composer).toEqual({ id: 1, name: "Bach", href: null })
    })
})

describe("entityRecords — the reader-returned-null case (D1 unconfigured, or that table skipped)", () => {
    const emptyRefs: EntityReferenceIndex = { composer: new Map(), contributor: new Map() }

    it("contributes no records for any of the three nouns, matching the dual-source-dependency skip rule", () => {
        expect(entityRecords("composer", null, null, null, emptyRefs)).toEqual([])
        expect(entityRecords("contributor", null, null, null, emptyRefs)).toEqual([])
        expect(entityRecords("composition", null, null, null, emptyRefs)).toEqual([])
    })
})

describe("buildRelatedWorksIndex — RelatedEntries' data source (docs/dev/miscellaneous.txt \"related-entries tiles\")", () => {
    const bach: D1Composer = { ...composer, composer_id: 1, name: "Bach" }
    const mozart: D1Composer = { ...composer, composer_id: 4, name: "Mozart" }

    // work1/work2: both primary-credited to Bach. work3: primary-credited to Mozart, with Bach as a
    // secondary author — the case that exercises the composer index's two-pass (primary-before-secondary)
    // ordering.
    const work1: D1Composition = { ...composition, composition_id: 10, name: "Work One", composer_id: 1 }
    const work2: D1Composition = {
        ...composition,
        composition_id: 11,
        name: "Work Two",
        composer_id: 1,
        contrib_primary_2: null,
        contrib_addl: ""
    }
    const work3: D1Composition = {
        ...composition,
        composition_id: 12,
        name: "Work Three",
        composer_id: 4,
        contrib_primary_1: 5,
        contrib_primary_2: null,
        contrib_addl: "2",
        author_secondary: "1"
    }

    const composers = [formatCompFromD1(bach), formatCompFromD1(mozart)]
    const works = [formatWorkFromD1(work1), formatWorkFromD1(work2), formatWorkFromD1(work3)]
    const index = buildRelatedWorksIndex(composers, works, ALL_PAGES)

    it("composer -> works: lists primary credits before secondary-author credits", () => {
        expect(index.get("composer:1")).toEqual([
            { id: 10, name: "Work One", href: "/entity/work/10", composer: "Bach" },
            { id: 11, name: "Work Two", href: "/entity/work/11", composer: "Bach" },
            { id: 12, name: "Work Three", href: "/entity/work/12", composer: "Mozart" }
        ])
    })

    it("composer -> works: a composer with only primary credits gets no secondary-pass duplicates", () => {
        expect(index.get("composer:4")).toEqual([
            { id: 12, name: "Work Three", href: "/entity/work/12", composer: "Mozart" }
        ])
    })

    it("composition -> related works: other works by the same composer, excluding itself", () => {
        expect(index.get("composition:10")).toEqual([
            { id: 11, name: "Work Two", href: "/entity/work/11", composer: "Bach" }
        ])
        expect(index.get("composition:11")).toEqual([
            { id: 10, name: "Work One", href: "/entity/work/10", composer: "Bach" }
        ])
    })

    it("composition -> related works: no entry (not even an empty array) when no sibling exists", () => {
        expect(index.get("composition:12")).toBeUndefined()
    })

    it("contributor -> works: matches across contrib_primary_1, contrib_primary_2, and contrib_addl", () => {
        // contributor 2: contrib_primary_1 on work1 and work2, contrib_addl on work3.
        expect(index.get("contributor:2")).toEqual([
            { id: 10, name: "Work One", href: "/entity/work/10", composer: "Bach" },
            { id: 11, name: "Work Two", href: "/entity/work/11", composer: "Bach" },
            { id: 12, name: "Work Three", href: "/entity/work/12", composer: "Mozart" }
        ])
        // contributor 3: contrib_primary_2 AND contrib_addl on work1 alone — deduped to one entry.
        expect(index.get("contributor:3")).toEqual([
            { id: 10, name: "Work One", href: "/entity/work/10", composer: "Bach" }
        ])
        // contributor 5: contrib_primary_1 on work3 only.
        expect(index.get("contributor:5")).toEqual([
            { id: 12, name: "Work Three", href: "/entity/work/12", composer: "Mozart" }
        ])
    })

    it("hrefs are null when compositions have no published default template this build", () => {
        const noCompositionPage = buildRelatedWorksIndex(composers, works, { ...ALL_PAGES, composition: false })
        expect(noCompositionPage.get("composer:1")?.every((work) => work.href === null)).toBe(true)
    })

    it("an empty composers/compositions input yields an empty index", () => {
        expect(buildRelatedWorksIndex(null, null, ALL_PAGES).size).toBe(0)
    })
})
