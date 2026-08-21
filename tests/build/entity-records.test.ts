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
import { buildEntitySlugIndex, type EntitySlugIndex } from "../../src/lib/build/entity-slug"
import { entityHref } from "../../src/lib/compositor/composition-fields"
import type { EntityNoun } from "../../src/lib/compositor/entity-fields"

// Built via the real D1 converters (same fixture shape tests/build/d1-api.test.ts uses), not hand-authored
// record literals - the point is to exercise entityRecords against the actual shapes the readers produce.
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

/** Shorthand for entityHref against a slug this index actually resolved - fails loudly (via `!`) if not. */
function hrefIn(slugIndex: EntitySlugIndex, noun: EntityNoun, id: number): string {
    return entityHref(noun, slugIndex[noun].get(id)!)
}

describe("buildReferenceIndex", () => {
    it("resolves a composer/contributor by id to its name, with a public href when the noun has a template", () => {
        const composerRecord = formatCompFromD1(composer)
        const contributorRecord = formatContribFromD1(activeContributor)
        const slugIndex = buildEntitySlugIndex([composerRecord], [contributorRecord], [])
        const refs = buildReferenceIndex([composerRecord], [contributorRecord], ALL_PAGES, slugIndex)

        expect(refs.composer.get(1)).toEqual({
            name: "Bach",
            href: hrefIn(slugIndex, "composer", 1),
            role: "composer"
        })
        expect(refs.contributor.get(2)).toEqual({ name: "Ada", href: hrefIn(slugIndex, "contributor", 2) })
    })

    it("href is null for a composer/contributor whose noun has no published default template", () => {
        const composerRecord = formatCompFromD1(composer)
        const slugIndex = buildEntitySlugIndex([composerRecord], [], [])
        const refs = buildReferenceIndex([composerRecord], [], { ...ALL_PAGES, composer: false }, slugIndex)
        expect(refs.composer.get(1)?.href).toBeNull()
    })

    it("resolves an INACTIVE contributor to a public href when the noun has a template - active no longer gates page existence, only a `hidden` tag does", () => {
        const contributorRecord = formatContribFromD1(inactiveContributor)
        const slugIndex = buildEntitySlugIndex([], [contributorRecord], [])
        const refs = buildReferenceIndex([], [contributorRecord], ALL_PAGES, slugIndex)
        expect(refs.contributor.get(3)).toEqual({ name: "Retired Ray", href: hrefIn(slugIndex, "contributor", 3) })
    })

    it("REGRESSION GUARD: href is null for a contributor tagged `hidden` even when the noun has a template", () => {
        const contributorRecord = formatContribFromD1(hiddenContributor)
        const slugIndex = buildEntitySlugIndex([], [contributorRecord], [])
        const refs = buildReferenceIndex([], [contributorRecord], ALL_PAGES, slugIndex)
        expect(refs.contributor.get(4)).toEqual({ name: "Hidden Hank", href: null })
    })

    it("REGRESSION GUARD: resolves a hidden contributor's NAME at all - must be built from the unredacted all-contributors list, not fetchContributors' filtered public list", () => {
        // The whole point of buildReferenceIndex taking `allContributors`: a filtered-list caller would
        // never see contributor 4 in its input at all, and every reference to it would resolve blank.
        const contributorRecord = formatContribFromD1(hiddenContributor)
        const slugIndex = buildEntitySlugIndex([], [contributorRecord], [])
        const refs = buildReferenceIndex([], [contributorRecord], ALL_PAGES, slugIndex)
        expect(refs.contributor.get(4)?.name).toBe("Hidden Hank")
    })
})

describe("entityRecords - composer/contributor (bare records, pass through)", () => {
    const emptyRefs: EntityReferenceIndex = { composer: new Map(), contributor: new Map() }

    it("stringifies id and passes the record through as entry, plus the derived life_span field and a content-derived slug", () => {
        const record = formatCompFromD1(composer)
        const slugIndex = buildEntitySlugIndex([record], [], [])
        expect(entityRecords("composer", [record], null, null, emptyRefs, slugIndex)).toEqual([
            { id: "1", slug: slugIndex.composer.get(1), entry: { ...record, life_span: "1685–1750" } }
        ])
    })

    it("renders a living composer's life_span with the Present sentinel", () => {
        const record = formatCompFromD1({ ...composer, death_year: -1 })
        const slugIndex = buildEntitySlugIndex([record], [], [])
        const [result] = entityRecords("composer", [record], null, null, emptyRefs, slugIndex)
        expect(result.entry.life_span).toBe("1685–Present")
    })

    it("omits life_span for a stripped sentinel composer (birth_year/death_year nulled by fetchComposers)", () => {
        // stripSentinelComposerData nulls these at the build fetch, ahead of entityRecords - the type
        // still says `number` (see its as-unknown cast in d1-api.ts), so this mirrors that at runtime
        const record = { ...formatCompFromD1(composer), name: "Unknown", birth_year: null, death_year: null }
        const slugIndex = buildEntitySlugIndex([record as unknown as ComposerRecord], [], [])
        const [result] = entityRecords(
            "composer",
            [record as unknown as ComposerRecord],
            null,
            null,
            emptyRefs,
            slugIndex
        )
        expect(result.entry.life_span).toBeUndefined()
    })

    it("does the same for a contributor record, unchanged (no derived fields), plus a resolved slug", () => {
        const record = formatContribFromD1(activeContributor)
        const slugIndex = buildEntitySlugIndex([], [record], [])
        expect(entityRecords("contributor", null, [record], null, emptyRefs, slugIndex)).toEqual([
            { id: "2", slug: slugIndex.contributor.get(2), entry: record }
        ])
    })
})

describe("entityRecords - composition (the reference-fold linchpin)", () => {
    it("flattens rating/publication_info back to flat columns and resolves every foreign key", () => {
        const composerRecord = formatCompFromD1(composer)
        const activeRecord = formatContribFromD1(activeContributor)
        const hiddenRecord = formatContribFromD1(hiddenContributor)
        // References the HIDDEN contributor (id 4) - a local override, not the shared `composition`
        // fixture, which buildRelatedWorksIndex's tests below also depend on referencing contributor 3.
        const object = formatWorkFromD1({ ...composition, contrib_primary_2: 4, contrib_addl: "4" })
        const slugIndex = buildEntitySlugIndex([composerRecord], [activeRecord, hiddenRecord], [object])
        const refs = buildReferenceIndex([composerRecord], [activeRecord, hiddenRecord], ALL_PAGES, slugIndex)

        const [result] = entityRecords("composition", null, null, [object], refs, slugIndex)

        expect(result.id).toBe("10")
        expect(result.entry.name).toBe("Concerto")
        expect(result.entry.rating_suzuki).toBe(8)
        expect(result.entry.rating_nyssma).toBeNull()
        expect(result.entry.publish_name).toBe("Pub")
        expect(result.entry.publish_location).toBe("Loc")
        expect(result.entry.publish_year).toBe(2000)
        expect(result.entry.publication_uri).toEqual({ uriType: "https", uri: "https://example.test/score" })

        expect(result.entry.composer).toEqual({
            id: 1,
            name: "Bach",
            href: hrefIn(slugIndex, "composer", 1),
            role: "composer"
        })
        expect(result.entry.contrib_primary_1).toEqual({
            id: 2,
            name: "Ada",
            href: hrefIn(slugIndex, "contributor", 2)
        })
        // REGRESSION GUARD: contrib_primary_2 references the HIDDEN contributor
        expect(result.entry.contrib_primary_2).toEqual({ id: 4, name: "Hidden Hank", href: null })
        expect(result.entry.contrib_addl).toEqual([{ id: 4, name: "Hidden Hank", href: null }])
        expect(result.entry.author_secondary).toEqual([])
    })

    it("an unresolvable reference id resolves to an empty name and a null href, not a crash", () => {
        const object = formatWorkFromD1({ ...composition, composer_id: 999 })
        const slugIndex = buildEntitySlugIndex([], [], [object])
        const refs = buildReferenceIndex([], [], ALL_PAGES, slugIndex)

        const [result] = entityRecords("composition", null, null, [object], refs, slugIndex)

        expect(result.entry.composer).toEqual({ id: 999, name: "", href: null })
    })

    it("a null optional reference (contrib_primary_2) resolves to null, not a reference object", () => {
        const object = formatWorkFromD1({ ...composition, contrib_primary_2: null })
        const slugIndex = buildEntitySlugIndex([], [], [object])
        const refs = buildReferenceIndex([], [], ALL_PAGES, slugIndex)

        const [result] = entityRecords("composition", null, null, [object], refs, slugIndex)

        expect(result.entry.contrib_primary_2).toBeNull()
    })

    it("a reference to a real record resolves to no href when that noun has no published default template", () => {
        const composerRecord = formatCompFromD1(composer)
        const object = formatWorkFromD1(composition)
        const slugIndex = buildEntitySlugIndex([composerRecord], [], [object])
        const refs = buildReferenceIndex([composerRecord], [], { ...ALL_PAGES, composer: false }, slugIndex)

        const [result] = entityRecords("composition", null, null, [object], refs, slugIndex)

        expect(result.entry.composer).toEqual({ id: 1, name: "Bach", href: null, role: "composer" })
    })
})

describe("entityRecords - the reader-returned-null case (D1 unconfigured, or that table skipped)", () => {
    const emptyRefs: EntityReferenceIndex = { composer: new Map(), contributor: new Map() }
    const emptySlugIndex = buildEntitySlugIndex(null, null, null)

    it("contributes no records for any of the three nouns, matching the dual-source-dependency skip rule", () => {
        expect(entityRecords("composer", null, null, null, emptyRefs, emptySlugIndex)).toEqual([])
        expect(entityRecords("contributor", null, null, null, emptyRefs, emptySlugIndex)).toEqual([])
        expect(entityRecords("composition", null, null, null, emptyRefs, emptySlugIndex)).toEqual([])
    })
})

describe("buildRelatedWorksIndex - RelatedEntries' data source", () => {
    const bach: D1Composer = { ...composer, composer_id: 1, name: "Bach" }
    const mozart: D1Composer = { ...composer, composer_id: 4, name: "Mozart" }

    // work1/work2: both primary-credited to Bach. work3: primary-credited to Mozart, with Bach as a
    // secondary author - the case that exercises the composer index's two-pass (primary-before-secondary)
    // ordering.
    // uri cleared on all three - this describe isn't testing same-publication matching, and the shared
    // default `composition` fixture's uri would otherwise cross-match them under it.
    const work1: D1Composition = { ...composition, composition_id: 10, name: "Work One", composer_id: 1, uri: "" }
    const work2: D1Composition = {
        ...composition,
        composition_id: 11,
        name: "Work Two",
        composer_id: 1,
        contrib_primary_2: null,
        contrib_addl: "",
        uri: ""
    }
    const work3: D1Composition = {
        ...composition,
        composition_id: 12,
        name: "Work Three",
        composer_id: 4,
        contrib_primary_1: 5,
        contrib_primary_2: null,
        contrib_addl: "2",
        author_secondary: "1",
        uri: ""
    }

    const composers = [formatCompFromD1(bach), formatCompFromD1(mozart)]
    const works = [formatWorkFromD1(work1), formatWorkFromD1(work2), formatWorkFromD1(work3)]
    const slugIndex = buildEntitySlugIndex(composers, [], works)
    const index = buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex)
    const workHref = (id: number) => hrefIn(slugIndex, "composition", id)

    it("composer -> works: includes both primary and secondary-author credits (order is seed-shuffled, not credit-type order)", () => {
        expect(index.get("composer:1")).toEqual(
            expect.arrayContaining([
                { id: 10, name: "Work One", href: workHref(10), composer: "Bach" },
                { id: 11, name: "Work Two", href: workHref(11), composer: "Bach" },
                { id: 12, name: "Work Three", href: workHref(12), composer: "Mozart" }
            ])
        )
        expect(index.get("composer:1")).toHaveLength(3)
    })

    it("composer -> works: order is deterministic (seeded by composer id) across separate calls with the same input", () => {
        const rebuilt = buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex)
        expect(rebuilt.get("composer:1")).toEqual(index.get("composer:1"))
    })

    it("composer -> works: a composer with only primary credits gets no secondary-pass duplicates", () => {
        expect(index.get("composer:4")).toEqual([{ id: 12, name: "Work Three", href: workHref(12), composer: "Mozart" }])
    })

    it("composition -> related works: other works by the same composer, excluding itself", () => {
        expect(index.get("composition:10")).toEqual([{ id: 11, name: "Work Two", href: workHref(11), composer: "Bach" }])
        expect(index.get("composition:11")).toEqual([{ id: 10, name: "Work One", href: workHref(10), composer: "Bach" }])
    })

    it("composition -> related works: no entry (not even an empty array) when no sibling exists", () => {
        expect(index.get("composition:12")).toBeUndefined()
    })

    it("contributor -> works: matches across contrib_primary_1, contrib_primary_2, and contrib_addl", () => {
        // contributor 2: contrib_primary_1 on work1 and work2, contrib_addl on work3. Order is truly
        // randomized (a fresh shuffle per build), so this only checks membership, not order.
        expect(index.get("contributor:2")).toEqual(
            expect.arrayContaining([
                { id: 10, name: "Work One", href: workHref(10), composer: "Bach" },
                { id: 11, name: "Work Two", href: workHref(11), composer: "Bach" },
                { id: 12, name: "Work Three", href: workHref(12), composer: "Mozart" }
            ])
        )
        expect(index.get("contributor:2")).toHaveLength(3)
        // contributor 3: contrib_primary_2 AND contrib_addl on work1 alone - deduped to one entry.
        expect(index.get("contributor:3")).toEqual([{ id: 10, name: "Work One", href: workHref(10), composer: "Bach" }])
        // contributor 5: contrib_primary_1 on work3 only.
        expect(index.get("contributor:5")).toEqual([
            { id: 12, name: "Work Three", href: workHref(12), composer: "Mozart" }
        ])
    })

    it("hrefs are null when compositions have no published default template this build", () => {
        const noCompositionPage = buildRelatedWorksIndex(composers, works, { ...ALL_PAGES, composition: false }, slugIndex)
        expect(noCompositionPage.get("composer:1")?.every((work) => work.href === null)).toBe(true)
    })

    it("an empty composers/compositions input yields an empty index", () => {
        expect(buildRelatedWorksIndex(null, null, ALL_PAGES, buildEntitySlugIndex(null, null, null)).size).toBe(0)
    })

    it("composition -> related works: same-name siblings (other parts of the same piece) lead the list, sorted alphabetically by part, ahead of the randomized rest", () => {
        // prelude/preludeMvt2/preludeMvt1 share a name, differing only by part - the same signal the
        // composer_id+name+part unique index keys on - and must sort before fugue/gavotte, in part order
        // ("I" before "II") rather than encounter/id order (21 was pushed before 24).
        const prelude: D1Composition = { ...composition, composition_id: 20, name: "Prelude", part: null }
        const preludeMvt2: D1Composition = { ...composition, composition_id: 21, name: "Prelude", part: "II" }
        const fugue: D1Composition = { ...composition, composition_id: 22, name: "Fugue" }
        const gavotte: D1Composition = { ...composition, composition_id: 23, name: "Gavotte" }
        const preludeMvt1: D1Composition = { ...composition, composition_id: 24, name: "Prelude", part: "I" }
        const nameComposers = [formatCompFromD1(composer)]
        const nameWorks = [prelude, preludeMvt2, fugue, gavotte, preludeMvt1].map(formatWorkFromD1)
        const nameSlugIndex = buildEntitySlugIndex(nameComposers, [], nameWorks)
        const nameIndex = buildRelatedWorksIndex(nameComposers, nameWorks, ALL_PAGES, nameSlugIndex)
        const nameWorkHref = (id: number) => hrefIn(nameSlugIndex, "composition", id)

        const related = nameIndex.get("composition:20")
        // Automatic disambiguation: ids 21/24 share (composer, name) with id 20, so their own `part`
        // surfaces in parentheses - the composer subtitle alone can't tell the "Prelude"s apart.
        expect(related?.slice(0, 2)).toEqual([
            { id: 24, name: "Prelude (I)", href: nameWorkHref(24), composer: "Bach" },
            { id: 21, name: "Prelude (II)", href: nameWorkHref(21), composer: "Bach" }
        ])
        expect(related?.slice(2)).toEqual(
            expect.arrayContaining([
                { id: 22, name: "Fugue", href: nameWorkHref(22), composer: "Bach" },
                { id: 23, name: "Gavotte", href: nameWorkHref(23), composer: "Bach" }
            ])
        )
        expect(related).toHaveLength(4)
    })
})

describe("buildRelatedWorksIndex - same-publication cross-composer matches (isbn/doi source)", () => {
    const bach: D1Composer = { ...composer, composer_id: 1, name: "Bach" }
    const mozart: D1Composer = { ...composer, composer_id: 4, name: "Mozart" }
    const haydn: D1Composer = { ...composer, composer_id: 6, name: "Haydn" }
    const composers = [formatCompFromD1(bach), formatCompFromD1(mozart), formatCompFromD1(haydn)]

    it("appends other-composer works sharing the same isbn/doi source AFTER same-composer works, and ISBN comparison ignores hyphens/spaces/case", () => {
        const target: D1Composition = {
            ...composition,
            composition_id: 40,
            name: "Etude",
            composer_id: 1,
            uri_type: "isbn",
            uri: "978-0-13-149505-0"
        }
        const sameComposerSibling: D1Composition = {
            ...composition,
            composition_id: 41,
            name: "Caprice",
            composer_id: 1,
            uri_type: "https",
            uri: "https://example.test/other"
        }
        const samePublicationOtherComposer: D1Composition = {
            ...composition,
            composition_id: 42,
            name: "Nocturne",
            composer_id: 4,
            uri_type: "isbn",
            uri: "9780131495050" // same ISBN, hyphens/spaces stripped
        }
        const samePublicationCaseVariant: D1Composition = {
            ...composition,
            composition_id: 43,
            name: "Fantasia",
            composer_id: 6,
            uri_type: "isbn",
            uri: "978 0 13 149505 0"
        }
        const differentIsbn: D1Composition = {
            ...composition,
            composition_id: 44,
            name: "Rhapsody",
            composer_id: 4,
            uri_type: "isbn",
            uri: "0-306-40615-2"
        }
        const works = [
            target,
            sameComposerSibling,
            samePublicationOtherComposer,
            samePublicationCaseVariant,
            differentIsbn
        ].map(formatWorkFromD1)

        const slugIndex = buildEntitySlugIndex(composers, [], works)
        const index = buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex)
        const workHref = (id: number) => hrefIn(slugIndex, "composition", id)
        const related = index.get("composition:40") ?? []

        expect(related).toHaveLength(3)
        // Same-composer match(es) lead; same-publication cross-composer matches trail. Order within each
        // group is randomized, so only membership+partition is asserted, not exact order.
        expect(related[0]).toEqual({ id: 41, name: "Caprice", href: workHref(41), composer: "Bach" })
        expect(related.slice(1)).toEqual(
            expect.arrayContaining([
                { id: 42, name: "Nocturne", href: workHref(42), composer: "Mozart" },
                { id: 43, name: "Fantasia", href: workHref(43), composer: "Haydn" }
            ])
        )
        // id 44 (a different ISBN) never appears - not the same publication.
        expect(related.some((work) => work.id === 44)).toBe(false)
    })

    it("an https source shared with another composer's work triggers same-publication matching", () => {
        const target: D1Composition = {
            ...composition,
            composition_id: 50,
            name: "Sonata",
            composer_id: 1,
            uri_type: "https",
            uri: "https://example.test/shared"
        }
        const otherComposerSameUrl: D1Composition = {
            ...composition,
            composition_id: 51,
            name: "Ballade",
            composer_id: 4,
            uri_type: "https",
            uri: "https://example.test/shared"
        }
        const works = [target, otherComposerSameUrl].map(formatWorkFromD1)

        const slugIndex = buildEntitySlugIndex(composers, [], works)
        const index = buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex)
        const workHref = (id: number) => hrefIn(slugIndex, "composition", id)
        expect(index.get("composition:50")).toEqual([
            { id: 51, name: "Ballade", href: workHref(51), composer: "Mozart" }
        ])
    })

    it("rejects https matching when the shared source is an encyclopedic/database host (Wikipedia, IMSLP)", () => {
        const wikipediaTarget: D1Composition = {
            ...composition,
            composition_id: 52,
            name: "Prelude",
            composer_id: 1,
            uri_type: "https",
            uri: "https://en.wikipedia.org/wiki/Shared_page"
        }
        const wikipediaOtherComposer: D1Composition = {
            ...composition,
            composition_id: 53,
            name: "Fugue",
            composer_id: 4,
            uri_type: "https",
            uri: "https://en.wikipedia.org/wiki/Shared_page"
        }
        // composer_id 6 (Haydn), not 1 - a same-composer match with wikipediaTarget would otherwise
        // pollute this test's result via the pre-existing same-composer pass, unrelated to publication.
        const imslpTarget: D1Composition = {
            ...composition,
            composition_id: 54,
            name: "Toccata",
            composer_id: 6,
            uri_type: "https",
            uri: "https://imslp.org/wiki/Shared_page"
        }
        const imslpOtherComposer: D1Composition = {
            ...composition,
            composition_id: 55,
            name: "Gigue",
            composer_id: 4,
            uri_type: "https",
            uri: "https://imslp.org/wiki/Shared_page"
        }
        const works = [wikipediaTarget, wikipediaOtherComposer, imslpTarget, imslpOtherComposer].map(formatWorkFromD1)

        const slugIndex = buildEntitySlugIndex(composers, [], works)
        const index = buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex)
        expect(index.get("composition:52")).toBeUndefined()
        expect(index.get("composition:54")).toBeUndefined()
    })
})

describe("buildRelatedWorksIndex - multi-movement grouping (shuffle units, not just tiles)", () => {
    const bach: D1Composer = { ...composer, composer_id: 1, name: "Bach" }

    // Movements share a long base title (well past the 50%/12-char threshold) and a movement-marker-shaped
    // remainder
    const mvt2: D1Composition = {
        ...composition,
        composition_id: 30,
        name: "Violin Concerto in D Major, Op. 61, II: Larghetto",
        composer_id: 1
    }
    const mvt1: D1Composition = {
        ...composition,
        composition_id: 31,
        name: "Violin Concerto in D Major, Op. 61, Mvt. I: Allegro ma non troppo",
        composer_id: 1
    }
    const mvt3: D1Composition = {
        ...composition,
        composition_id: 32,
        name: "Violin Concerto in D Major, Op. 61 - 3: Rondo",
        composer_id: 1
    }
    // A normal, unrelated work by the same composer - must stay its own unit, not get absorbed
    const unrelated: D1Composition = { ...composition, composition_id: 33, name: "Air on the G String", composer_id: 1 }
    // Two movement-marker-shaped names sharing an exact but SHORT base ("Air", 3 chars, well under the
    // 12-char absolute floor) - must NOT cluster
    const shortDecoyA: D1Composition = { ...composition, composition_id: 34, name: "Air, II: Reprise", composer_id: 1 }
    const shortDecoyB: D1Composition = { ...composition, composition_id: 36, name: "Air, III: Encore", composer_id: 1 }
    // Looks like a movement number but is actually a catalog number after "No."
    const catalogDecoy: D1Composition = { ...composition, composition_id: 35, name: "Sonata No. 5 in G Major", composer_id: 1 }

    const composers = [formatCompFromD1(bach)]
    const works = [mvt2, mvt1, mvt3, unrelated, shortDecoyA, shortDecoyB, catalogDecoy].map(formatWorkFromD1)
    const slugIndex = buildEntitySlugIndex(composers, [], works)

    it("collapses same-work movements into one shuffle unit, kept in movement order, alongside untouched siblings", () => {
        const index = buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex)
        const related = index.get("composition:33") ?? []

        const ids = related.map((w) => w.id)
        const i1 = ids.indexOf(31)
        const i2 = ids.indexOf(30)
        const i3 = ids.indexOf(32)
        // The three movements are contiguous (grouped) and in movement order (I, II, III) regardless of
        // where the shuffle placed the group as a whole
        expect(i2).toBe(i1 + 1)
        expect(i3).toBe(i2 + 1)
        expect(ids).toContain(34)
        expect(ids).toContain(36)
        expect(ids).toContain(35)
        expect(related).toHaveLength(6)
    })

    it("REGRESSION GUARD: an exact but short shared base (under the 12-char absolute floor) does not cluster despite a 100% prefix match", () => {
        // shortDecoyA/B ("Air, II: Reprise" / "Air, III: Encore") share the exact base "Air" - a 100%
        // prefix match - but 3 characters is under PARTIAL_MATCH_MIN_CHARS
        const index = buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex)
        const related = index.get("composition:33") ?? []
        const ids = related.map((w) => w.id)
        // Structural guard: a real group's members are always contiguous
        let sawSeparation = false
        for (let attempt = 0; attempt < 25; attempt++) {
            const rebuilt = (
                buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex).get("composition:33") ?? []
            ).map((w) => w.id)
            const i34 = rebuilt.indexOf(34)
            const i36 = rebuilt.indexOf(36)
            if (Math.abs(i34 - i36) > 1) {
                sawSeparation = true
                break
            }
        }
        expect(sawSeparation).toBe(true)
        expect(ids).toContain(34)
        expect(ids).toContain(36)
    })

    it("REGRESSION GUARD: 'No. 5' (catalog number) is never misread as a movement marker", () => {
        const index = buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex)
        const related = index.get("composition:33") ?? []
        expect(related.find((w) => w.id === 35)?.name).toBe("Sonata No. 5 in G Major")
    })

    it("REGRESSION GUARD: grouping never sweeps in the routed/currently-viewed record itself", () => {
        // Viewing movement II (id 30): its own related list must never contain id 30.
        const index = buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex)
        const related = index.get("composition:30") ?? []
        expect(related.some((w) => w.id === 30)).toBe(false)
        expect(related.map((w) => w.id)).toContain(31)
        expect(related.map((w) => w.id)).toContain(32)
    })

    it("composer bucket: the same grouping applies under the composer's seeded shuffle", () => {
        const index = buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex)
        const related = index.get("composer:1") ?? []
        const ids = related.map((w) => w.id)
        const i1 = ids.indexOf(31)
        const i2 = ids.indexOf(30)
        const i3 = ids.indexOf(32)
        expect(i2).toBe(i1 + 1)
        expect(i3).toBe(i2 + 1)
        expect(related).toHaveLength(7)
    })

    it("contributor bucket: the same grouping applies under the contributor's random shuffle", () => {
        const index = buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex)
        // contributor 2 is contrib_primary_1 on every fixture work (shared `composition` base object).
        const related = index.get("contributor:2") ?? []
        const ids = related.map((w) => w.id)
        const i1 = ids.indexOf(31)
        const i2 = ids.indexOf(30)
        const i3 = ids.indexOf(32)
        expect(i2).toBe(i1 + 1)
        expect(i3).toBe(i2 + 1)
        expect(related).toHaveLength(7)
    })
})

describe("buildRelatedWorksIndex - lower-priority 'Op. #, No. #' movement fallback", () => {
    const bach: D1Composer = { ...composer, composer_id: 1, name: "Bach" }

    it("groups a sequence sharing a base title, ordered by the 'No.' number, when the primary marker is absent", () => {
        const no1: D1Composition = {
            ...composition,
            composition_id: 40,
            name: "Six String Quartets, Op. 76, No. 1",
            composer_id: 1
        }
        const no2: D1Composition = {
            ...composition,
            composition_id: 41,
            name: "Six String Quartets, Op. 76, No. 2",
            composer_id: 1
        }
        const unrelated: D1Composition = { ...composition, composition_id: 42, name: "Air on the G String", composer_id: 1 }
        const composers = [formatCompFromD1(bach)]
        const works = [no1, no2, unrelated].map(formatWorkFromD1)
        const slugIndex = buildEntitySlugIndex(composers, [], works)

        const index = buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex)
        const related = index.get("composition:42") ?? []
        const ids = related.map((w) => w.id)
        expect(ids.indexOf(41)).toBe(ids.indexOf(40) + 1)
    })

    it("matches with the 'Op. #' part omitted, and with trailing text after the 'No. #' marker", () => {
        const no1: D1Composition = {
            ...composition,
            composition_id: 43,
            name: "Six Sonatas for Violin, No. 1 in C Major",
            composer_id: 1
        }
        const no2: D1Composition = {
            ...composition,
            composition_id: 44,
            name: "Six Sonatas for Violin, No. 2 in D Minor",
            composer_id: 1
        }
        const unrelated: D1Composition = { ...composition, composition_id: 45, name: "Air on the G String", composer_id: 1 }
        const composers = [formatCompFromD1(bach)]
        const works = [no1, no2, unrelated].map(formatWorkFromD1)
        const slugIndex = buildEntitySlugIndex(composers, [], works)

        const index = buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex)
        const related = index.get("composition:45") ?? []
        const ids = related.map((w) => w.id)
        expect(ids.indexOf(44)).toBe(ids.indexOf(43) + 1)
    })

    it("prefers the primary movement pattern over the 'No.' fallback when both are present in the name", () => {
        // Each name embeds an unrelated "No. 3" ahead of its real, primary comma-colon marker. If the
        // fallback pattern were used instead, both would read the SAME movement number (3) off "No. 3" -
        // making the pair a stale/identical-number fuzzy cluster (see the guard test below) that does NOT
        // group. Only reading the primary "II:"/"III:" marker (movement numbers 2 and 3) clusters them.
        const mvt2: D1Composition = {
            ...composition,
            composition_id: 46,
            name: "Serenade No. 3, II: Gavotte",
            composer_id: 1
        }
        const mvt3: D1Composition = {
            ...composition,
            composition_id: 47,
            name: "Serenade No. 3, III: Gigue",
            composer_id: 1
        }
        const unrelated: D1Composition = { ...composition, composition_id: 49, name: "Air on the G String", composer_id: 1 }
        const composers = [formatCompFromD1(bach)]
        const works = [mvt2, mvt3, unrelated].map(formatWorkFromD1)
        const slugIndex = buildEntitySlugIndex(composers, [], works)

        const index = buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex)
        const related = index.get("composition:49") ?? []
        const ids = related.map((w) => w.id)
        expect(ids).toEqual([46, 47])
    })

    it("REGRESSION GUARD: does not cluster when the 'No.' number is identical across the would-be group", () => {
        const dup1: D1Composition = {
            ...composition,
            composition_id: 60,
            name: "Six String Quartets, Op. 76, No. 1",
            composer_id: 1
        }
        const dup2: D1Composition = {
            ...composition,
            composition_id: 61,
            name: "Six String Quartets, Op. 76, No. 1",
            composer_id: 1
        }
        const filler: D1Composition = { ...composition, composition_id: 62, name: "Air on the G String", composer_id: 1 }
        const composers = [formatCompFromD1(bach)]
        const works = [dup1, dup2, filler].map(formatWorkFromD1)
        const slugIndex = buildEntitySlugIndex(composers, [], works)

        // Structural guard: a real group's members are always contiguous. dup1/dup2 share an identical
        // "No. 1" - not a real sequence - so across contributor:2's random shuffle they must sometimes
        // land apart, unlike a genuine cluster which is always adjacent.
        let sawSeparation = false
        for (let attempt = 0; attempt < 25; attempt++) {
            const related = (
                buildRelatedWorksIndex(composers, works, ALL_PAGES, slugIndex).get("contributor:2") ?? []
            ).map((w) => w.id)
            if (Math.abs(related.indexOf(60) - related.indexOf(61)) > 1) {
                sawSeparation = true
                break
            }
        }
        expect(sawSeparation).toBe(true)
    })
})
