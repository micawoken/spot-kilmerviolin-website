/**
 * tests/format.test.ts
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
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

import { describe, expect, it } from "vitest"

import { countryCodeName, formatDeathYear, formatInfoValue, formatLifespan } from "../src/scripts/format"

describe("formatDeathYear", () => {
    it("converts the -1 living sentinel to Present", () => {
        expect(formatDeathYear(-1)).toBe("Present")
    })

    it("renders any other year as its own string", () => {
        expect(formatDeathYear(1750)).toBe("1750")
    })
})

describe("formatLifespan", () => {
    it("joins birth and death years with an en dash", () => {
        expect(formatLifespan(1685, 1750)).toBe("1685–1750")
    })

    it("renders a living composer's death year as Present", () => {
        expect(formatLifespan(1946, -1)).toBe("1946–Present")
    })
})

describe("formatInfoValue — composer death_year/country special cases (mirrors ComposerInfo SSR view)", () => {
    it("converts a living composer's death_year to Present", () => {
        expect(formatInfoValue("composer", "death_year", -1, false)).toBe("Present")
    })

    it("renders a non-living death_year as its own value", () => {
        expect(formatInfoValue("composer", "death_year", 1750, false)).toBe("1750")
    })

    it("converts a composer's country code to its display name", () => {
        expect(formatInfoValue("composer", "country", "DE", false)).toBe(countryCodeName("DE"))
    })
})
