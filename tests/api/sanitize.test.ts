/**
 * tests/api/sanitize.test.ts
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
    stripControlCharacters,
    cleanText,
    collapseDoubleSpaces,
    toTitleCase,
    escapeRegExp,
    normalizeUnicodeForm,
    canonicalEnumValue,
    sanitizeTags,
    isbn10To13,
    preferIsbn13,
    extractLeadingInt,
    extractFirstMatch,
    extractFirstValidToken,
    respellDoubleAccidental,
    cleanPitchRangeCell,
    inferUriType
} from "../../src/lib/api/sanitize"
import { isValidPosition } from "../../src/lib/api/validation"

describe("stripControlCharacters", () => {
    it("removes a null byte and other C0 controls but keeps tab/newline/CR", () => {
        const nullByte = String.fromCharCode(0)
        const input = "a" + nullByte + "bc\td\ne\rf"
        expect(stripControlCharacters(input)).toBe("abc\td\ne\rf")
    })

    it("removes DEL and C1 control characters", () => {
        const del = String.fromCharCode(0x7f)
        const c1 = String.fromCharCode(0x9f)
        expect(stripControlCharacters("x" + del + "y" + c1 + "z")).toBe("xyz")
    })

    it("leaves ordinary text untouched", () => {
        expect(stripControlCharacters("Dvorak Symphony No. 9")).toBe("Dvorak Symphony No. 9")
    })
})

describe("cleanText", () => {
    it("strips control characters and trims whitespace", () => {
        expect(cleanText("  hello world  ")).toBe("hello world")
    })
})

describe("collapseDoubleSpaces", () => {
    it("collapses a run of exactly two spaces to one", () => {
        expect(collapseDoubleSpaces("hello  world")).toBe("hello world")
    })

    it("leaves runs of three or more spaces untouched", () => {
        expect(collapseDoubleSpaces("hello   world")).toBe("hello   world")
        expect(collapseDoubleSpaces("hello    world")).toBe("hello    world")
    })

    it("leaves single spaces untouched", () => {
        expect(collapseDoubleSpaces("hello world")).toBe("hello world")
    })
})

describe("toTitleCase", () => {
    it("uppercases the first letter of each word only", () => {
        expect(toTitleCase("eb minor")).toBe("Eb Minor")
        expect(toTitleCase("c# major")).toBe("C# Major")
    })
})

describe("escapeRegExp", () => {
    it("escapes regex metacharacters so the string matches literally", () => {
        const escaped = escapeRegExp("C# Major (approx)")
        expect(new RegExp(escaped).test("C# Major (approx)")).toBe(true)
        expect(escaped).not.toBe("C# Major (approx)")
    })
})

describe("normalizeUnicodeForm", () => {
    it("normalizes a decomposed accented character to its precomposed form", () => {
        const combiningAcuteAccent = String.fromCharCode(0x0301)
        const decomposed = "e" + combiningAcuteAccent
        const precomposed = String.fromCharCode(0xe9) // e-acute
        expect(decomposed).not.toBe(precomposed) // sanity check: the two source forms really do differ
        expect(normalizeUnicodeForm(decomposed)).toBe(precomposed)
        expect(normalizeUnicodeForm(decomposed)).toBe(normalizeUnicodeForm(precomposed))
    })
})

describe("canonicalEnumValue", () => {
    const members = ["Chamber", "Full Orchestra"] as const

    it("matches case-insensitively and returns the canonical casing", () => {
        expect(canonicalEnumValue("chamber", members)).toBe("Chamber")
        expect(canonicalEnumValue("FULL ORCHESTRA", members)).toBe("Full Orchestra")
    })

    it("returns null when nothing matches", () => {
        expect(canonicalEnumValue("Solo", members)).toBeNull()
    })
})

describe("sanitizeTags", () => {
    it("trims, drops blanks, and case-insensitively dedupes (first-seen casing wins)", () => {
        const result = sanitizeTags([" Violin ", "violin", "", "  ", "Advanced"], 50, 25)
        expect(result).toEqual({ tags: ["Violin", "Advanced"], error: null })
    })

    it("rejects a tag longer than the max length", () => {
        const result = sanitizeTags(["x".repeat(51)], 50, 25)
        expect(result.error).toMatch(/exceeds 50 characters/)
    })

    it("rejects too many distinct tags", () => {
        const tags = Array.from({ length: 26 }, (_, i) => `tag${i}`)
        const result = sanitizeTags(tags, 50, 25)
        expect(result.error).toMatch(/too many tags/)
    })
})

describe("isbn10To13 / preferIsbn13", () => {
    it("converts a valid ISBN-10 to ISBN-13", () => {
        // "0-306-40615-2" is a well-known valid ISBN-10 test value
        expect(isbn10To13("0-306-40615-2")).toBe("9780306406157")
    })

    it("returns null for an already-13-digit or invalid value", () => {
        expect(isbn10To13("9780306406157")).toBeNull()
        expect(isbn10To13("not an isbn")).toBeNull()
    })

    it("prefers the ISBN-13 form but passes through anything it can't convert", () => {
        expect(preferIsbn13("0-306-40615-2")).toBe("9780306406157")
        expect(preferIsbn13("9780306406157")).toBe("9780306406157")
        expect(preferIsbn13("garbage")).toBe("garbage")
    })
})

describe("extractLeadingInt", () => {
    it("extracts the first run of digits from surrounding text", () => {
        expect(extractLeadingInt("c. 1923")).toBe(1923)
        expect(extractLeadingInt("(1923?)")).toBe(1923)
        expect(extractLeadingInt("Level 5 stars")).toBe(5)
    })

    it("returns null when no digits are present", () => {
        expect(extractLeadingInt("unknown")).toBeNull()
    })
})

describe("extractFirstMatch", () => {
    it("finds the first substring matching an arbitrary pattern", () => {
        expect(extractFirstMatch("in c minor, transposed", /c minor|c major/i)).toBe("c minor")
    })

    it("returns null when nothing matches", () => {
        expect(extractFirstMatch("unclear", /c minor|c major/i)).toBeNull()
    })
})

describe("extractFirstValidToken", () => {
    it("finds the first whole token satisfying the predicate", () => {
        expect(extractFirstValidToken("Position III (approx)", isValidPosition)).toBe("III")
        expect(extractFirstValidToken("around position 5", isValidPosition)).toBe("5")
    })

    it("does not spuriously match a letter embedded in an unrelated word", () => {
        // "Position" contains an "I" as a substring, but isValidPosition must not fire on the whole word
        expect(extractFirstValidToken("Position unclear", isValidPosition)).toBeNull()
    })
})

describe("respellDoubleAccidental", () => {
    it("respells a double sharp as the next diatonic letter", () => {
        expect(respellDoubleAccidental("Fx3")).toBe("G3")
        expect(respellDoubleAccidental("ex3")).toBe("F#3")
    })

    it("respells a double flat as the previous diatonic letter", () => {
        expect(respellDoubleAccidental("Fbb3")).toBe("Eb3")
        expect(respellDoubleAccidental("Dbb4")).toBe("C4")
    })

    it("carries the octave across the B/C boundary", () => {
        expect(respellDoubleAccidental("Bx3")).toBe("C#4")
        expect(respellDoubleAccidental("Cbb4")).toBe("Bb3")
    })

    it("returns null for a non-double-accidental note", () => {
        expect(respellDoubleAccidental("G3")).toBeNull()
        expect(respellDoubleAccidental("F#3")).toBeNull()
    })
})

describe("cleanPitchRangeCell", () => {
    it("trims whitespace around the dash and each component", () => {
        expect(cleanPitchRangeCell(" g3 - a5 ")).toBe("G3-A5")
    })

    it("respells a double-accidental component", () => {
        expect(cleanPitchRangeCell("Fx3-A5")).toBe("G3-A5")
    })
})

describe("inferUriType", () => {
    it("infers https, doi, and isbn from shape", () => {
        expect(inferUriType("https://example.com")).toBe("https")
        expect(inferUriType("10.1000/xyz123")).toBe("doi")
        expect(inferUriType("0-306-40615-2")).toBe("isbn")
    })

    it("returns null for an unrecognized shape", () => {
        expect(inferUriType("not a uri")).toBeNull()
    })
})
