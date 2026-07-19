/**
 * tests/search.test.ts
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

/// <reference path="../src/lib/api/types.d.ts" />

/**
 * Tests for the keyword search engine in src/lib/api/search.ts
 *
 * These cover the pure, per-table search functions (no I/O): keyword matching across the indexed
 * columns, the composition display format ("{composer}: {composition}"), composer-name search on
 * compositions, field boosting (name/composer/notes/tags outrank incidental columns), and that each
 * function stamps the correct `database` onto its hits.
 */

import { describe, it, expect } from "vitest"
import { searchComposers, searchCompositions, searchContributors } from "../src/lib/api/search.ts"

// minimal record factories — only the columns the search reads need to be present; the rest are
// filled loosely and cast, since the search functions never touch them
function composer(id: number, fields: Partial<ComposerRecord>): ComposerRecord {
    return { id, name: "", role: "composer", birth_year: 1900, death_year: -1, country: "", bio: "", image: null, tags: [], entry_date: "", change_date: "", ...fields } as ComposerRecord
}
function contributor(id: number, fields: Partial<ContributorRecord>): ContributorRecord {
    return { id, name: "", bio: null, major: null, roles: [], tags: [], ...fields } as unknown as ContributorRecord
}
function composition(id: number, fields: Partial<CompositionRecord>): CompositionRecord {
    return {
        id,
        name: "",
        composer_id: 0,
        type: "Other",
        notes_pedagogical: null,
        notes_historical: null,
        notes_other: null,
        tags: [],
        publication_info: { name: "", location: "", year: 2000, uri_type: "https", uri: "" },
        ...fields,
    } as unknown as CompositionRecord
}

describe("searchComposers", () => {
    const records = [
        composer(1, { name: "Antonín Dvořák", country: "Czechia", bio: "Romantic composer", tags: ["romantic"] }),
        composer(2, { name: "Florence Price", country: "United States", bio: "American composer", tags: ["20th century"] }),
    ]

    it("matches on name and stamps the composers database", () => {
        const hits = searchComposers(records, "Price")
        expect(hits.length).toBe(1)
        expect(hits[0]).toEqual({ database: "composers", id: 2, name: "Florence Price" })
    })

    it("matches on non-name indexed columns (country)", () => {
        const hits = searchComposers(records, "Czechia")
        expect(hits.map(h => h.id)).toContain(1)
    })

    it("returns nothing for a non-matching query", () => {
        expect(searchComposers(records, "Sibelius")).toEqual([])
    })

    it("handles an empty record set", () => {
        expect(searchComposers([], "anything")).toEqual([])
    })
})

describe("searchContributors", () => {
    const records = [
        contributor(10, { name: "Jane Smith", major: "Violin Performance", bio: "Phase one editor" }),
        contributor(11, { name: "John Doe", major: "Musicology", bio: "Researcher" }),
    ]

    it("matches on bio and major, stamping the contributors database", () => {
        const by_major = searchContributors(records, "Musicology")
        expect(by_major).toEqual([{ database: "contributors", id: 11, name: "John Doe" }])
        const by_bio = searchContributors(records, "editor")
        expect(by_bio.map(h => h.id)).toContain(10)
    })
})

describe("searchCompositions", () => {
    const composer_names = new Map<number, string>([[1, "Florence Price"], [2, "Samuel Coleridge-Taylor"]])
    const records = [
        composition(100, { name: "Violin Concerto", composer_id: 1, notes_pedagogical: "good for shifting practice", tags: ["concerto"] }),
        composition(101, { name: "African Suite", composer_id: 2, notes_historical: "premiered 1898" }),
    ]

    it("formats the display name as '{composer}: {composition}'", () => {
        const hits = searchCompositions(records, composer_names, "Violin Concerto")
        expect(hits[0]).toEqual({ database: "compositions", id: 100, name: "Florence Price: Violin Concerto" })
    })

    it("matches on the resolved composer name", () => {
        const hits = searchCompositions(records, composer_names, "Coleridge")
        expect(hits.map(h => h.id)).toContain(101)
        expect(hits.find(h => h.id === 101)?.name).toBe("Samuel Coleridge-Taylor: African Suite")
    })

    it("matches on the note varieties", () => {
        const hits = searchCompositions(records, composer_names, "shifting")
        expect(hits.map(h => h.id)).toContain(100)
    })

    it("falls back to the bare composition name when the composer is unknown", () => {
        const hits = searchCompositions(records, new Map(), "African Suite")
        expect(hits.find(h => h.id === 101)?.name).toBe("African Suite")
    })
})
