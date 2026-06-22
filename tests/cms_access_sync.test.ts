/**
 * tests/cms_access_sync.test.ts
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

/// <reference path="../src/lib/api/types.d.ts" />

/**
 * Tests the CMS-editor authorization predicate in src/lib/api/cms_access_sync.ts, which mirrors the in-app
 * rule that gates the external Pages CMS: admins are authorized automatically; non-admins must be active AND
 * hold a role granting the cms_editor permission (today, siteeditor).
 */

import { describe, it, expect } from "vitest"
import { isCmsAuthorized } from "../src/lib/api/cms_access_sync.ts"

describe("isCmsAuthorized", () => {
    it("authorizes an admin regardless of role or active state", () => {
        expect(isCmsAuthorized({ roles: [], admin: true, active: false })).toBe(true)
        expect(isCmsAuthorized({ roles: ["reviewer"], admin: true, active: true })).toBe(true)
    })

    it("authorizes an active siteeditor", () => {
        expect(isCmsAuthorized({ roles: ["siteeditor"], admin: false, active: true })).toBe(true)
    })

    it("denies an inactive siteeditor", () => {
        expect(isCmsAuthorized({ roles: ["siteeditor"], admin: false, active: false })).toBe(false)
    })

    it("denies a non-admin whose roles do not grant cms_editor", () => {
        expect(isCmsAuthorized({ roles: ["reviewer"], admin: false, active: true })).toBe(false)
        expect(isCmsAuthorized({ roles: ["userenroll"], admin: false, active: true })).toBe(false)
    })

    it("denies a roleless, non-admin contributor", () => {
        expect(isCmsAuthorized({ roles: [], admin: false, active: true })).toBe(false)
    })

    it("ignores unknown role strings (they confer nothing)", () => {
        expect(isCmsAuthorized({ roles: ["bogus"], admin: false, active: true })).toBe(false)
    })
})
