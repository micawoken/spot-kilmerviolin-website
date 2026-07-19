/**
 * tests/compositor/entity-fields.test.ts
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

import { describe, expect, it } from "vitest"

import { OUTLET_PROPS } from "../../src/lib/compositor/catalog"
import {
    ENTITY_NOUNS,
    entityFields,
    isEmptyFieldValue,
    isEntityNoun,
    type EntityFieldKind
} from "../../src/lib/compositor/entity-fields"

const KINDS: readonly EntityFieldKind[] = [
    "string",
    "text",
    "number",
    "date",
    "reference",
    "referenceList",
    "list",
    "image",
    "uri",
    "yearOrLiving",
    "countryCode",
    "email",
    "titleCase"
]

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

describe("entityFields — unified field-outlet rewrite: every meaningful column is bindable", () => {
    it("gives composer every content column, none of them the redacted/internal set", () => {
        const fields = entityFields("composer")
        expect(fields.map((f) => f.slug)).toEqual([
            "name",
            "role",
            "birth_year",
            "death_year",
            "country",
            "life_span",
            "bio",
            "image",
            "tags",
            "entry_date",
            "change_date"
        ])
    })

    it("declares death_year/country/life_span/role with their special-formatting kinds", () => {
        const bySlug = Object.fromEntries(entityFields("composer").map((f) => [f.slug, f]))
        expect(bySlug.death_year.type).toBe("yearOrLiving")
        expect(bySlug.country.type).toBe("countryCode")
        expect(bySlug.life_span.type).toBe("string")
        expect(bySlug.role.type).toBe("titleCase")
    })

    it("gives contributor every content column, omitting active/roles/admin/identity_email", () => {
        const fields = entityFields("contributor")
        const slugs = fields.map((f) => f.slug)
        expect(slugs).toEqual([
            "name",
            "class_year",
            "major",
            "bio",
            "public_email",
            "image",
            "tags",
            "entry_date",
            "change_date"
        ])
        // The redaction set (d1-schema.ts's CONTRIBUTOR_SCHEMA.protected) must never be bindable — those
        // columns are stripped from the record before the build even sees them.
        for (const redacted of ["roles", "admin", "identity_email", "active"]) {
            expect(slugs).not.toContain(redacted)
        }
        expect(fields.find((f) => f.slug === "public_email")?.type).toBe("email")
    })

    it("gives composition every content column, with foreign keys declared as reference/referenceList — never a raw id", () => {
        const fields = entityFields("composition")
        const bySlug = Object.fromEntries(fields.map((f) => [f.slug, f]))

        expect(bySlug.composer).toMatchObject({ type: "reference", refNoun: "composer" })
        expect(bySlug.author_secondary).toMatchObject({ type: "referenceList", refNoun: "composer" })
        expect(bySlug.contrib_primary_1).toMatchObject({ type: "reference", refNoun: "contributor" })
        expect(bySlug.contrib_primary_2).toMatchObject({ type: "reference", refNoun: "contributor" })
        expect(bySlug.contrib_addl).toMatchObject({ type: "referenceList", refNoun: "contributor" })
        // Combined single-line alternative to the three fields above (owner decision) — additive, not a
        // replacement, so an already-authored template binding them individually keeps working.
        expect(bySlug.contributors).toMatchObject({ type: "referenceList", refNoun: "contributor" })

        // No raw *_id column is ever separately bindable — only the resolved reference field is.
        for (const rawId of ["composer_id"]) {
            expect(fields.some((f) => f.slug === rawId)).toBe(false)
        }

        expect(bySlug.publication_uri.type).toBe("uri")
        expect(bySlug.phases.type).toBe("list")
        expect(bySlug.tags.type).toBe("list")
        expect(bySlug.entry_date.type).toBe("date")
        expect(bySlug.change_date.type).toBe("date")
        expect(bySlug.rating_suzuki.type).toBe("number")
        expect(bySlug.rating_nyssma.type).toBe("number")
    })

    it("every field's type is in the closed EntityFieldKind vocabulary", () => {
        for (const noun of ENTITY_NOUNS) {
            for (const field of entityFields(noun)) {
                expect(KINDS).toContain(field.type)
            }
        }
    })

    it("only reference/referenceList fields declare refNoun", () => {
        for (const noun of ENTITY_NOUNS) {
            for (const field of entityFields(noun)) {
                if (field.type === "reference" || field.type === "referenceList") {
                    expect(field.refNoun).toBeDefined()
                } else {
                    expect(field.refNoun).toBeUndefined()
                }
            }
        }
    })

    it("string/text/image fields use the exact vocabulary OUTLET_PROPS.ContentText/ContentImage already accept", () => {
        // ContentText/ContentImage are unmodified by the unified rewrite — they must keep working against
        // entity fields without a catalog change, which only holds if these three kinds reuse the same
        // strings those two outlets' OUTLET_PROPS entries were already written against.
        for (const noun of ENTITY_NOUNS) {
            for (const field of entityFields(noun)) {
                if (field.type === "string" || field.type === "text") {
                    expect(OUTLET_PROPS.ContentText).toContain(field.type)
                }
                if (field.type === "image") {
                    expect(OUTLET_PROPS.ContentImage).toContain(field.type)
                }
            }
        }
    })

    it("every non-image field type is accepted by ContentField — the workhorse for entity data", () => {
        for (const noun of ENTITY_NOUNS) {
            for (const field of entityFields(noun)) {
                if (field.type === "image") continue
                expect(OUTLET_PROPS.ContentField).toContain(field.type)
            }
        }
    })
})

describe("isEmptyFieldValue — shared by lint.ts and catalog.tsx's ContentField onEmpty control", () => {
    it("treats null/undefined as empty regardless of kind", () => {
        expect(isEmptyFieldValue(null, "string")).toBe(true)
        expect(isEmptyFieldValue(undefined, "yearOrLiving")).toBe(true)
    })

    it("a yearOrLiving value is empty only when it is not a number — -1 (living) counts as present", () => {
        expect(isEmptyFieldValue(-1, "yearOrLiving")).toBe(false)
        expect(isEmptyFieldValue(1750, "yearOrLiving")).toBe(false)
        expect(isEmptyFieldValue("1750", "yearOrLiving")).toBe(true)
    })

    it("a countryCode value follows the plain-string emptiness rule", () => {
        expect(isEmptyFieldValue("DE", "countryCode")).toBe(false)
        expect(isEmptyFieldValue("  ", "countryCode")).toBe(true)
        expect(isEmptyFieldValue("", "countryCode")).toBe(true)
    })
})
