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

import { validateAltText } from "../../src/lib/api/validation"
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
