/**
 * tests/build/entity-meta.test.ts
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

import { entityMetaDescription } from "../../src/lib/build/entity-meta"

describe("entityMetaDescription — composer", () => {
    it("uses the bio, truncated, when present", () => {
        const bio = "A".repeat(200)
        const description = entityMetaDescription("composer", { name: "Ignatius Sancho", bio })
        expect(description.length).toBe(160)
        expect(description.endsWith("…")).toBe(true)
    })

    it("leaves a short bio untouched", () => {
        expect(entityMetaDescription("composer", { name: "Ignatius Sancho", bio: "  A short bio.  " })).toBe(
            "A short bio."
        )
    })

    it("generates a sentence from structured fields when there is no bio", () => {
        const description = entityMetaDescription("composer", {
            name: "Ignatius Sancho",
            role: "composer",
            life_span: "1729–1780",
            country: "GB"
        })
        expect(description).toBe("Ignatius Sancho, Composer (1729–1780, United Kingdom).")
    })

    it("degrades gracefully when only the name is present", () => {
        expect(entityMetaDescription("composer", { name: "Ignatius Sancho" })).toBe("Ignatius Sancho.")
    })

    it("falls back to a generic subject when even the name is missing", () => {
        expect(entityMetaDescription("composer", {})).toBe("This composer.")
    })
})

describe("entityMetaDescription — contributor", () => {
    it("uses the bio, truncated, when present", () => {
        const bio = "B".repeat(200)
        expect(entityMetaDescription("contributor", { name: "Michael Wong", bio }).length).toBe(160)
    })

    it("generates a sentence from major/class_year when there is no bio", () => {
        expect(
            entityMetaDescription("contributor", { name: "Michael Wong", major: "Music", class_year: 2026 })
        ).toBe("Michael Wong, Music, class of 2026.")
    })

    it("degrades gracefully with no bio and no structured fields", () => {
        expect(entityMetaDescription("contributor", { name: "Michael Wong" })).toBe("Michael Wong.")
    })
})

describe("entityMetaDescription — composition", () => {
    it("uses notes_historical, truncated, when present", () => {
        const notes = "C".repeat(200)
        expect(entityMetaDescription("composition", { name: "Marianne's Reel", notes_historical: notes }).length).toBe(
            160
        )
    })

    it("generates a sentence from the resolved composer reference and type when there are no notes", () => {
        expect(
            entityMetaDescription("composition", {
                name: "Marianne's Reel",
                type: "Fiddle Tune",
                composer: { id: 1, name: "Ignatius Sancho", href: "/entity/composer/1" }
            })
        ).toBe("Marianne's Reel by Ignatius Sancho (Fiddle Tune).")
    })

    it("degrades gracefully when the composer reference is unresolved", () => {
        expect(entityMetaDescription("composition", { name: "Marianne's Reel", composer: null })).toBe(
            "Marianne's Reel."
        )
    })
})
