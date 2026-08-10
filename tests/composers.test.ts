/**
 * Tests the API endpoint functions
 *
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

/// <reference path="../src/lib/api/types.d.ts" />

import { describe, it, expect } from "vitest"

import { _stateTypeAssertCompleteComposer, _stateTypeAssertPartialComposer } from "../src/lib/api/composer.ts"

// a complete, otherwise-valid composer record (no id, as on create); overrides tweak individual fields
function makeComposer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name: "Test Composer",
        role: "composer",
        birth_year: 1900,
        death_year: 1950,
        country: "US",
        bio: "A test composer.",
        image: null,
        ...overrides
    }
}

// the cross-field rule added to the composer validators: death_year must be on or after birth_year, unless
// it is the -1 "still living" sentinel (mirrors isDeathYearConsistent, shared with the client-side form)
describe("composer birth/death year consistency", () => {
    it("accepts a death year after the birth year", () => {
        expect(_stateTypeAssertCompleteComposer(makeComposer(), false)).not.toBeTypeOf("string")
    })

    it("accepts a death year equal to the birth year", () => {
        expect(_stateTypeAssertCompleteComposer(makeComposer({ birth_year: 1900, death_year: 1900 }), false)).not.toBeTypeOf("string")
    })

    it("accepts the -1 living sentinel regardless of birth year", () => {
        expect(_stateTypeAssertCompleteComposer(makeComposer({ birth_year: 2000, death_year: -1 }), false)).not.toBeTypeOf("string")
    })

    it("rejects a death year before the birth year", () => {
        expect(_stateTypeAssertCompleteComposer(makeComposer({ birth_year: 1950, death_year: 1900 }), false)).toBeTypeOf("string")
    })

    it("rejects an out-of-order pair in a partial update carrying both years", () => {
        expect(_stateTypeAssertPartialComposer({ birth_year: 1950, death_year: 1900 }, false)).toBeTypeOf("string")
    })

    it("accepts a partial update that touches only the death year (no birth year to compare)", () => {
        expect(_stateTypeAssertPartialComposer({ death_year: 1800 }, false)).not.toBeTypeOf("string")
    })
})

// citations is optional: a complete-mode create must still pass with the field entirely absent (this is
// the case assertRecordBySpec's complete-mode loop does NOT auto-skip an undefined field for — the base
// check must explicitly tolerate it, see _invalidOptionalObject in d1.ts)
describe("composer citations validation", () => {
    it("a complete create with no citations key passes", () => {
        expect(_stateTypeAssertCompleteComposer(makeComposer(), false)).not.toBeTypeOf("string")
    })

    it("a complete create with citations: null passes", () => {
        expect(_stateTypeAssertCompleteComposer(makeComposer({ citations: null }), false)).not.toBeTypeOf("string")
    })

    it("accepts an empty citations object", () => {
        expect(_stateTypeAssertCompleteComposer(makeComposer({ citations: {} }), false)).not.toBeTypeOf("string")
    })

    it("accepts a well-formed citations map", () => {
        expect(
            _stateTypeAssertCompleteComposer(
                makeComposer({ citations: { IMSLP: "https://imslp.org/wiki/Test" } }),
                false
            )
        ).not.toBeTypeOf("string")
    })

    it("rejects a citations value that is not an https link, DOI, or ISBN", () => {
        expect(
            _stateTypeAssertCompleteComposer(makeComposer({ citations: { IMSLP: "not-a-real-value" } }), false)
        ).toBeTypeOf("string")
    })

    it("rejects a citations entry with a blank source name", () => {
        expect(
            _stateTypeAssertCompleteComposer(
                makeComposer({ citations: { "  ": "https://imslp.org/wiki/Test" } }),
                false
            )
        ).toBeTypeOf("string")
    })

    it("rejects a non-object citations value", () => {
        expect(_stateTypeAssertCompleteComposer(makeComposer({ citations: "not an object" }), false)).toBeTypeOf(
            "string"
        )
    })

    it("a partial update with no citations key is untouched (field simply absent from the diff)", () => {
        expect(_stateTypeAssertPartialComposer({ name: "Renamed" }, false)).not.toBeTypeOf("string")
    })

    it("a partial update rejects a malformed citations value when present", () => {
        expect(
            _stateTypeAssertPartialComposer({ citations: { IMSLP: "not-a-real-value" } }, false)
        ).toBeTypeOf("string")
    })
})

// write-time sanitization (lib/api/sanitize.ts, wired in via sanitizeComposerFields): general hygiene
// applied to every composer write, not just the CSV import pipeline (see the "both layers" decision)
describe("composer write-time sanitization", () => {
    it("trims and strips control characters from name/bio before validation", () => {
        const nullByte = String.fromCharCode(0)
        const record = makeComposer({ name: "  Sanitized Composer  ", bio: `  A ${nullByte}bio.  ` })
        _stateTypeAssertCompleteComposer(record, false)
        expect(record.name).toBe("Sanitized Composer")
        expect(record.bio).toBe("A bio.")
    })

    it("case-unifies role against the AuthorRole enum", () => {
        const record = makeComposer({ role: "ARRANGER" })
        _stateTypeAssertCompleteComposer(record, false)
        expect(record.role).toBe("arranger")
    })

    it("leaves a non-AuthorRole role as-is (just trimmed) rather than rejecting it", () => {
        const record = makeComposer({ role: "  Ghostwriter  " })
        expect(_stateTypeAssertCompleteComposer(record, false)).not.toBeTypeOf("string")
        expect(record.role).toBe("Ghostwriter")
    })

    it("dedupes tags case-insensitively and trims each one", () => {
        const record = makeComposer({ tags: [" Violin ", "violin", "Advanced"] })
        _stateTypeAssertCompleteComposer(record, false)
        expect(record.tags).toEqual(["Violin", "Advanced"])
    })

    it("a complete create with no tags key still passes (tags is optional)", () => {
        expect(_stateTypeAssertCompleteComposer(makeComposer(), false)).not.toBeTypeOf("string")
    })

    it("rejects a composer with too many distinct tags", () => {
        const tags = Array.from({ length: 26 }, (_, i) => `tag${i}`)
        expect(_stateTypeAssertCompleteComposer(makeComposer({ tags }), false)).toBeTypeOf("string")
    })

    it("rejects a bio exceeding the max length", () => {
        expect(_stateTypeAssertCompleteComposer(makeComposer({ bio: "x".repeat(5001) }), false)).toBeTypeOf("string")
    })

    it("prefers ISBN-13 in citations", () => {
        const record = makeComposer({ citations: { Ref: "0-306-40615-2" } })
        _stateTypeAssertCompleteComposer(record, false)
        expect(record.citations).toEqual({ Ref: "9780306406157" })
    })

    it("normalizes name to NFC so a decomposed spelling is stored in its precomposed form", () => {
        const combiningAcuteAccent = String.fromCharCode(0x0301)
        const eAcutePrecomposed = String.fromCharCode(0xe9)
        const record = makeComposer({ name: "Andre" + combiningAcuteAccent }) // decomposed "e" + combining accent
        _stateTypeAssertCompleteComposer(record, false)
        expect(record.name).toBe("Andr" + eAcutePrecomposed)
    })
})
