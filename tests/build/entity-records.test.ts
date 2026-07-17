/**
 * tests/build/entity-records.test.ts
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

import { formatCompFromD1, formatContribFromD1, formatWorkFromD1 } from "../../src/lib/api/common"
import { entityRecords } from "../../src/lib/build/entity-records"

// Built via the real D1 converters (same fixture shape tests/build/d1-api.test.ts uses), not hand-authored
// record literals — the point is to exercise entityRecords against the actual shapes the readers produce.
const composer: D1Composer = {
    composer_id: 1,
    name: "Bach",
    role: "composer",
    birth_year: 1685,
    death_year: 1750,
    country: "DE",
    bio: "",
    image: null,
    tags: "",
    entry_date: "2026-01-01",
    change_date: "2026-01-01"
}

const contributor: D1Contributor = {
    contributor_id: 2,
    name: "Ada",
    class_year: null,
    major: null,
    phases: null,
    bio: null,
    public_email: null,
    identity_email: "ada@example.test",
    active: 1,
    roles: "",
    admin: 0,
    image: null,
    tags: "",
    entry_date: "2026-01-01",
    change_date: "2026-01-01"
}

const composition: D1Composition = {
    composition_id: 10,
    name: "Concerto",
    composer_id: 1,
    contrib_primary_1: 2,
    contrib_primary_2: null,
    contrib_addl: "",
    author_secondary: "",
    type: "Chamber",
    part: null,
    rating_suzuki: null,
    rating_nyssma: null,
    publish_location: "Loc",
    publish_name: "Pub",
    publish_year: 2000,
    uri_type: "other",
    uri: "",
    key: null,
    range: null,
    position_highest: null,
    notes_pedagogical: null,
    notes_historical: null,
    notes_other: null,
    image: null,
    phases: "",
    entry_date: "2026-01-01",
    tags: "",
    change_date: "2026-01-01"
}

describe("entityRecords — composer/contributor (bare records)", () => {
    it("stringifies id and passes the record through as entry, with no entryNames", () => {
        const record = formatCompFromD1(composer)

        expect(entityRecords("composer", [record], null, null)).toEqual([{ id: "1", entry: record, entryNames: undefined }])
    })

    it("does the same for a contributor record", () => {
        const record = formatContribFromD1(contributor)

        expect(entityRecords("contributor", null, [record], null)).toEqual([{ id: "2", entry: record, entryNames: undefined }])
    })
})

describe("entityRecords — composition (unwraps the {object, names} wrapper)", () => {
    it("unwraps the composition record and carries its resolved names as entryNames — the one noun where they differ", () => {
        const object = formatWorkFromD1(composition)
        const names: CompositionNames = {
            composer_name: "Bach",
            author_secondary_names: [],
            contrib_primary_1_name: "Ada",
            contrib_primary_2_name: "",
            contrib_addl_names: []
        }

        const result = entityRecords("composition", null, null, [{ object, names }])

        // The regression this guards: passing the {object, names} wrapper itself as `entry` (instead of
        // `object`) would make every composition outlet read undefined — this asserts the unwrap happened.
        expect(result).toEqual([{ id: "10", entry: object, entryNames: names }])
    })
})

describe("entityRecords — the reader-returned-null case (D1 unconfigured, or that table skipped)", () => {
    it("contributes no records for any of the three nouns, matching the dual-source-dependency skip rule", () => {
        expect(entityRecords("composer", null, null, null)).toEqual([])
        expect(entityRecords("contributor", null, null, null)).toEqual([])
        expect(entityRecords("composition", null, null, null)).toEqual([])
    })
})
