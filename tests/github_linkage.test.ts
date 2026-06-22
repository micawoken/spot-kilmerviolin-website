/**
 * tests/github_linkage.test.ts
 *
 * Unit coverage for the GitHub repository-linkage primitives that are pure (no GitHub/D1 calls):
 *  - the username syntax validator
 *  - the github_link permission wiring (siteeditor grants it; others do not)
 *  - the contributor schema marks the linkage columns protected and uniquely indexes the id
 */

import { describe, it, expect } from "vitest"
import { isValidGithubUsername } from "../src/lib/api/validation"
import { permissionsFromRoles, roles } from "../src/lib/api/authorize"
import { CONTRIBUTOR } from "../src/lib/api/d1"

describe("isValidGithubUsername", () => {
    it("accepts valid logins", () => {
        for (const name of ["octocat", "a", "a-b", "Hello-World-123", "x".repeat(39)]) {
            expect(isValidGithubUsername(name)).toBe(true)
        }
    })

    it("rejects invalid logins", () => {
        for (const name of ["", "-lead", "trail-", "a--b", "has space", "under_score", "x".repeat(40), "bad!"]) {
            expect(isValidGithubUsername(name)).toBe(false)
        }
    })
})

describe("github_link permission", () => {
    it("is granted by the siteeditor role only", () => {
        expect(roles.siteeditor.github_link).toBe(true)
        expect(roles.reviewer.github_link).toBe(false)
        expect(roles.userenroll.github_link).toBe(false)
    })

    it("aggregates into an identity's permission set", () => {
        expect(permissionsFromRoles(["siteeditor"]).github_link).toBe(true)
        expect(permissionsFromRoles(["reviewer"]).github_link).toBe(false)
        expect(permissionsFromRoles([]).github_link).toBe(false)
    })
})

describe("contributor schema linkage columns", () => {
    it("includes and protects the github columns", () => {
        expect(CONTRIBUTOR.columns).toContain("github_username")
        expect(CONTRIBUTOR.columns).toContain("github_user_id")
        expect(CONTRIBUTOR.protected).toContain("github_username")
        expect(CONTRIBUTOR.protected).toContain("github_user_id")
    })

    it("uniquely indexes github_user_id for one-account-per-contributor lookups", () => {
        expect(CONTRIBUTOR.index).toContain("github_user_id")
    })
})
