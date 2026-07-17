/**
 * tests/compositor/composition-fields.test.ts
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
 *
 * This license is also subject to additional terms as specified in the README.md.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, expect, it } from "vitest"

import { displayValue, entityHref } from "../../src/lib/compositor/composition-fields"

describe("displayValue", () => {
    it("falls back to the placeholder for null, undefined, blank, and empty-array values", () => {
        expect(displayValue(null, "placeholder")).toBe("placeholder")
        expect(displayValue(undefined, "placeholder")).toBe("placeholder")
        expect(displayValue("   ", "placeholder")).toBe("placeholder")
        expect(displayValue([], "placeholder")).toBe("placeholder")
    })

    it("joins a non-empty array with commas", () => {
        expect(displayValue(["a", "b", "c"], "placeholder")).toBe("a, b, c")
    })

    it("renders a boolean as Yes/No", () => {
        expect(displayValue(true, "placeholder")).toBe("Yes")
        expect(displayValue(false, "placeholder")).toBe("No")
    })

    it("stringifies any other present value", () => {
        expect(displayValue(42, "placeholder")).toBe("42")
        expect(displayValue("hello", "placeholder")).toBe("hello")
    })
})

describe("entityHref", () => {
    it("builds the public /entity/{noun}/{id} route, not the admin info-page route", () => {
        expect(entityHref("composer", 12)).toBe("/entity/composer/12")
        expect(entityHref("contributor", 7)).toBe("/entity/contributor/7")
        expect(entityHref("composition", 3)).toBe("/entity/composition/3")
    })
})
