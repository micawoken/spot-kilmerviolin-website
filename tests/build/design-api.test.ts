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

import { fetchPublishedEntityTemplates, fetchPublishedTemplates } from "../../src/lib/build/design-api"
import { CmsReadError } from "../../src/lib/build/emdash-api"
import { emptyDesignDoc } from "../../src/lib/compositor/migrations"

/** A JSON Response, as EmDash's API would return it. */
function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

/**
 * One `design_template` item as the list API returns it.
 *
 * `is_default` is 0, NOT false, because that is what EmDash actually puts on the wire: a boolean field is
 * a SQLite INTEGER column, and while writes serialize true/false to 1/0, reads never convert them back.
 * A fixture that hand-authors a JS boolean here only confirms our own assumption — which is exactly how
 * the `=== true` bug reached production.
 */
function templateItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "tpl-1",
        slug: "article",
        status: "published",
        data: { title: "Article", collection: "pages", is_default: 0, design: emptyDesignDoc(), ...overrides }
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
        // "composers" (plural) is deliberately not a valid target: it is neither an EmDash TemplateCollection
        // ("pages"/"posts") nor a D1 EntityNoun ("composer", singular) — a typo, not a real entity noun.
        const items = [templateItem({ collection: "composers" })]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items } })))

        await expect(fetchPublishedTemplates()).rejects.toThrow(/composers/)
    })

    it("lists both EmDash collections and entity nouns as the expected targets", async () => {
        const items = [templateItem({ collection: "composers" })]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items } })))

        await expect(fetchPublishedTemplates()).rejects.toThrow(/pages, posts, composer, composition, contributor/)
    })

    it("throws when a published template's design cannot be migrated", async () => {
        const items = [templateItem({ design: { schemaVersion: 99, puck: { content: [], root: {} } } })]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items } })))

        await expect(fetchPublishedTemplates()).rejects.toThrow(/article/)
    })
})

describe("fetchPublishedTemplates — a well-formed template", () => {
    it("flattens it to what the route table needs", async () => {
        const items = [templateItem({ title: "Article", collection: "pages", is_default: 1 })]
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

/** Like templateItem, but also lets the fixture set the outer id/slug (which live outside `data`). */
function templateItemWithId(id: string, slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const item = templateItem(overrides)
    return { ...item, id, slug }
}

describe("fetchPublishedTemplates / fetchPublishedEntityTemplates — the pages/posts vs. entity split", () => {
    it("fetchPublishedTemplates only returns pages/posts templates, never entity ones", async () => {
        const items = [
            templateItemWithId("tpl-pages", "article", { collection: "pages" }),
            templateItemWithId("tpl-composer", "composer-detail", { collection: "composer" })
        ]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items } })))

        const templates = await fetchPublishedTemplates()

        expect(templates.map((template) => template.id)).toEqual(["tpl-pages"])
    })

    it("fetchPublishedEntityTemplates only returns entity templates, never pages/posts ones", async () => {
        const items = [
            templateItemWithId("tpl-pages", "article", { collection: "pages" }),
            templateItemWithId("tpl-composer", "composer-detail", { collection: "composer" }),
            templateItemWithId("tpl-composition", "composition-detail", { collection: "composition" })
        ]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items } })))

        const templates = await fetchPublishedEntityTemplates()

        expect(templates.map((template) => template.id).sort()).toEqual(["tpl-composer", "tpl-composition"])
    })

    it("a well-formed entity template flattens the same way a pages/posts one does", async () => {
        const items = [templateItemWithId("tpl-contrib", "contributor-detail", { collection: "contributor", is_default: 1 })]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items } })))

        const templates = await fetchPublishedEntityTemplates()

        expect(templates).toMatchObject([
            { id: "tpl-contrib", slug: "contributor-detail", collection: "contributor", isDefault: true }
        ])
    })
})

/**
 * The regression this guards (found on prod, 2026-07-13): EmDash serializes a boolean field to its
 * INTEGER column as 1/0 and never deserializes it back, so `is_default` arrives as a NUMBER. Reading it
 * with `is_default === true` made every default template read as NOT default — which silently disabled
 * the collection-default branch of route resolution (D4) AND made the "two published defaults fail the
 * build" invariant unfireable. Nothing else catches this: the build succeeds, types check, and a fixture
 * that hand-authors a JS boolean passes. Only the wire shape refutes it, so the wire shape is pinned.
 */
describe("fetchPublishedTemplates — EmDash's 1/0 boolean encoding", () => {
    it("reads the number 1 as a set default, so the collection default is honored at all", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items: [templateItem({ is_default: 1 })] } })))

        await expect(fetchPublishedTemplates()).resolves.toMatchObject([{ isDefault: true }])
    })

    it("reads the number 0 as an unset default", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items: [templateItem({ is_default: 0 })] } })))

        await expect(fetchPublishedTemplates()).resolves.toMatchObject([{ isDefault: false }])
    })

    it("still reads a real boolean, so the encoding may tighten without breaking the build", async () => {
        const both = [templateItem({ id: "a", slug: "a", is_default: true }), templateItem({ id: "b", slug: "b", is_default: false })]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items: both } })))

        await expect(fetchPublishedTemplates()).resolves.toMatchObject([{ isDefault: true }, { isDefault: false }])
    })
})
