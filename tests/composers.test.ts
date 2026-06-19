/**
 * Tests the API endpoint functions
 *
 *
 */

/// <reference path="../src/lib/api/types.d.ts" />

import { describe, it, expect } from "vitest"

import { _stateTypeAssertCompleteComposer, _stateTypeAssertPartialComposer } from "../src/lib/api/d1.ts"

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
