/**
 * Copyright (C) 2026 Michael Wong.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const database = vi.hoisted(() => ({
    deleteContactResponses: vi.fn<(ids: number[]) => Promise<boolean>>(),
    setContactResponsesRead: vi.fn<(ids: number[], read: boolean) => Promise<boolean>>()
}))

vi.mock("../src/lib/api/environment", async (importOriginal) => {
    const original = await importOriginal<typeof import("../src/lib/api/environment")>()
    return { ...original, authEnabled: () => true }
})

vi.mock("../src/lib/api/db_contact", () => ({
    deleteContactResponses: database.deleteContactResponses,
    listContactResponses: vi.fn().mockResolvedValue([]),
    setContactResponsesRead: database.setContactResponsesRead
}))

import { MAX_CONTACT_ADMIN_REQUEST_BODY_LENGTH, MAX_CONTACT_BULK_IDS } from "../src/consts"
import { permissionsFromRoles } from "../src/lib/api/authorize"
import { DELETE, PATCH } from "../src/pages/api/v1/contact"

const caller = {
    active: true,
    admin: false,
    allowed: true,
    enrollable: false,
    permissions: permissionsFromRoles(["submissions"])
} as Identity

async function mutate(handler: typeof PATCH | typeof DELETE, method: "PATCH" | "DELETE", body: string) {
    const request = new Request("http://localhost/api/v1/contact", {
        method,
        headers: { "Content-Type": "application/json" },
        body
    })
    return handler({ request, locals: { identity: caller } } as Parameters<typeof handler>[0])
}

beforeEach(() => {
    database.deleteContactResponses.mockReset().mockResolvedValue(true)
    database.setContactResponsesRead.mockReset().mockResolvedValue(true)
})

describe("contact-response bulk API", () => {
    it("deduplicates IDs and performs one PATCH mutation", async () => {
        const response = await mutate(PATCH, "PATCH", JSON.stringify({ ids: [7, 7, 8], read: true }))
        expect(response.status).toBe(204)
        expect(database.setContactResponsesRead).toHaveBeenCalledOnce()
        expect(database.setContactResponsesRead).toHaveBeenCalledWith([7, 8], true)
    })

    it("deduplicates IDs and performs one DELETE mutation", async () => {
        const response = await mutate(DELETE, "DELETE", JSON.stringify({ ids: [7, 7, 8] }))
        expect(response.status).toBe(204)
        expect(database.deleteContactResponses).toHaveBeenCalledOnce()
        expect(database.deleteContactResponses).toHaveBeenCalledWith([7, 8])
    })

    it("rejects invalid and unbounded ID arrays before mutation", async () => {
        expect((await mutate(PATCH, "PATCH", JSON.stringify({ ids: [0], read: true }))).status).toBe(400)
        expect(
            (
                await mutate(
                    DELETE,
                    "DELETE",
                    JSON.stringify({ ids: Array.from({ length: MAX_CONTACT_BULK_IDS + 1 }, (_, index) => index + 1) })
                )
            ).status
        ).toBe(400)
        expect(database.setContactResponsesRead).not.toHaveBeenCalled()
        expect(database.deleteContactResponses).not.toHaveBeenCalled()
    })

    it("rejects malformed and oversized bodies before mutation", async () => {
        expect((await mutate(DELETE, "DELETE", "{")).status).toBe(400)
        expect((await mutate(DELETE, "DELETE", "x".repeat(MAX_CONTACT_ADMIN_REQUEST_BODY_LENGTH + 1))).status).toBe(400)
        expect(database.deleteContactResponses).not.toHaveBeenCalled()
    })
})
