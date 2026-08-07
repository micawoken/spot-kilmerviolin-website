/**
 * tests/api/d1-sanitize.test.ts
 *
 * Unit tests for the write-time sanitization wired into lib/api/d1.ts's record validators
 * (sanitizeContributorFields / sanitizeCompositionFields — sanitizeComposerFields is covered alongside the
 * rest of composers.test.ts). These run on every write path (single-record admin forms, bulk import,
 * direct API), not just the CSV import pipeline.
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

/// <reference path="../../src/lib/api/types.d.ts" />

import { describe, it, expect } from "vitest"

import {
    _stateTypeAssertCompleteContributor,
    _stateTypeAssertCompleteComposition
} from "../../src/lib/api/d1.ts"

function makeContributor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name: "Test Contributor",
        class_year: 2026,
        major: "Music",
        phases: [1],
        bio: "A test contributor.",
        public_email: "pub@example.com",
        identity_email: "test-contributor@example.com",
        active: false,
        admin: false,
        roles: [],
        image: null,
        ...overrides
    }
}

function makeComposition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name: "Test Work",
        composer_id: 1,
        contrib_primary_1: 1,
        contrib_primary_2: null,
        contrib_addl: [],
        author_secondary: [],
        phases: [],
        type: "Chamber",
        part: null,
        key: null,
        range: null,
        position_highest: null,
        notes_pedagogical: null,
        notes_historical: null,
        notes_other: null,
        image: null,
        rating: { suzuki: null, nyssma: null },
        publication_info: { name: "", location: "", year: 2000, uri_type: "https", uri: "" },
        ...overrides
    }
}

describe("contributor write-time sanitization", () => {
    it("trims and strips control characters from name/bio/major", () => {
        const nullByte = String.fromCharCode(0)
        const record = makeContributor({ name: "  Sanitized Contributor  ", bio: `  A ${nullByte}bio.  `, major: "  Music  " })
        _stateTypeAssertCompleteContributor(record, false)
        expect(record.name).toBe("Sanitized Contributor")
        expect(record.bio).toBe("A bio.")
        expect(record.major).toBe("Music")
    })

    it("dedupes tags case-insensitively and trims each one", () => {
        const record = makeContributor({ tags: [" Violin ", "violin", "Advanced"] })
        _stateTypeAssertCompleteContributor(record, false)
        expect(record.tags).toEqual(["Violin", "Advanced"])
    })

    it("rejects too many distinct tags", () => {
        const tags = Array.from({ length: 26 }, (_, i) => `tag${i}`)
        expect(_stateTypeAssertCompleteContributor(makeContributor({ tags }), false)).toBeTypeOf("string")
    })

    it("only trims roles — no dedup or case change, since roles is permission-adjacent", () => {
        const record = makeContributor({ roles: ["  President  ", "president"] })
        _stateTypeAssertCompleteContributor(record, false)
        expect(record.roles).toEqual(["President", "president"])
    })
})

describe("composition write-time sanitization", () => {
    it("trims and strips control characters from name/part/notes", () => {
        const nullByte = String.fromCharCode(0)
        const record = makeComposition({
            name: "  Sanitized Work  ",
            part: "  I. Allegro  ",
            notes_pedagogical: `  Good for ${nullByte}beginners.  `
        })
        _stateTypeAssertCompleteComposition(record, false)
        expect(record.name).toBe("Sanitized Work")
        expect(record.part).toBe("I. Allegro")
        expect(record.notes_pedagogical).toBe("Good for beginners.")
    })

    it("case-unifies type against the WorkType enum", () => {
        const record = makeComposition({ type: "chamber" })
        _stateTypeAssertCompleteComposition(record, false)
        expect(record.type).toBe("Chamber")
    })

    it("case-unifies key against the Key enum", () => {
        const record = makeComposition({ key: "c major" })
        _stateTypeAssertCompleteComposition(record, false)
        expect(record.key).toBe("C Major")
    })

    it("rejects notes exceeding the max length", () => {
        expect(
            _stateTypeAssertCompleteComposition(makeComposition({ notes_historical: "x".repeat(5001) }), false)
        ).toBeTypeOf("string")
    })

    it("prefers ISBN-13 in publication_info.uri when it is a checksum-valid ISBN-10", () => {
        const record = makeComposition({
            publication_info: { name: "", location: "", year: 2000, uri_type: "isbn", uri: "0-306-40615-2" }
        })
        _stateTypeAssertCompleteComposition(record, false)
        expect((record.publication_info as { uri: string }).uri).toBe("9780306406157")
    })

    it("rejects publish_name/publish_location exceeding the max length", () => {
        const record = makeComposition({
            publication_info: { name: "x".repeat(201), location: "", year: 2000, uri_type: "https", uri: "" }
        })
        expect(_stateTypeAssertCompleteComposition(record, false)).toBeTypeOf("string")
    })
})
