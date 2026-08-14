/**
 * tests/search-facets.test.ts
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
 */

import { describe, it, expect } from "vitest"

import {
    ADVANCED_FIELDS,
    criteriaToParams,
    hasCriteria,
    keyOptions,
    keyRefLabel,
    matchesFacets,
    NONE_VALUE,
    nounOptions,
    parseFacetParams,
    parseFacetQuery,
    type FacetCriteria,
    type FacetEntry
} from "../src/lib/search/facets"

describe("keyOptions / keyRefLabel", () => {
    it("collapses the 42-member Key enum into 24 enharmonic-paired options", () => {
        expect(keyOptions()).toHaveLength(24)
    })

    it("groups C# Major and Db Major under the same pitch-class option, labelled with both spellings", () => {
        const options = keyOptions()
        const csharp = options.find((option) => option.label.includes("C♯"))
        const dflat = options.find((option) => option.label.includes("D♭"))
        expect(csharp).toBeDefined()
        expect(csharp).toBe(dflat)
        expect(csharp?.label).toBe("C♯/D♭ major")
    })

    it("keyRefLabel resolves a ref back to its label, and falls back to the ref itself when unknown", () => {
        const option = keyOptions().find((candidate) => candidate.label.startsWith("G "))
        expect(option).toBeDefined()
        expect(keyRefLabel(option!.value)).toBe(option!.label)
        expect(keyRefLabel("not-a-ref")).toBe("not-a-ref")
    })
})

describe("nounOptions", () => {
    it("lists all three entity nouns by their public URL slugs, with no 'Any' pseudo-option", () => {
        const options = nounOptions()
        expect(options).toHaveLength(3)
        expect(options.map((option) => option.value).sort()).toEqual(["composer", "contributor", "work"])
    })
})

describe("matchesFacets", () => {
    const work: FacetEntry = {
        url: "/entity/work/1",
        noun: "composition",
        name: "Test Concerto",
        composer: "Johann Sebastian Bach",
        secondaryAuthors: "Fritz Kreisler",
        part: "violin",
        keyRef: "7-minor",
        type: "Chamber",
        year: 1723,
        publisher: "Schirmer",
        suzuki: 4,
        nyssma: 5,
        tags: "recital, advanced"
    }
    const composer: FacetEntry = {
        url: "/entity/composer/1",
        noun: "composer",
        name: "Johann Sebastian Bach",
        country: "DE",
        role: "composer",
        birthYear: 1685,
        deathYear: 1750,
        tags: "baroque"
    }
    const livingComposer: FacetEntry = {
        url: "/entity/composer/2",
        noun: "composer",
        name: "Living Composer",
        country: "US"
        // no birthYear/deathYear — mirrors search/advanced/db-search-index.json.ts omitting the -1 "living" sentinel
    }

    it("matches on an empty criteria object (no filters applied)", () => {
        expect(matchesFacets(work, {})).toBe(true)
    })

    it("nouns gates the entry type, and accepts more than one", () => {
        expect(matchesFacets(work, { nouns: ["composition"] })).toBe(true)
        expect(matchesFacets(work, { nouns: ["composer"] })).toBe(false)
        expect(matchesFacets(work, { nouns: ["composer", "composition"] })).toBe(true)
        expect(matchesFacets(work, { nouns: [] })).toBe(true)
    })

    it("text fields default to case-insensitive 'contains', and support exact 'is'", () => {
        expect(matchesFacets(work, { composer: { op: "contains", value: "bach" } })).toBe(true)
        expect(matchesFacets(work, { composer: { op: "contains", value: "handel" } })).toBe(false)
        expect(matchesFacets(work, { composer: { op: "is", value: "bach" } })).toBe(false)
        expect(matchesFacets(work, { composer: { op: "is", value: "Johann Sebastian Bach" } })).toBe(true)
    })

    it("role is a closed-vocabulary exact match, not free text", () => {
        expect(matchesFacets(composer, { role: "composer" })).toBe(true)
        expect(matchesFacets(composer, { role: "arranger" })).toBe(false)
    })

    it("country matches either the raw code or the resolved display name, honoring contains/is", () => {
        expect(matchesFacets(composer, { country: { op: "contains", value: "de" } })).toBe(true)
        expect(matchesFacets(composer, { country: { op: "contains", value: "germany" } })).toBe(true)
        expect(matchesFacets(composer, { country: { op: "contains", value: "france" } })).toBe(false)
        expect(matchesFacets(composer, { country: { op: "is", value: "DE" } })).toBe(true)
        expect(matchesFacets(composer, { country: { op: "is", value: "germany" } })).toBe(true)
        expect(matchesFacets(composer, { country: { op: "is", value: "d" } })).toBe(false)
    })

    it("keyRef and type are exact matches", () => {
        expect(matchesFacets(work, { keyRef: "7-minor" })).toBe(true)
        expect(matchesFacets(work, { keyRef: "7-major" })).toBe(false)
        expect(matchesFacets(work, { type: "Chamber" })).toBe(true)
        expect(matchesFacets(work, { type: "Solo" })).toBe(false)
    })

    it("NONE_VALUE matches an applicable entry with the field unset, but never an entry of a noun the field doesn't apply to", () => {
        const workNoKeyOrType: FacetEntry = { url: "/entity/work/2", noun: "composition", name: "Untitled Sketch" }
        // `work` carries keyRef/type; `workNoKeyOrType` is composition too but has neither set.
        expect(matchesFacets(work, { keyRef: NONE_VALUE })).toBe(false)
        expect(matchesFacets(workNoKeyOrType, { keyRef: NONE_VALUE })).toBe(true)
        expect(matchesFacets(work, { type: NONE_VALUE })).toBe(false)
        expect(matchesFacets(workNoKeyOrType, { type: NONE_VALUE })).toBe(true)
        // keyRef/type are composition-only — a composer entry can't satisfy NONE_VALUE either, since the
        // field isn't merely unset for it, it doesn't apply to composers at all.
        expect(matchesFacets(composer, { keyRef: NONE_VALUE })).toBe(false)
        expect(matchesFacets(composer, { type: NONE_VALUE })).toBe(false)
        // `composer` has a role set; `livingComposer` doesn't — role applies to both, so this is a genuine
        // "unset" case, not a noun mismatch.
        expect(matchesFacets(composer, { role: NONE_VALUE })).toBe(false)
        expect(matchesFacets(livingComposer, { role: NONE_VALUE })).toBe(true)
    })

    it("number fields support is/before/after/between/around", () => {
        expect(matchesFacets(work, { year: { op: "is", value: 1723 } })).toBe(true)
        expect(matchesFacets(work, { year: { op: "before", value: 1800 } })).toBe(true)
        expect(matchesFacets(work, { year: { op: "before", value: 1700 } })).toBe(false)
        expect(matchesFacets(work, { year: { op: "after", value: 1700 } })).toBe(true)
        expect(matchesFacets(work, { year: { op: "between", value: 1700, valueTo: 1750 } })).toBe(true)
        expect(matchesFacets(work, { year: { op: "between", value: 1800, valueTo: 1850 } })).toBe(false)
        expect(matchesFacets(work, { year: { op: "around", value: 1725 } })).toBe(true)
        expect(matchesFacets(work, { year: { op: "around", value: 2000 } })).toBe(false)
        // year is composition-only (ADVANCED_FIELDS) — a composer entry has no publish_year at all, so a
        // year criterion excludes it rather than passing it through untouched.
        expect(matchesFacets(composer, { year: { op: "is", value: 1723 } })).toBe(false)
    })

    it("ratings support is/atLeast/atMost/between", () => {
        expect(matchesFacets(work, { suzuki: { op: "atLeast", value: 4 } })).toBe(true)
        expect(matchesFacets(work, { suzuki: { op: "atLeast", value: 5 } })).toBe(false)
        expect(matchesFacets(work, { suzuki: { op: "atMost", value: 4 } })).toBe(true)
        expect(matchesFacets(work, { suzuki: { op: "is", value: 4 } })).toBe(true)
        expect(matchesFacets(work, { suzuki: { op: "between", value: 3, valueTo: 5 } })).toBe(true)
        expect(matchesFacets(work, { suzuki: { op: "between", value: 5, valueTo: 6 } })).toBe(false)
        // suzuki is composition-only — see the year case above for why a composer entry is excluded.
        expect(matchesFacets(composer, { suzuki: { op: "atLeast", value: 1 } })).toBe(false)
    })

    it("secondaryAuthors/part/publisher/tags are free-text, contains/is/regex/fuzzy like composer/country", () => {
        expect(matchesFacets(work, { secondaryAuthors: { op: "contains", value: "kreisler" } })).toBe(true)
        expect(matchesFacets(work, { secondaryAuthors: { op: "contains", value: "handel" } })).toBe(false)
        expect(matchesFacets(work, { part: { op: "is", value: "violin" } })).toBe(true)
        expect(matchesFacets(work, { part: { op: "is", value: "viola" } })).toBe(false)
        expect(matchesFacets(work, { publisher: { op: "contains", value: "schirmer" } })).toBe(true)
        // tags applies to both composer and composition entries.
        expect(matchesFacets(work, { tags: { op: "contains", value: "recital" } })).toBe(true)
        expect(matchesFacets(composer, { tags: { op: "contains", value: "baroque" } })).toBe(true)
        expect(matchesFacets(composer, { tags: { op: "contains", value: "recital" } })).toBe(false)
    })

    it("a criterion for a field that doesn't apply to the entry's noun is a hard mismatch, excluding the entry", () => {
        // Regression coverage for the noun-leak bug: a noun-specific filter (e.g. "Work type: Chamber") must
        // narrow results to nouns the field applies to, not pass every other noun's entries through
        // untouched — a composer/contributor has no `type` at all, so it can never satisfy that filter.
        // /search/advanced's own form is what keeps a *stale* value (typed before switching entity-type
        // checkboxes) from ever reaching this function in the first place — see updateFieldVisibility's
        // disabled-controls handling in advanced.astro.
        expect(matchesFacets(composer, { composer: { op: "contains", value: "bach" } })).toBe(false)
        expect(matchesFacets(work, { country: { op: "contains", value: "de" } })).toBe(false)
        expect(matchesFacets(work, { role: "composer" })).toBe(false)
        expect(matchesFacets(composer, { keyRef: "7-minor" })).toBe(false)
        expect(matchesFacets(composer, { type: "Chamber" })).toBe(false)
        expect(matchesFacets(composer, { part: { op: "contains", value: "violin" } })).toBe(false)
        expect(matchesFacets(composer, { publisher: { op: "contains", value: "schirmer" } })).toBe(false)
        expect(matchesFacets(composer, { secondaryAuthors: { op: "contains", value: "kreisler" } })).toBe(false)
    })

    it("no explicit noun restriction plus a noun-specific filter still excludes entries the field doesn't apply to", () => {
        // The exact bug report: selecting a composition-only filter (e.g. Work type) with no noun checkboxes
        // checked must not leak composer/contributor entries into the results.
        const criteria = { type: "Chamber" }
        expect(matchesFacets(work, criteria)).toBe(true)
        expect(matchesFacets(composer, criteria)).toBe(false)
    })

    it("birthYear/deathYear support the same operators as publication year", () => {
        expect(matchesFacets(composer, { birthYear: { op: "is", value: 1685 } })).toBe(true)
        expect(matchesFacets(composer, { birthYear: { op: "is", value: 1686 } })).toBe(false)
        expect(matchesFacets(composer, { deathYear: { op: "between", value: 1700, valueTo: 1800 } })).toBe(true)
    })

    it("deathYear's 'alive' operator matches only entries with no deathYear (the -1 sentinel is omitted, not encoded)", () => {
        expect(matchesFacets(livingComposer, { deathYear: { op: "alive", value: 0 } })).toBe(true)
        expect(matchesFacets(composer, { deathYear: { op: "alive", value: 0 } })).toBe(false)
    })
})

describe("parseFacetParams / criteriaToParams round-trip", () => {
    it("round-trips every criterion through URLSearchParams", () => {
        const criteria: FacetCriteria = {
            nouns: ["composition", "composer"],
            composer: { op: "is", value: "Bach" },
            secondaryAuthors: { op: "contains", value: "Kreisler" },
            part: { op: "is", value: "violin" },
            keyRef: "7-minor",
            type: "Chamber",
            year: { op: "between", value: 1700, valueTo: 1750 },
            publisher: { op: "contains", value: "Schirmer" },
            suzuki: { op: "atLeast", value: 4 },
            nyssma: { op: "is", value: 3 },
            tags: { op: "contains", value: "recital" },
            country: { op: "contains", value: "DE" },
            role: "arranger",
            birthYear: { op: "before", value: 1750 },
            deathYear: { op: "after", value: 1700 }
        }
        const roundTripped = parseFacetParams(criteriaToParams(criteria))
        expect(roundTripped).toEqual(criteria)
    })

    it("round-trips deathYear's 'alive' operator without a value param", () => {
        const criteria: FacetCriteria = { deathYear: { op: "alive", value: 0 } }
        const params = criteriaToParams(criteria)
        expect(params.has("deathYear")).toBe(false)
        expect(parseFacetParams(params).deathYear).toEqual({ op: "alive", value: 0 })
    })

    it("drops blank/absent params rather than emitting empty-string criteria", () => {
        const criteria = parseFacetParams(new URLSearchParams("composer=&year=1700"))
        expect(criteria).toEqual({ year: { op: "is", value: 1700 } })
    })

    it("noun params use the public URL slug (work), not the internal noun (composition), and accumulate", () => {
        const params = criteriaToParams({ nouns: ["composition", "contributor"] })
        expect(params.getAll("noun")).toEqual(["work", "contributor"])
        expect(parseFacetParams(params).nouns).toEqual(["composition", "contributor"])
    })

    it("a text/number field with no explicit operator param falls back to that field's default operator", () => {
        expect(parseFacetParams(new URLSearchParams("composer=bach")).composer).toEqual({
            op: "contains",
            value: "bach"
        })
        expect(parseFacetParams(new URLSearchParams("suzuki=4")).suzuki).toEqual({ op: "atLeast", value: 4 })
        expect(parseFacetParams(new URLSearchParams("year=1700")).year).toEqual({ op: "is", value: 1700 })
    })

    it("an unrecognized operator param falls back to the default rather than producing an invalid criterion", () => {
        expect(parseFacetParams(new URLSearchParams("year=1700&year_op=nonsense")).year).toEqual({
            op: "is",
            value: 1700
        })
    })

    it("valueTo is only read (and only round-tripped) when the operator is 'between'", () => {
        expect(parseFacetParams(new URLSearchParams("year=1700&year_op=is&yearTo=1750")).year).toEqual({
            op: "is",
            value: 1700
        })
        const params = criteriaToParams({ year: { op: "is", value: 1700, valueTo: 1750 } })
        expect(params.has("yearTo")).toBe(false)
    })
})

describe("parseFacetQuery", () => {
    it("returns an empty criteria object and the original text for a plain query", () => {
        const result = parseFacetQuery("bach violin")
        expect(result.hasCriteria).toBe(false)
        expect(result.text).toBe("bach violin")
        expect(result.criteria).toEqual({})
    })

    it("noun: token maps the public slug to the internal noun, accumulates, and snaps to database mode", () => {
        const result = parseFacetQuery("noun:work noun:contributor")
        expect(result.criteria.nouns).toEqual(["composition", "contributor"])
        expect(hasCriteria(result.criteria)).toBe(true)
        expect(result.text).toBe("")
    })

    it("key: token resolves enharmonic spellings to the same pitch-class ref", () => {
        expect(parseFacetQuery("key:g-minor").criteria.keyRef).toBe(parseFacetQuery("key:g-minor").criteria.keyRef)
        const sharp = parseFacetQuery("key:c#-major").criteria.keyRef
        const flat = parseFacetQuery("key:db-major").criteria.keyRef
        expect(sharp).toBeDefined()
        expect(sharp).toBe(flat)
    })

    it("year: token supports a range, a comparison, and an exact value", () => {
        expect(parseFacetQuery("year:1700-1750").criteria.year).toEqual({ op: "between", value: 1700, valueTo: 1750 })
        expect(parseFacetQuery("year:>=1700").criteria.year).toEqual({ op: "atLeast", value: 1700 })
        expect(parseFacetQuery("year:>1700").criteria.year).toEqual({ op: "after", value: 1700 })
        expect(parseFacetQuery("year:<=1750").criteria.year).toEqual({ op: "atMost", value: 1750 })
        expect(parseFacetQuery("year:<1750").criteria.year).toEqual({ op: "before", value: 1750 })
        expect(parseFacetQuery("year:1802").criteria.year).toEqual({ op: "is", value: 1802 })
    })

    it("suzuki:/nyssma: tokens support a comparison or an exact value, both as a floor threshold", () => {
        expect(parseFacetQuery("suzuki:>=4").criteria.suzuki).toEqual({ op: "atLeast", value: 4 })
        expect(parseFacetQuery("suzuki:4").criteria.suzuki).toEqual({ op: "atLeast", value: 4 })
        expect(parseFacetQuery("nyssma:>3").criteria.nyssma).toEqual({ op: "after", value: 3 })
    })

    it("composer:/country: tokens carry their value through verbatim as a 'contains' criterion; type:/role: are exact", () => {
        const result = parseFacetQuery("composer:bach type:chamber country:france role:Arranger")
        expect(result.criteria).toMatchObject({
            composer: { op: "contains", value: "bach" },
            type: "chamber",
            country: { op: "contains", value: "france" },
            role: "arranger"
        })
        expect(result.text).toBe("")
    })

    it("part:/publisher:/tags:/secondaryAuthors: tokens carry their value through verbatim as 'contains'", () => {
        const result = parseFacetQuery("part:violin publisher:schirmer tags:recital secondaryAuthors:kreisler")
        expect(result.criteria).toMatchObject({
            part: { op: "contains", value: "violin" },
            publisher: { op: "contains", value: "schirmer" },
            tags: { op: "contains", value: "recital" },
            secondaryAuthors: { op: "contains", value: "kreisler" }
        })
        expect(result.text).toBe("")
    })

    it("an unrecognized or malformed token falls through to the free-text query rather than being dropped", () => {
        const result = parseFacetQuery("key:not-a-key year:abc violin")
        expect(result.hasCriteria).toBe(false)
        expect(result.text).toBe("key:not-a-key year:abc violin")
    })

    it("mixes recognized tokens with leftover free text", () => {
        const result = parseFacetQuery("year:>=1700 violin sonata")
        expect(result.criteria.year).toEqual({ op: "atLeast", value: 1700 })
        expect(result.text).toBe("violin sonata")
        expect(result.hasCriteria).toBe(true)
    })
})

describe("ADVANCED_FIELDS", () => {
    it("gives every select-control field an options list, including an 'Any' entry", () => {
        for (const field of ADVANCED_FIELDS) {
            if (field.control !== "select") continue
            expect(field.options?.[0]).toEqual({ label: "Any", value: "" })
        }
    })

    it("every select-control field is backed by a nullable FacetEntry property, so all get a '(None)' entry", () => {
        for (const field of ADVANCED_FIELDS) {
            if (field.control !== "select") continue
            // (None) sits LAST, below the real values — it moved there from position 1 when the dropdowns
            // were reordered; the invariant is that it is present, not where it sits among the values
            expect(field.options?.[field.options.length - 1]).toEqual({ label: "(None)", value: NONE_VALUE })
        }
    })

    it("gives every text/number field an operators list, with no operators for select fields", () => {
        for (const field of ADVANCED_FIELDS) {
            if (field.control === "select") {
                expect(field.operators).toBeUndefined()
            } else {
                expect(field.operators?.length).toBeGreaterThan(0)
            }
        }
    })

    it("does not include a 'noun' entry — entity type is its own checkbox group, not an ADVANCED_FIELDS control", () => {
        expect(ADVANCED_FIELDS.some((field) => field.param === "noun")).toBe(false)
    })

    it("param names are unique (each is also the URLSearchParams/form key)", () => {
        const params = ADVANCED_FIELDS.map((field) => field.param)
        expect(new Set(params).size).toBe(params.length)
    })
})
