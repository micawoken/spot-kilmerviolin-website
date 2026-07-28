/**
 * tests/authorize.test.ts
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

/// <reference path="../src/lib/api/types.d.ts" />

/**
 * Tests for the authorization primitives in src/lib/api/authorize.ts
 *
 * Two layers are covered:
 *  - the pure permission helpers (requires / requiresOneOf / requiresAllOf / conferFrom /
 *    canModify / canAct), which operate on Identity objects and need no I/O; and
 *  - authorize(), which reads the contributor table via D1 and builds the Identity, exercised
 *    against a seeded table through the cloudflare:test pool.
 *
 * Regression focus:
 *  - role lookups must never throw on unknown or empty role strings (they used to index
 *    roles[role][permission] directly);
 *  - requires() must actually consult the role registry (it previously always returned false);
 *  - a contributor with an empty roles column must yield roles [] rather than [""]; and
 *  - the no-record (enrollable) path must derive enrollable from env.API_USER_SELFENROLL rather
 *    than hardcoding it true.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test"
import { env } from "cloudflare:workers"

import authorize, {
    requires,
    requiresOneOf,
    requiresAllOf,
    conferFrom,
    canModify,
    canAct,
    canCreate,
    withActingContributor,
    permissionsFromRoles,
} from "../src/lib/api/authorize.ts"
import { exec_string } from "../src/lib/api/d1.ts"
import { addContributor } from "../src/lib/api/database.ts"

// mirrors the contributors table definition in d1.ts (the init string there is module-private)
const contributors_ddl = `
CREATE TABLE IF NOT EXISTS contributors (
contributor_id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT UNIQUE NOT NULL,
class_year INTEGER,
major TEXT,
phases TEXT,
bio TEXT,
public_email TEXT,
identity_email TEXT UNIQUE NOT NULL,
active INTEGER NOT NULL,
roles TEXT NOT NULL,
admin INTEGER NOT NULL,
image TEXT,
tags TEXT,
entry_date INTEGER NOT NULL,
change_date INTEGER NOT NULL
);`

/** Builds an Identity, overriding only the fields a given test cares about. */
function makeIdentity(overrides: Partial<Identity> = {}): Identity {
    const base = {
        sub: "sub-test",
        email: "user@example.com",
        nbf: 0,
        exp: Number.POSITIVE_INFINITY,
        allowed: true,
        active: true,
        enrollable: false,
        roles: [] as string[],
        id: 1,
        admin: false,
        userinfo: { ok: true, name: "User", tags: [], phases: [], entry_date: null, class_year: null, major: null, bio: null, public_email: null, image: null, change_date: null },
        ...overrides,
    }
    // derive permissions from the (possibly overridden) roles unless a test pins them explicitly, mirroring
    // how buildIdentity computes them during authorization
    return { ...base, permissions: overrides.permissions ?? permissionsFromRoles(base.roles) }
}

/** Builds a contributor for seeding; distinct name/email per call to respect UNIQUE constraints. */
function makeContributor(overrides: Partial<Contributor> & Pick<Contributor, "name" | "identity_email">): Contributor {
    return {
        class_year: 2026,
        major: "Music",
        phases: [1, 2],
        bio: "A test contributor.",
        public_email: "pub@example.com",
        active: false,
        admin: false,
        roles: [],
        tags: [],
        image: null,
        ...overrides,
    }
}

async function withCtx<T>(fn: (ctx: ExecutionContext) => Promise<T>): Promise<T> {
    const ctx = createExecutionContext()
    const result = await fn(ctx)
    await waitOnExecutionContext(ctx)
    return result
}

beforeAll(async () => {
    await exec_string(contributors_ddl)
})

describe("requires", () => {
    it("grants a permission held by one of the identity's roles", () => {
        // reviewer carries overrides_lockout; this is the core regression: requires() used to always return false
        expect(requires("overrides_lockout", makeIdentity({ roles: ["reviewer"] }))).toBe(true)
        expect(requires("user_addition", makeIdentity({ roles: ["userenroll"] }))).toBe(true)
    })

    it("denies a permission none of the identity's roles carry", () => {
        expect(requires("overrides_lockout", makeIdentity({ roles: ["userenroll"] }))).toBe(false)
        expect(requires("user_addition", makeIdentity({ roles: ["reviewer"] }))).toBe(false)
    })

    it("denies (without throwing) for empty, blank, or unknown roles", () => {
        expect(requires("overrides_lockout", makeIdentity({ roles: [] }))).toBe(false)
        expect(requires("overrides_lockout", makeIdentity({ roles: [""] }))).toBe(false)
        expect(requires("overrides_lockout", makeIdentity({ roles: ["ghost"] }))).toBe(false)
    })
})

describe("requiresOneOf", () => {
    it("is satisfied when any role carries any of the permissions", () => {
        expect(requiresOneOf(["overrides_lockout", "user_addition"], makeIdentity({ roles: ["reviewer"] }))).toBe(true)
    })

    it("is not satisfied when no role carries any of the permissions", () => {
        expect(requiresOneOf(["user_addition", "user_activation"], makeIdentity({ roles: ["reviewer"] }))).toBe(false)
    })

    it("does not throw on unknown role strings", () => {
        expect(() => requiresOneOf(["user_addition"], makeIdentity({ roles: ["ghost", "reviewer"] }))).not.toThrow()
        expect(requiresOneOf(["user_addition"], makeIdentity({ roles: ["ghost", "userenroll"] }))).toBe(true)
    })

    it("with empty permissions falls closed to admin by default, open when fail_closed is false", () => {
        expect(requiresOneOf([], makeIdentity({ admin: false }))).toBe(false)
        expect(requiresOneOf([], makeIdentity({ admin: true }))).toBe(true)
        expect(requiresOneOf([], makeIdentity({ admin: false }), false)).toBe(true)
    })
})

describe("requiresAllOf", () => {
    it("aggregates permissions across every role held, not within one role", () => {
        // userenroll carries both user_addition and user_activation
        expect(requiresAllOf(["user_addition", "user_activation"], makeIdentity({ roles: ["userenroll"] }))).toBe(true)
        // No single held role carries both of these — userenroll grants user_addition, reviewer grants
        // overrides_lockout — but the caller holds both roles and therefore both permissions. Requiring
        // them to come from one role contradicted permissionsFromRoles, which ORs across all roles, and
        // satisfiesAccess, which reads that flattened set: the API and the page gate disagreed.
        expect(requiresAllOf(["user_addition", "overrides_lockout"], makeIdentity({ roles: ["userenroll", "reviewer"] }))).toBe(true)
        // still false when the permission is genuinely absent from every role held
        expect(requiresAllOf(["user_addition", "overrides_lockout"], makeIdentity({ roles: ["userenroll"] }))).toBe(false)
    })

    it("does not throw on unknown role strings", () => {
        expect(() => requiresAllOf(["user_addition"], makeIdentity({ roles: ["ghost"] }))).not.toThrow()
        expect(requiresAllOf(["user_addition"], makeIdentity({ roles: ["ghost"] }))).toBe(false)
    })

    it("with empty permissions falls closed to admin by default, open when fail_closed is false", () => {
        expect(requiresAllOf([], makeIdentity({ admin: false }))).toBe(false)
        expect(requiresAllOf([], makeIdentity({ admin: true }))).toBe(true)
        expect(requiresAllOf([], makeIdentity({ admin: false }), false)).toBe(true)
    })
})

describe("conferFrom", () => {
    it("returns only the conferrable roles the identity holds", () => {
        // reviewer is conferrable, userenroll is not
        expect(conferFrom(makeIdentity({ roles: ["reviewer", "userenroll"] }))).toEqual(["reviewer"])
    })

    it("ignores unknown roles", () => {
        expect(conferFrom(makeIdentity({ roles: ["ghost", "reviewer"] }))).toEqual(["reviewer"])
    })

    it("returns an empty list when no held role is conferrable", () => {
        expect(conferFrom(makeIdentity({ roles: ["userenroll"] }))).toEqual([])
    })
})

describe("canModify", () => {
    const record = { contrib_primary_1: 10, contrib_primary_2: 20 } as unknown as CompositionRecord

    it("allows a primary contributor", () => {
        expect(canModify(record, makeIdentity({ id: 10, admin: false }))).toBe(true)
        expect(canModify(record, makeIdentity({ id: 20, admin: false }))).toBe(true)
    })

    it("allows a lockout-override role holder who is not a primary contributor", () => {
        // depends on requires("overrides_lockout") working; reviewer carries it
        expect(canModify(record, makeIdentity({ id: 99, admin: false, roles: ["reviewer"] }))).toBe(true)
    })

    it("allows an admin when use_admin is set, and denies one when it is not", () => {
        expect(canModify(record, makeIdentity({ id: 99, admin: true }))).toBe(true)
        expect(canModify(record, makeIdentity({ id: 99, admin: true }), false)).toBe(false)
    })

    it("denies an unrelated, unprivileged identity", () => {
        expect(canModify(record, makeIdentity({ id: 99, admin: false, roles: [] }))).toBe(false)
    })
})

describe("canAct", () => {
    const record = { contrib_primary_1: 10, contrib_primary_2: 20 } as unknown as CompositionRecord

    it("allows a primary contributor or an admin", () => {
        expect(canAct(record, { name: "x" }, makeIdentity({ id: 10, admin: false }))).toBe(true)
        expect(canAct(record, { contrib_primary_1: 99 }, makeIdentity({ id: 5, admin: true }))).toBe(true)
    })

    it("lets a non-privileged identity edit non-lockout columns", () => {
        expect(canAct(record, { name: "new title" }, makeIdentity({ id: 99, admin: false }))).toBe(true)
    })

    it("blocks a non-privileged identity from changing the primary contributor columns", () => {
        expect(canAct(record, { contrib_primary_1: 99 }, makeIdentity({ id: 99, admin: false }))).toBe(false)
        expect(canAct(record, { contrib_primary_2: 99 }, makeIdentity({ id: 99, admin: false }))).toBe(false)
    })

    it("blocks a primary contributor from modifying or removing a defined, non-self co-primary", () => {
        // primary_1 (id 10) may not overwrite or clear primary_2 (id 20)
        expect(canAct(record, { contrib_primary_2: 30 }, makeIdentity({ id: 10, admin: false }))).toBe(false)
        expect(canAct(record, { contrib_primary_2: null }, makeIdentity({ id: 10, admin: false }))).toBe(false)
        // symmetrically, primary_2 (id 20) may not touch primary_1 (id 10)
        expect(canAct(record, { contrib_primary_1: 30 }, makeIdentity({ id: 20, admin: false }))).toBe(false)
    })

    it("lets a primary contributor fill an empty second slot or leave a co-primary unchanged", () => {
        const solo = { contrib_primary_1: 10, contrib_primary_2: null } as unknown as CompositionRecord
        // adding a co-primary through the first primary is allowed
        expect(canAct(solo, { contrib_primary_2: 30 }, makeIdentity({ id: 10, admin: false }))).toBe(true)
        // re-submitting the co-primary unchanged is not a modification
        expect(canAct(record, { contrib_primary_2: 20 }, makeIdentity({ id: 10, admin: false }))).toBe(true)
        // a primary may still edit their own slot
        expect(canAct(record, { contrib_primary_1: 30 }, makeIdentity({ id: 10, admin: false }))).toBe(true)
    })

    it("lets an elevated admin reassign a co-primary the lockout would otherwise protect", () => {
        expect(canAct(record, { contrib_primary_2: 30 }, makeIdentity({ id: 10, admin: true }))).toBe(true)
        // but only when admin status is in effect (use_admin)
        expect(canAct(record, { contrib_primary_2: 30 }, makeIdentity({ id: 10, admin: true }), false)).toBe(false)
    })
})

describe("canCreate", () => {
    const record = { contrib_primary_1: 10, contrib_primary_2: 20 } as unknown as Composition

    it("lets an admin name any registered users as primaries", () => {
        expect(canCreate(record, makeIdentity({ id: 99, admin: true }))).toBe(true)
        // when admin status is not in effect, the self-primary rule applies instead
        expect(canCreate(record, makeIdentity({ id: 99, admin: true }), false)).toBe(false)
    })

    it("lets a non-admin create a composition naming themselves as a primary", () => {
        expect(canCreate(record, makeIdentity({ id: 10, admin: false }))).toBe(true)
        expect(canCreate(record, makeIdentity({ id: 20, admin: false }))).toBe(true)
    })

    it("blocks a non-admin who is not among the primaries", () => {
        expect(canCreate(record, makeIdentity({ id: 99, admin: false }))).toBe(false)
    })

    it("blocks an unenrolled identity (id -1)", () => {
        expect(canCreate(record, makeIdentity({ id: -1, admin: false }))).toBe(false)
        // even an admin id must be a real, asserted contributor id
        expect(canCreate(record, makeIdentity({ id: -1, admin: true }))).toBe(false)
    })
})

describe("withActingContributor", () => {
    const current = { contrib_primary_1: 10, contrib_primary_2: 20, contrib_addl: [30] } as unknown as CompositionRecord

    it("appends a non-primary editor who is not already recorded", () => {
        expect(withActingContributor(current, { name: "x" }, makeIdentity({ id: 99 }))).toEqual([30, 99])
    })

    it("returns null when the editor is already a primary or already recorded", () => {
        expect(withActingContributor(current, { name: "x" }, makeIdentity({ id: 10 }))).toBeNull()
        expect(withActingContributor(current, { name: "x" }, makeIdentity({ id: 20 }))).toBeNull()
        expect(withActingContributor(current, { name: "x" }, makeIdentity({ id: 30 }))).toBeNull()
    })

    it("returns null for an unenrolled identity (id -1)", () => {
        expect(withActingContributor(current, { name: "x" }, makeIdentity({ id: -1 }))).toBeNull()
    })

    it("uses the proposed primaries when the update reassigns them", () => {
        // the editor becomes a primary via the proposed change, so they should not also be added to addl
        expect(withActingContributor(current, { contrib_primary_1: 99 }, makeIdentity({ id: 99 }))).toBeNull()
    })

    it("bases the merge on the proposed addl list when one is supplied, and de-dupes", () => {
        expect(withActingContributor(current, { contrib_addl: [5] }, makeIdentity({ id: 99 }))).toEqual([5, 99])
        expect(withActingContributor(current, { contrib_addl: [99] }, makeIdentity({ id: 99 }))).toBeNull()
    })
})

describe("authorize", () => {
    function base(email: string): BaseIdentity {
        return { sub: `sub-${email}`, email, nbf: 0, exp: Number.POSITIVE_INFINITY }
    }

    it("builds an allowed, active identity from an existing record and parses its roles", async () => {
        await withCtx(ctx => addContributor(ctx, makeContributor({
            name: "Roled Contributor",
            identity_email: "roled@example.com",
            active: true,
            roles: ["reviewer", "userenroll"],
        })))

        const identity = await authorize(base("roled@example.com"))
        expect(identity.allowed).toBe(true)
        expect(identity.active).toBe(true)
        expect(identity.enrollable).toBe(false)
        expect(identity.roles).toEqual(["reviewer", "userenroll"])
        expect(identity.email).toBe("roled@example.com")
        expect(identity.id).toBeGreaterThan(0)
    })

    it("yields roles [] (not ['']) for a record with no roles", async () => {
        await withCtx(ctx => addContributor(ctx, makeContributor({
            name: "Roleless Contributor",
            identity_email: "roleless@example.com",
            active: true,
            roles: [],
        })))

        const identity = await authorize(base("roleless@example.com"))
        expect(identity.roles).toEqual([])
        // and the empty-role value must not break downstream role checks
        expect(() => requiresAllOf(["user_addition"], identity)).not.toThrow()
        expect(requiresAllOf(["user_addition"], identity)).toBe(false)
    })

    it("builds a permissionless no-record identity", async () => {
        const identity = await authorize(base("stranger@example.com"))
        expect(identity.allowed).toBe(false)
        expect(identity.active).toBe(false)
        expect(identity.admin).toBe(false)
        expect(identity.roles).toEqual([])
        expect(identity.id).toBe(-1)
    })

    it("derives the no-record identity's enrollable flag from env.API_USER_SELFENROLL", async () => {
        // the fix: enrollable tracks the env flag in both directions instead of being hardcoded true
        const original = env.API_USER_SELFENROLL
        try {
            ;(env as { API_USER_SELFENROLL: boolean }).API_USER_SELFENROLL = true
            expect((await authorize(base("stranger-on@example.com"))).enrollable).toBe(true)

            ;(env as { API_USER_SELFENROLL: boolean }).API_USER_SELFENROLL = false
            expect((await authorize(base("stranger-off@example.com"))).enrollable).toBe(false)
        } finally {
            ;(env as { API_USER_SELFENROLL: boolean }).API_USER_SELFENROLL = original
        }
    })
})
