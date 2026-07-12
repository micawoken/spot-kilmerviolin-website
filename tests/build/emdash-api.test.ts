/**
 * tests/build/emdash-api.test.ts
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { CmsReadError, emdashGet, fetchPublishedPages } from "../../src/lib/build/emdash-api"

/** A JSON Response, as EmDash's API would return it. */
function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function withCms() {
    vi.stubEnv("CONTENT_API_BASE", "https://cms.example.test")
}

beforeEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe("emdashGet — no CMS configured (the bootstrap build)", () => {
    it("returns null instead of throwing, so a build with no worker yet still completes", async () => {
        vi.stubEnv("CONTENT_API_BASE", "")
        const fetchSpy = vi.fn()
        vi.stubGlobal("fetch", fetchSpy)

        await expect(emdashGet("/_emdash/api/settings")).resolves.toBeNull()
        expect(fetchSpy).not.toHaveBeenCalled()
    })
})

describe("emdashGet — a configured CMS that fails to answer", () => {
    it("throws on a network error or timeout rather than falling soft", async () => {
        withCms()
        const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
            name: "TimeoutError"
        })
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout))

        await expect(emdashGet("/_emdash/api/settings")).rejects.toBeInstanceOf(CmsReadError)
    })

    it("throws on a non-OK status", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(500, { error: { message: "boom" } })))

        await expect(emdashGet("/_emdash/api/settings")).rejects.toThrow(/500/)
    })

    it("names the path it could not read", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))

        await expect(emdashGet("/_emdash/api/content/pages")).rejects.toThrow(/\/_emdash\/api\/content\/pages/)
    })
})

describe("emdashGet — a missing collection", () => {
    it("throws on a 404 by default: a route-bearing collection must exist", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(404, { error: { message: "not found" } })))

        await expect(emdashGet("/_emdash/api/content/pages")).rejects.toBeInstanceOf(CmsReadError)
    })

    it("returns null on a 404 when the caller allows it (a collection not created yet)", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(404, { error: { message: "not found" } })))

        await expect(
            emdashGet("/_emdash/api/content/design_template", { allowMissing: true })
        ).resolves.toBeNull()
    })
})

describe("emdashGet — a successful read", () => {
    it("unwraps the { data } envelope", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { title: "Site" } })))

        await expect(emdashGet("/_emdash/api/settings")).resolves.toEqual({ title: "Site" })
    })
})

describe("fetchPublishedPages — an outage must not look like an empty site", () => {
    it("throws instead of returning [], which a deploy would publish over the live pages", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")))

        // The regression this guards: a soft [] here builds a dist/ with every page missing.
        await expect(fetchPublishedPages()).rejects.toBeInstanceOf(CmsReadError)
    })

    it("still returns [] when the CMS genuinely has no published pages", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items: [] } })))

        await expect(fetchPublishedPages()).resolves.toEqual([])
    })
})
