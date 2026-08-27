/**
 * Copyright (C) 2026 Michael Wong.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, expect, it, vi } from "vitest"

vi.mock("../src/lib/api/environment", async (importOriginal) => {
    const original = await importOriginal<typeof import("../src/lib/api/environment")>()
    return { ...original, authEnabled: () => true }
})

import { permissionsFromRoles } from "../src/lib/api/authorize"
import { satisfiesAccess, type AdminAccess } from "../src/lib/api/page_auth"
import { auth_check } from "../src/lib/public/authservice"
import { DELETE, GET, PATCH } from "../src/pages/api/v1/contact"

function identity(overrides: Partial<Identity> = {}): Identity {
    return {
        sub: "subject",
        email: "user@example.test",
        nbf: 0,
        exp: Number.POSITIVE_INFINITY,
        allowed: true,
        enrollable: false,
        active: true,
        roles: [],
        id: 1,
        admin: false,
        userinfo: {
            name: "User",
            tags: [],
            phases: [],
            entry_date: 1,
            class_year: null,
            major: null,
            bio: null,
            public_email: null,
            image: null,
            change_date: null,
            ok: true
        },
        permissions: permissionsFromRoles([]),
        ...overrides
    }
}

const access: AdminAccess = { kind: "permission", permissions: ["public_form_responses"] }

describe("contact-response authorization", () => {
    it("gates on the permission value, not the role name", () => {
        const granted = identity({
            roles: ["custom-role"],
            permissions: { ...permissionsFromRoles([]), public_form_responses: true }
        })
        const roleWithoutDerivedPermission = identity({ roles: ["submissions"] })
        expect(satisfiesAccess(access, granted)).toBe(true)
        expect(satisfiesAccess(access, roleWithoutDerivedPermission)).toBe(false)
    })

    it("allows the submissions permission and administrators", () => {
        const submissions = identity({
            roles: ["submissions"],
            permissions: permissionsFromRoles(["submissions"])
        })
        const request = new Request("http://localhost/api/v1/contact")
        expect(auth_check(request, submissions, ["public_form_responses"])).toBeNull()
        expect(auth_check(request, identity({ admin: true }), ["public_form_responses"])).toBeNull()
    })

    it("rejects unauthenticated, inactive, and active unprivileged identities", () => {
        const request = new Request("http://localhost/api/v1/contact")
        expect(auth_check(request, undefined, ["public_form_responses"])?.status).toBe(401)
        expect(auth_check(request, identity({ active: false }), ["public_form_responses"])?.status).toBe(401)
        expect(auth_check(request, identity(), ["public_form_responses"])?.status).toBe(403)
        expect(
            auth_check(request, identity({ roles: ["reviewer"], permissions: permissionsFromRoles(["reviewer"]) }), [
                "public_form_responses"
            ])?.status
        ).toBe(403)
    })

    it("rejects every API surface before reading or mutating data", async () => {
        const caller = identity()
        const contexts = [
            [GET, new Request("http://localhost/api/v1/contact")],
            [GET, new Request("http://localhost/api/v1/contact?format=csv")],
            [PATCH, new Request("http://localhost/api/v1/contact", { method: "PATCH", body: "{}" })],
            [DELETE, new Request("http://localhost/api/v1/contact", { method: "DELETE", body: "{}" })]
        ] as const

        for (const [handler, request] of contexts) {
            const response = await handler({
                request,
                url: new URL(request.url),
                locals: { identity: caller }
            } as Parameters<typeof handler>[0])
            expect(response.status).toBe(403)
        }
    })
})
