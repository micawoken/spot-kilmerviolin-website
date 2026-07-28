/**
 * tests/contributor-protection.test.ts
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
import { CONTRIBUTOR_TABLE } from "../src/lib/api/tables.ts"
import { redactProtected } from "../src/lib/build/d1-schema.ts"

/**
 * PATCH /api/v1/contributors/[id] gates a write on exactly this expression:
 *
 *     CONTRIBUTOR.protected!.some((prop) => prop in record) && !is_elevated_admin && auth_enabled
 *
 * and it runs under auth_check(..., [], false, "selfmgmt"), which deliberately ADMITS an inactive
 * caller (authservice.ts's _checkInactiveCredential returns null for inactive-but-allowed in selfmgmt
 * mode) so a deactivated user can still reach the self-service flows. Those two facts together are why
 * the protected list is load-bearing for revocation, not merely for privacy — reproduced here directly
 * rather than through the endpoint, which needs a live D1 binding.
 */
const isProtectedWrite = (record: object): boolean => CONTRIBUTOR_TABLE.protected!.some((prop) => prop in record)

describe("contributor protected columns", () => {
    it("covers every authorization-bearing column", () => {
        for (const column of ["roles", "admin", "identity_email", "active"]) {
            expect(CONTRIBUTOR_TABLE.protected).toContain(column)
        }
    })

    it("refuses a non-elevated write to `active` — a deactivated user cannot re-activate themselves", () => {
        // The attack: a user an administrator deactivated is still enrolled in Access and still
        // authenticates, so they PATCH their OWN id (which satisfies the self check) with this body.
        expect(isProtectedWrite({ active: true })).toBe(true)
        expect(isProtectedWrite({ active: 1 })).toBe(true)
        // mixed with innocuous fields, so the guard cannot be slipped past by burying it
        expect(isProtectedWrite({ bio: "hello", active: true })).toBe(true)
    })

    it("still allows an ordinary self-edit of profile fields", () => {
        expect(isProtectedWrite({ bio: "hello", public_email: "a@b.test", major: "Music" })).toBe(false)
        expect(isProtectedWrite({})).toBe(false)
    })

    it("keeps `active` out of records that leave the server", () => {
        const record = { contributor_id: 1, name: "Ada", active: 1, admin: 1, roles: "siteeditor" }
        expect(redactProtected(CONTRIBUTOR_TABLE, record)).toEqual({ contributor_id: 1, name: "Ada" })
    })

    it("leaves the column writable by the schema, so elevated admin edits still work", () => {
        // Protection is an authorization rule, not a schema removal: an admin with elevate:true bypasses
        // the check above, and /admin/user/{activate,deactivate} write the column through their own routes.
        expect(CONTRIBUTOR_TABLE.columns).toContain("active")
    })
})
