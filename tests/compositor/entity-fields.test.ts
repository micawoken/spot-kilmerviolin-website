/**
 * tests/compositor/entity-fields.test.ts
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

import { OUTLET_PROPS } from "../../src/lib/compositor/catalog"
import { ENTITY_NOUNS, entityFields, isEntityNoun } from "../../src/lib/compositor/entity-fields"

describe("ENTITY_NOUNS / isEntityNoun", () => {
    it("recognizes exactly the three D1-backed entity types", () => {
        expect(ENTITY_NOUNS).toEqual(["composer", "composition", "contributor"])
        for (const noun of ENTITY_NOUNS) expect(isEntityNoun(noun)).toBe(true)
    })

    it("rejects EmDash collection slugs and arbitrary strings", () => {
        expect(isEntityNoun("pages")).toBe(false)
        expect(isEntityNoun("posts")).toBe(false)
        expect(isEntityNoun("")).toBe(false)
    })
})

describe("entityFields", () => {
    it("gives composer and contributor name/bio/image, all types OUTLET_PROPS already accepts", () => {
        for (const noun of ["composer", "contributor"] as const) {
            const fields = entityFields(noun)
            expect(fields.map((f) => f.slug)).toEqual(["name", "bio", "image"])
            for (const f of fields) {
                const accepted = Object.values(OUTLET_PROPS).flat()
                expect(accepted).toContain(f.type)
            }
        }
    })

    it("gives composition only name/image — its other fields render through CompositionDetail, not loose outlets", () => {
        const fields = entityFields("composition")
        expect(fields.map((f) => f.slug)).toEqual(["name", "image"])
    })

    it("never offers a portableText field — D1 bios are plain TEXT, so ContentRichText never applies", () => {
        for (const noun of ENTITY_NOUNS) {
            expect(entityFields(noun).some((f) => f.type === "portableText")).toBe(false)
        }
    })
})
