/**
 * tests/scripts/common.test.ts
 *
 * Covers the new citations surface added to scripts/common.ts; does not attempt full coverage of the
 * pre-existing argParse/FIELD_VALIDATORS machinery.
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

import { argParse, validateCitationsField } from "../../src/scripts/common"

describe("argParse — citations type", () => {
    it("parses a 'Source Name: value' textarea into a citations object", () => {
        const raw = "IMSLP: https://imslp.org/wiki/Test"
        expect(argParse("citations", "citations", raw)).toEqual({ IMSLP: "https://imslp.org/wiki/Test" })
    })

    it("parses blank input to an empty object", () => {
        expect(argParse("citations", "citations", "")).toEqual({})
    })
})

describe("validateCitationsField", () => {
    // FieldValidator's second (form) parameter is unused by this validator; omitted here since this
    // environment has no DOM to construct a real HTMLFormElement
    const validate = (raw: string) => validateCitationsField(raw, undefined as never)

    it("accepts blank input", () => {
        expect(validate("")).toBeNull()
    })

    it("accepts a well-formed multi-line entry", () => {
        expect(validate("IMSLP: https://imslp.org/wiki/Test\nDOI Example: 10.1000/182")).toBeNull()
    })

    it("flags a line with no colon", () => {
        const error = validate("no colon here")
        expect(error).toContain(":")
    })

    it("flags a line with a blank source name", () => {
        const error = validate(": https://example.com")
        expect(error).toContain("source name")
    })

    it("flags a value that is not an https link, DOI, or ISBN", () => {
        const error = validate("IMSLP: not-a-real-value")
        expect(error).toContain("not-a-real-value")
    })
})
