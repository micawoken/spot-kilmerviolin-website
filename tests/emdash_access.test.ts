/**
 * tests/emdash_access.test.ts
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
 */

/// <reference path="../src/lib/api/types.d.ts" />

/**
 * Tests the cms_editor authorization rule that src/middleware/emdash_access.ts applies to /_emdash,
 * exercised the same way the app applies it: satisfiesAccess({ kind: "permission", permissions: ["cms_editor"] })
 * against an Identity built from permissionsFromRoles, so the mapping from role -> permission stays in
 * sync with src/lib/api/authorize.ts rather than being hand-duplicated here.
 */

import { describe, it, expect } from "vitest"
import { permissionsFromRoles } from "../src/lib/api/authorize.ts"
import { isServicePrincipalClaims } from "../src/lib/api/authenticate.ts"
import { satisfiesAccess, type AdminAccess } from "../src/lib/api/page_auth.ts"

const EMDASH_ACCESS: AdminAccess = { kind: "permission", permissions: ["cms_editor"] }

function buildIdentity(roles: string[], admin: boolean, active: boolean): Identity {
    return {
        sub: "test-sub",
        email: "test@example.com",
        nbf: 0,
        exp: Number.MAX_SAFE_INTEGER,
        allowed: true,
        enrollable: false,
        active,
        roles,
        id: 1,
        admin,
        userinfo: {
            ok: true,
            name: "Test User",
            tags: [],
            phases: [],
            entry_date: "",
            class_year: null,
            major: null,
            bio: null,
            public_email: null,
            image: null,
            change_date: ""
        },
        permissions: permissionsFromRoles(roles)
    }
}

describe("/_emdash cms_editor gate (satisfiesAccess against EMDASH_ACCESS)", () => {
    it("authorizes an admin regardless of role or active state", () => {
        expect(satisfiesAccess(EMDASH_ACCESS, buildIdentity([], true, false))).toBe(true)
        expect(satisfiesAccess(EMDASH_ACCESS, buildIdentity(["reviewer"], true, true))).toBe(true)
    })

    it("authorizes an active siteeditor", () => {
        expect(satisfiesAccess(EMDASH_ACCESS, buildIdentity(["siteeditor"], false, true))).toBe(true)
    })

    it("denies an inactive siteeditor", () => {
        expect(satisfiesAccess(EMDASH_ACCESS, buildIdentity(["siteeditor"], false, false))).toBe(false)
    })

    it("denies a non-admin whose roles do not grant cms_editor", () => {
        expect(satisfiesAccess(EMDASH_ACCESS, buildIdentity(["reviewer"], false, true))).toBe(false)
        expect(satisfiesAccess(EMDASH_ACCESS, buildIdentity(["userenroll"], false, true))).toBe(false)
    })

    it("denies a roleless, non-admin contributor", () => {
        expect(satisfiesAccess(EMDASH_ACCESS, buildIdentity([], false, true))).toBe(false)
    })

    it("ignores unknown role strings (they confer nothing)", () => {
        expect(satisfiesAccess(EMDASH_ACCESS, buildIdentity(["bogus"], false, true))).toBe(false)
    })
})

/**
 * Claim classification behind the /_emdash service-credential delegation (identity.ts): a verified Access
 * JWT is delegated to EmDash's own auth only when its claims identify a service principal — a service
 * token's common_name with no email. Anything email-bearing or ambiguous must take the user-identity flow.
 */
describe("isServicePrincipalClaims (/_emdash service-credential delegation)", () => {
    it("accepts service-token claims (common_name, no email)", () => {
        expect(isServicePrincipalClaims({ common_name: "build-reader" })).toBe(true)
    })

    it("rejects user claims (email present)", () => {
        expect(isServicePrincipalClaims({ email: "user@example.com" })).toBe(false)
        expect(isServicePrincipalClaims({ email: "user@example.com", common_name: "odd" })).toBe(false)
    })

    it("rejects claims with neither email nor common_name", () => {
        expect(isServicePrincipalClaims({})).toBe(false)
    })

    it("rejects non-string or empty common_name", () => {
        expect(isServicePrincipalClaims({ common_name: "" })).toBe(false)
        expect(isServicePrincipalClaims({ common_name: 42 })).toBe(false)
    })
})
