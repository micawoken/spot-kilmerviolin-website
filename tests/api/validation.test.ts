/**
 * tests/api/validation.test.ts
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

import { describe, it, expect } from "vitest"

import {
    classifyCitationValue,
    isValidPitchRange,
    validateAltText,
    validateCitations
} from "../../src/lib/api/validation"
import { MAX_ALT_TEXT_LENGTH } from "../../src/consts"

describe("validateAltText", () => {
    it("accepts a non-empty value within the length limit", () => {
        expect(validateAltText("A violin scroll")).toBeNull()
    })

    it("rejects an empty value", () => {
        expect(validateAltText("")).toBe("Alt text is required")
    })

    it("accepts a value exactly at the length limit", () => {
        expect(validateAltText("x".repeat(MAX_ALT_TEXT_LENGTH))).toBeNull()
    })

    it("rejects a value over the length limit", () => {
        const error = validateAltText("x".repeat(MAX_ALT_TEXT_LENGTH + 1))
        expect(error).toContain(String(MAX_ALT_TEXT_LENGTH))
    })
})

describe("isValidPitchRange", () => {
    it("accepts a range where the low note's octave is below the high note's", () => {
        expect(isValidPitchRange("G3-A5")).toBe(true)
    })

    it("rejects a range where the low note's octave is above the high note's", () => {
        expect(isValidPitchRange("A5-G3")).toBe(false)
    })

    it("accepts a same-octave range where the low note's pitch class is below the high note's", () => {
        expect(isValidPitchRange("C4-G4")).toBe(true)
    })

    it("rejects a same-octave range where the low note's pitch class is above the high note's", () => {
        expect(isValidPitchRange("G4-C4")).toBe(false)
    })

    it("rejects a range of two identical notes (not strictly ascending)", () => {
        expect(isValidPitchRange("G3-G3")).toBe(false)
    })

    it("rejects a same-octave, same-pitch-class enharmonic tie", () => {
        expect(isValidPitchRange("C#3-Db3")).toBe(false)
    })

    it("accepts an accidental correctly narrowing a same-letter, same-octave range", () => {
        expect(isValidPitchRange("Gb3-G3")).toBe(true)
        expect(isValidPitchRange("G3-G#3")).toBe(true)
    })

    it("rejects a structurally malformed range regardless of note order", () => {
        expect(isValidPitchRange("not a range")).toBe(false)
        expect(isValidPitchRange("")).toBe(false)
    })
})

// a checksum-valid ISBN-13 (a commonly used reference example, not tied to any real work)
const VALID_ISBN = "9780306406157"
const VALID_DOI = "10.1000/182"
const VALID_HTTPS = "https://imslp.org/wiki/Category:Bach,_Johann_Sebastian"

describe("classifyCitationValue", () => {
    it("classifies an https URL", () => {
        expect(classifyCitationValue(VALID_HTTPS)).toBe("https")
    })

    it("classifies a DOI", () => {
        expect(classifyCitationValue(VALID_DOI)).toBe("doi")
    })

    it("classifies a checksum-valid ISBN", () => {
        expect(classifyCitationValue(VALID_ISBN)).toBe("isbn")
    })

    it("returns null for a value matching none of the three formats", () => {
        expect(classifyCitationValue("not a citation")).toBeNull()
        expect(classifyCitationValue("")).toBeNull()
    })

    it("rejects a plain http URL (https-only, mirrors isValidImageUrl's policy)", () => {
        expect(classifyCitationValue("http://example.com")).toBeNull()
    })
})

describe("validateCitations", () => {
    it("accepts an empty object (citations are optional)", () => {
        expect(validateCitations({})).toBeNull()
    })

    it("accepts a well-formed map of mixed value types", () => {
        expect(
            validateCitations({
                IMSLP: VALID_HTTPS,
                "Grove Music Online": VALID_DOI,
                "A Reference Book": VALID_ISBN
            })
        ).toBeNull()
    })

    it("rejects a non-object value", () => {
        expect(validateCitations("not an object")).toBe("Citations must be a key-value object")
        expect(validateCitations(["array", "not", "object"])).toBe("Citations must be a key-value object")
        expect(validateCitations(null)).toBe("Citations must be a key-value object")
    })

    it("rejects a blank source name", () => {
        expect(validateCitations({ "  ": VALID_HTTPS })).toBe("A citation's source name cannot be blank")
    })

    it("rejects a value that is not an https link, DOI, or ISBN", () => {
        const error = validateCitations({ IMSLP: "not-a-real-value" })
        expect(error).toContain("IMSLP")
    })
})
