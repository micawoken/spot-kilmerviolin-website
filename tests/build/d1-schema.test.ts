/**
 * tests/build/d1-schema.test.ts
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

import { describe, it, expect } from "vitest"

import { CONTRIBUTOR_SCHEMA, COMPOSER_SCHEMA, COMPOSITION_SCHEMA, redactProtected } from "../../src/lib/build/d1-schema"

// This suite runs under @cloudflare/vitest-pool-workers (workerd), where `cloudflare:workers`
// resolves fine — so it cannot prove this module is safe to import from a plain-Node `astro build`.
// That property is exercised by actually building (see the Step 1 spike in the entity-page-
// generation plan), not by these tests. These tests only guard the schema shape itself against
// drift from the authoritative src/lib/api/d1.ts constants.

describe("CONTRIBUTOR_SCHEMA", () => {
    it("mirrors d1.ts's CONTRIBUTOR column list and primary key", () => {
        expect(CONTRIBUTOR_SCHEMA.name).toBe("contributors")
        expect(CONTRIBUTOR_SCHEMA.primary_key).toBe("contributor_id")
        expect(CONTRIBUTOR_SCHEMA.columns).toEqual([
            "contributor_id",
            "name",
            "class_year",
            "major",
            "phases",
            "bio",
            "public_email",
            "identity_email",
            "active",
            "roles",
            "admin",
            "image",
            "tags",
            "entry_date",
            "change_date"
        ])
    })

    it("marks identity/admin columns protected, matching d1.ts's redaction contract", () => {
        expect(CONTRIBUTOR_SCHEMA.protected).toEqual(["roles", "admin", "identity_email"])
    })
})

describe("COMPOSER_SCHEMA / COMPOSITION_SCHEMA", () => {
    it("carry no protected columns — composer and composition records are fully public", () => {
        expect(COMPOSER_SCHEMA.protected).toBeUndefined()
        expect(COMPOSITION_SCHEMA.protected).toBeUndefined()
    })

    it("mirror d1.ts's primary keys", () => {
        expect(COMPOSER_SCHEMA.primary_key).toBe("composer_id")
        expect(COMPOSITION_SCHEMA.primary_key).toBe("composition_id")
    })
})

describe("redactProtected", () => {
    it("strips a contributor's identity/admin columns", () => {
        const record = {
            contributor_id: 1,
            name: "Ada",
            identity_email: "ada@example.test",
            roles: "admin,editor",
            admin: 1,
            active: 1
        }
        expect(redactProtected(CONTRIBUTOR_SCHEMA, record)).toEqual({
            contributor_id: 1,
            name: "Ada",
            active: 1
        })
    })

    it("is a no-op for a schema with no protected columns", () => {
        const record = { composer_id: 1, name: "Bach" }
        expect(redactProtected(COMPOSER_SCHEMA, record)).toEqual(record)
    })
})
