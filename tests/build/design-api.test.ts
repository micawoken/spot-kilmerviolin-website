/**
 * tests/build/design-api.test.ts
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

import { fetchPublishedTemplates } from "../../src/lib/build/design-api"
import { CmsReadError } from "../../src/lib/build/emdash-api"
import { emptyDesignDoc } from "../../src/lib/compositor/migrations"

/** A JSON Response, as EmDash's API would return it. */
function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

/** One `design_template` item as the list API returns it. */
function templateItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "tpl-1",
        slug: "article",
        status: "published",
        data: { title: "Article", collection: "pages", is_default: false, design: emptyDesignDoc(), ...overrides }
    }
}

/**
 * Settles a read under the fake clock. A read retries transient failures with backoff, so the clock must
 * be run forward or the promise never settles.
 *
 * Handlers are attached synchronously — before the clock advances — because the read can reject while the
 * timers run, and a rejection observed later than that is reported as an unhandled rejection.
 */
async function settle<T>(promise: Promise<T>): Promise<T> {
    const outcome = promise.then(
        (value) => ({ ok: true, value }) as const,
        (error: unknown) => ({ ok: false, error }) as const
    )
    await vi.runAllTimersAsync()
    const result = await outcome
    if (result.ok) return result.value
    throw result.error
}

beforeEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.stubEnv("CONTENT_API_BASE", "https://cms.example.test")
    // The retry backoff would otherwise cost ~9s of real time per exhausted read.
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe("fetchPublishedTemplates — the collection does not exist yet", () => {
    it("reads a 404 as 'no templates', so every build before Phase B still succeeds", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(404, { error: { message: "not found" } })))

        // The regression this guards: `design_template` does not exist until the setup tooling creates it.
        // Without allowMissing, the CMS-outage guard turns that 404 into a CmsReadError and fails EVERY
        // build — the site cannot deploy at all until the collection is created.
        await expect(settle(fetchPublishedTemplates())).resolves.toEqual([])
    })
})

describe("fetchPublishedTemplates — a real read failure", () => {
    it("still throws, so an outage cannot silently strip every entry of its template", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")))

        await expect(settle(fetchPublishedTemplates())).rejects.toBeInstanceOf(CmsReadError)
    })

    it("throws on a non-404 error status", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(500, { error: { message: "boom" } })))

        await expect(settle(fetchPublishedTemplates())).rejects.toBeInstanceOf(CmsReadError)
    })
})

describe("fetchPublishedTemplates — an authored-wrong template", () => {
    it("throws when a published template targets a collection the build does not route", async () => {
        const items = [templateItem({ collection: "composers" })]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items } })))

        await expect(fetchPublishedTemplates()).rejects.toThrow(/composers/)
    })

    it("throws when a published template's design cannot be migrated", async () => {
        const items = [templateItem({ design: { schemaVersion: 99, puck: { content: [], root: {} } } })]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items } })))

        await expect(fetchPublishedTemplates()).rejects.toThrow(/article/)
    })
})

describe("fetchPublishedTemplates — a well-formed template", () => {
    it("flattens it to what the route table needs", async () => {
        const items = [templateItem({ title: "Article", collection: "pages", is_default: true })]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items } })))

        const templates = await fetchPublishedTemplates()

        expect(templates).toHaveLength(1)
        expect(templates[0]).toMatchObject({
            id: "tpl-1",
            slug: "article",
            title: "Article",
            collection: "pages",
            isDefault: true
        })
    })
})
