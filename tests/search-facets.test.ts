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
    parseFacetParams,
    parseFacetQuery,
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

describe("matchesFacets", () => {
    const work: FacetEntry = {
        url: "/entity/work/1",
        noun: "composition",
        name: "Test Concerto",
        composer: "Johann Sebastian Bach",
        keyRef: "7-minor",
        type: "Chamber",
        year: 1723,
        suzuki: 4,
        nyssma: 5
    }
    const composer: FacetEntry = {
        url: "/entity/composer/1",
        noun: "composer",
        name: "Johann Sebastian Bach",
        country: "DE",
        role: "Primary Author",
        birthYear: 1685,
        deathYear: 1750
    }

    it("matches on an empty criteria object (no filters applied)", () => {
        expect(matchesFacets(work, {})).toBe(true)
    })

    it("noun gates the entry type", () => {
        expect(matchesFacets(work, { noun: "composition" })).toBe(true)
        expect(matchesFacets(work, { noun: "composer" })).toBe(false)
    })

    it("composer/type/role match case-insensitive substrings", () => {
        expect(matchesFacets(work, { composer: "bach" })).toBe(true)
        expect(matchesFacets(work, { composer: "handel" })).toBe(false)
        expect(matchesFacets(work, { type: "cham" })).toBe(true)
        expect(matchesFacets(composer, { role: "primary" })).toBe(true)
    })

    it("country matches either the raw code or the resolved display name", () => {
        expect(matchesFacets(composer, { country: "de" })).toBe(true)
        expect(matchesFacets(composer, { country: "germany" })).toBe(true)
        expect(matchesFacets(composer, { country: "france" })).toBe(false)
    })

    it("keyRef is an exact match", () => {
        expect(matchesFacets(work, { keyRef: "7-minor" })).toBe(true)
        expect(matchesFacets(work, { keyRef: "7-major" })).toBe(false)
    })

    it("year/suzuki/nyssma respect range and minimum bounds, excluding entries missing the field", () => {
        expect(matchesFacets(work, { yearFrom: 1700, yearTo: 1750 })).toBe(true)
        expect(matchesFacets(work, { yearFrom: 1800 })).toBe(false)
        expect(matchesFacets(work, { suzukiMin: 4 })).toBe(true)
        expect(matchesFacets(work, { suzukiMin: 5 })).toBe(false)
        expect(matchesFacets(composer, { suzukiMin: 1 })).toBe(false) // composer entries carry no suzuki field
    })

    it("birthYear/deathYear are exact matches", () => {
        expect(matchesFacets(composer, { birthYear: 1685 })).toBe(true)
        expect(matchesFacets(composer, { birthYear: 1686 })).toBe(false)
        expect(matchesFacets(composer, { deathYear: 1750 })).toBe(true)
    })
})

describe("parseFacetParams / criteriaToParams round-trip", () => {
    it("round-trips every criterion through URLSearchParams", () => {
        const criteria = {
            noun: "composition" as const,
            composer: "Bach",
            keyRef: "7-minor",
            type: "Chamber",
            yearFrom: 1700,
            yearTo: 1750,
            suzukiMin: 4,
            nyssmaMin: 3,
            country: "DE",
            role: "arranger",
            birthYear: 1685,
            deathYear: 1750
        }
        const roundTripped = parseFacetParams(criteriaToParams(criteria))
        expect(roundTripped).toEqual(criteria)
    })

    it("drops blank/absent params rather than emitting empty-string criteria", () => {
        const criteria = parseFacetParams(new URLSearchParams("composer=&yearFrom=1700"))
        expect(criteria).toEqual({ yearFrom: 1700 })
    })

    it("noun params use the public URL slug (work), not the internal noun (composition)", () => {
        const params = criteriaToParams({ noun: "composition" })
        expect(params.get("noun")).toBe("work")
        expect(parseFacetParams(params).noun).toBe("composition")
    })
})

describe("parseFacetQuery", () => {
    it("returns an empty criteria object and the original text for a plain query", () => {
        const result = parseFacetQuery("bach violin")
        expect(result.hasCriteria).toBe(false)
        expect(result.text).toBe("bach violin")
        expect(result.criteria).toEqual({})
    })

    it("noun: token maps the public slug to the internal noun and snaps to database mode", () => {
        const result = parseFacetQuery("noun:work")
        expect(result.criteria.noun).toBe("composition")
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
        expect(parseFacetQuery("year:1700-1750").criteria).toMatchObject({ yearFrom: 1700, yearTo: 1750 })
        expect(parseFacetQuery("year:>=1700").criteria).toMatchObject({ yearFrom: 1700 })
        expect(parseFacetQuery("year:>1700").criteria).toMatchObject({ yearFrom: 1701 })
        expect(parseFacetQuery("year:<=1750").criteria).toMatchObject({ yearTo: 1750 })
        expect(parseFacetQuery("year:<1750").criteria).toMatchObject({ yearTo: 1749 })
        expect(parseFacetQuery("year:1802").criteria).toMatchObject({ yearFrom: 1802, yearTo: 1802 })
    })

    it("suzuki:/nyssma: tokens support a comparison or an exact value, both as a minimum threshold", () => {
        expect(parseFacetQuery("suzuki:>=4").criteria.suzukiMin).toBe(4)
        expect(parseFacetQuery("suzuki:4").criteria.suzukiMin).toBe(4)
        expect(parseFacetQuery("nyssma:>3").criteria.nyssmaMin).toBe(4)
    })

    it("composer:/type:/country:/role: tokens carry their value through verbatim", () => {
        const result = parseFacetQuery("composer:bach type:chamber country:france role:arranger")
        expect(result.criteria).toMatchObject({ composer: "bach", type: "chamber", country: "france", role: "arranger" })
        expect(result.text).toBe("")
    })

    it("an unrecognized or malformed token falls through to the free-text query rather than being dropped", () => {
        const result = parseFacetQuery("key:not-a-key year:abc violin")
        expect(result.hasCriteria).toBe(false)
        expect(result.text).toBe("key:not-a-key year:abc violin")
    })

    it("mixes recognized tokens with leftover free text", () => {
        const result = parseFacetQuery("year:>=1700 violin sonata")
        expect(result.criteria).toMatchObject({ yearFrom: 1700 })
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

    it("param names are unique (each is also the URLSearchParams/form key)", () => {
        const params = ADVANCED_FIELDS.map((field) => field.param)
        expect(new Set(params).size).toBe(params.length)
    })
})
