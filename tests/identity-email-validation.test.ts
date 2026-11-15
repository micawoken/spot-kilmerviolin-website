/**
 * tests/identity-email-validation.test.ts
 *
 * Copyright (C) 2026 Michael Wong.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { describe, it, expect, vi } from "vitest"
import { createExecutionContext } from "cloudflare:test"

vi.mock("../src/lib/api/access_iam_mgmt", () => ({
    add_user: vi.fn(async () => undefined),
    remove_user: vi.fn(async () => undefined),
    list_users: vi.fn(async () => [])
}))

import { PATCH as identityPATCH } from "../src/pages/api/v1/identity.ts"
import { PATCH as emailPATCH } from "../src/pages/api/v1/identity/email.ts"

function adminRequest(path: string, method: string, body: unknown) {
    return {
        request: new Request(`https://localhost${path}`, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        }),
        locals: {
            cfContext: createExecutionContext(),
            identity: { id: -1, admin: true, active: true, permissions: {}, roles: [] }
        }
    } as any
}

describe("identity email changes reject malformed addresses", () => {
    it.each(["not-an-email", "a@b", "two words@example.com"])("PATCH /identity rejects %s", async (bad) => {
        const response = await identityPATCH(
            adminRequest("/api/v1/identity", "PATCH", [{ identity_email: { "old@example.com": bad } }])
        )
        expect(response.status).toBe(400)
    })

    it.each(["not-an-email", "a@b"])("PATCH /identity/email rejects %s", async (bad) => {
        const response = await emailPATCH(adminRequest("/api/v1/identity/email", "PATCH", [{ "old@example.com": bad }]))
        expect(response.status).toBe(400)
    })
})
