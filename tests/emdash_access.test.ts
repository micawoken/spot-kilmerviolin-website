/**
 * tests/emdash_access.test.ts
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
import { isDesignSystemRequest } from "../src/lib/api/emdash_design_access.ts"
import { satisfiesAccess, type AdminAccess } from "../src/lib/api/page_auth.ts"

const EMDASH_ACCESS: AdminAccess = { kind: "permission", permissions: ["cms_editor"] }
const DESIGN_ACCESS: AdminAccess = { kind: "permission", permissions: ["design_editor"] }

function buildIdentity(
    roles: string[],
    admin: boolean,
    active: boolean,
    permissions: IdentityPermissions = permissionsFromRoles(roles)
): Identity {
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
            entry_date: null,
            class_year: null,
            major: null,
            bio: null,
            public_email: null,
            image: null,
            change_date: null
        },
        permissions
    }
}

/**
 * An identity holding design_editor but NOT cms_editor — the caller the /_emdash allowlist exists to bound.
 *
 * Its permissions are built directly rather than from a role because NO ROLE GRANTS THIS TODAY: `siteeditor`
 * carries both permissions, so every real caller currently takes the cms_editor branch and never reaches the
 * allowlist. The gate must nevertheless be correct BEFORE such a role exists — the day one is added, this is
 * what stands between that user and the CMS. Testing it only through today's roles would test nothing.
 */
function designOnlyIdentity(): Identity {
    return buildIdentity(["siteeditor"], false, true, {
        ...permissionsFromRoles([]),
        design_editor: true
    })
}

/** Splits an /_emdash URL the way the middleware does, into the segments after "_emdash". */
function segments(path: string): string[] {
    return path.split("/").filter((component) => component.length > 0).slice(1)
}

/** Applies the middleware's design_editor branch: the permission AND the path allowlist, together. */
function designEditorMayReach(method: string, path: string): boolean {
    const identity = designOnlyIdentity()
    return satisfiesAccess(DESIGN_ACCESS, identity) && isDesignSystemRequest(method, segments(path))
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
 * The design_editor branch of the /_emdash gate (middleware/emdash_access.ts + lib/api/emdash_design_access.ts).
 *
 * A design_editor is NOT a CMS editor. They may reach exactly the paths the design system calls and nothing
 * else — the permission alone opens no door. The DENY cases below are the point of the whole gate: each one
 * is a way a design editor could otherwise reach content they have no business writing, and EmDash itself
 * would allow every one of them (their EmDash role is Editor, which the field pickers' `schema:read` needs).
 */
describe("/_emdash design_editor allowlist — what the design system needs", () => {
    it("admits its own collections, including create, autosave and publish", () => {
        expect(designEditorMayReach("GET", "/_emdash/api/content/design_template")).toBe(true)
        expect(designEditorMayReach("POST", "/_emdash/api/content/design_template")).toBe(true)
        expect(designEditorMayReach("PUT", "/_emdash/api/content/design_page/abc123")).toBe(true)
        expect(designEditorMayReach("POST", "/_emdash/api/content/design_page/abc123/publish")).toBe(true)
        expect(designEditorMayReach("PUT", "/_emdash/api/content/design_theme/thm-1")).toBe(true)
    })

    it("admits the preview-entry picker (read-only) and the outlet field pickers", () => {
        expect(designEditorMayReach("GET", "/_emdash/api/content/pages")).toBe(true)
        expect(designEditorMayReach("GET", "/_emdash/api/content/pages/pg-1")).toBe(true)
        expect(designEditorMayReach("GET", "/_emdash/api/schema/collections/pages/fields")).toBe(true)
        expect(designEditorMayReach("GET", "/_emdash/api/schema/collections/posts/fields")).toBe(true)
    })

    it("admits the media picker's reads", () => {
        expect(designEditorMayReach("GET", "/_emdash/api/media")).toBe(true)
        expect(designEditorMayReach("GET", "/_emdash/api/media/file/med-1")).toBe(true)
    })
})

describe("/_emdash design_editor allowlist — what it must REFUSE", () => {
    it("refuses the EmDash admin UI: a design editor is not a CMS editor", () => {
        expect(designEditorMayReach("GET", "/_emdash")).toBe(false)
        expect(designEditorMayReach("GET", "/_emdash/admin")).toBe(false)
        expect(designEditorMayReach("GET", "/_emdash/admin/collections/pages")).toBe(false)
    })

    it("refuses every WRITE to a content collection that is not its own", () => {
        expect(designEditorMayReach("POST", "/_emdash/api/content/pages")).toBe(false)
        expect(designEditorMayReach("PUT", "/_emdash/api/content/pages/pg-1")).toBe(false)
        expect(designEditorMayReach("PATCH", "/_emdash/api/content/pages/pg-1")).toBe(false)
        expect(designEditorMayReach("DELETE", "/_emdash/api/content/pages/pg-1")).toBe(false)
        // publishing an ENTRY is a content decision, not a design one
        expect(designEditorMayReach("POST", "/_emdash/api/content/pages/pg-1/publish")).toBe(false)
    })

    it("refuses collections no template renders, even for a read", () => {
        expect(designEditorMayReach("GET", "/_emdash/api/content/composers")).toBe(false)
        expect(designEditorMayReach("GET", "/_emdash/api/content/settings")).toBe(false)
    })

    it("refuses schema WRITES — the field pickers only ever read", () => {
        expect(designEditorMayReach("POST", "/_emdash/api/schema/collections/pages/fields")).toBe(false)
        expect(designEditorMayReach("DELETE", "/_emdash/api/schema/collections/pages/fields")).toBe(false)
        expect(designEditorMayReach("POST", "/_emdash/api/schema/collections")).toBe(false)
    })

    it("refuses media uploads — the picker only lists what a CMS editor already uploaded", () => {
        expect(designEditorMayReach("POST", "/_emdash/api/media")).toBe(false)
        expect(designEditorMayReach("DELETE", "/_emdash/api/media/med-1")).toBe(false)
    })

    it("refuses the rest of the CMS — settings, menus, users", () => {
        expect(designEditorMayReach("GET", "/_emdash/api/settings")).toBe(false)
        expect(designEditorMayReach("PUT", "/_emdash/api/settings")).toBe(false)
        expect(designEditorMayReach("GET", "/_emdash/api/menus/primary")).toBe(false)
        expect(designEditorMayReach("GET", "/_emdash/api/users")).toBe(false)
    })

    it("refuses an unknown endpoint: the allowlist is default-deny, so new EmDash routes are closed", () => {
        expect(designEditorMayReach("GET", "/_emdash/api/whatever-ships-next")).toBe(false)
    })

    it("denies a caller who holds neither permission, whatever the path", () => {
        const stranger = buildIdentity(["reviewer"], false, true)
        expect(satisfiesAccess(DESIGN_ACCESS, stranger)).toBe(false)
        expect(satisfiesAccess(EMDASH_ACCESS, stranger)).toBe(false)
    })
})

/**
 * The role -> permission mapping the gate rests on. siteeditor holds BOTH permissions, so a siteeditor keeps
 * full CMS access exactly as before this split; design_editor is additive, never a downgrade.
 */
describe("design_editor role grants", () => {
    it("grants a siteeditor both design_editor and cms_editor (no loss of access)", () => {
        const siteeditor = buildIdentity(["siteeditor"], false, true)
        expect(satisfiesAccess(DESIGN_ACCESS, siteeditor)).toBe(true)
        expect(satisfiesAccess(EMDASH_ACCESS, siteeditor)).toBe(true)
    })

    it("grants an admin the design system too", () => {
        expect(satisfiesAccess(DESIGN_ACCESS, buildIdentity([], true, true))).toBe(true)
    })

    it("denies an inactive siteeditor the design system", () => {
        expect(satisfiesAccess(DESIGN_ACCESS, buildIdentity(["siteeditor"], false, false))).toBe(false)
    })

    it("grants no other role the design system", () => {
        expect(satisfiesAccess(DESIGN_ACCESS, buildIdentity(["reviewer"], false, true))).toBe(false)
        expect(satisfiesAccess(DESIGN_ACCESS, buildIdentity(["userenroll"], false, true))).toBe(false)
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
