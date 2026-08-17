/**
 * tests/build/design-api.test.ts
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { NOT_FOUND_PAGE_SLUG, partitionDesignPages, type BuildDesignPage } from "../../src/lib/build/design-api"
import { emptyDesignDoc } from "../../src/lib/compositor/migrations"

/**
 * Fetches a fresh instance of design-api.ts
 */
async function freshApis() {
    vi.resetModules()
    const [designApi, emdashApi] = await Promise.all([
        import("../../src/lib/build/design-api"),
        import("../../src/lib/build/emdash-api")
    ])
    return { ...designApi, CmsReadError: emdashApi.CmsReadError }
}

/** A JSON Response, as EmDash's API would return it. */
function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

/**
 * One `design_template` item as the list API returns it
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
 * Settles a read under the fake clock
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

describe("fetchPublishedTemplates - the collection does not exist yet", () => {
    it("reads a 404 as 'no templates', so every build before Phase B still succeeds", async () => {
        const { fetchPublishedTemplates } = await freshApis()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(404, { error: { message: "not found" } })))

        // The regression this guards: `design_template` does not exist until the setup tooling creates it
        await expect(settle(fetchPublishedTemplates())).resolves.toEqual([])
    })
})

describe("fetchPublishedTemplates - a real read failure", () => {
    it("still throws, so an outage cannot silently strip every entry of its template", async () => {
        const { CmsReadError, fetchPublishedTemplates } = await freshApis()
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")))

        await expect(settle(fetchPublishedTemplates())).rejects.toBeInstanceOf(CmsReadError)
    })

    it("throws on a non-404 error status", async () => {
        const { CmsReadError, fetchPublishedTemplates } = await freshApis()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(500, { error: { message: "boom" } })))

        await expect(settle(fetchPublishedTemplates())).rejects.toBeInstanceOf(CmsReadError)
    })
})

describe("fetchPublishedTemplates - an authored-wrong template", () => {
    it("throws when a published template targets a collection the build does not route", async () => {
        const { fetchPublishedTemplates } = await freshApis()
        // "composers" (plural) is deliberately not a valid target: it is neither an EmDash TemplateCollection
        // ("pages"/"posts") nor a D1 EntityNoun ("composer", singular)
        const items = [templateItem({ collection: "composers" })]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items } })))

        await expect(fetchPublishedTemplates()).rejects.toThrow(/composers/)
    })

    it("lists both EmDash collections and entity nouns as the expected targets", async () => {
        const { fetchPublishedTemplates } = await freshApis()
        const items = [templateItem({ collection: "composers" })]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items } })))

        await expect(fetchPublishedTemplates()).rejects.toThrow(/pages, posts, composer, composition, contributor/)
    })

    it("throws when a published template's design cannot be migrated", async () => {
        const { fetchPublishedTemplates } = await freshApis()
        const items = [templateItem({ design: { schemaVersion: 99, puck: { content: [], root: {} } } })]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items } })))

        await expect(fetchPublishedTemplates()).rejects.toThrow(/article/)
    })
})

describe("fetchPublishedTemplates - a well-formed template", () => {
    it("flattens it to what the route table needs", async () => {
        const { fetchPublishedTemplates } = await freshApis()
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

describe("fetchPublishedTemplates / fetchPublishedEntityTemplates - the pages/posts vs. entity split", () => {
    it("fetchPublishedTemplates only returns pages/posts templates, never entity ones", async () => {
        const { fetchPublishedTemplates } = await freshApis()
        const items = [
            templateItemWithId("tpl-pages", "article", { collection: "pages" }),
            templateItemWithId("tpl-composer", "composer-detail", { collection: "composer" })
        ]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items } })))

        const templates = await fetchPublishedTemplates()

        expect(templates.map((template) => template.id)).toEqual(["tpl-pages"])
    })

    it("fetchPublishedEntityTemplates only returns entity templates, never pages/posts ones", async () => {
        const { fetchPublishedEntityTemplates } = await freshApis()
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
        const { fetchPublishedEntityTemplates } = await freshApis()
        const items = [templateItemWithId("tpl-contrib", "contributor-detail", { collection: "contributor", is_default: 1 })]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items } })))

        const templates = await fetchPublishedEntityTemplates()

        expect(templates).toMatchObject([
            { id: "tpl-contrib", slug: "contributor-detail", collection: "contributor", isDefault: true }
        ])
    })

    it("fetchPublishedTemplates and fetchPublishedEntityTemplates share ONE network read, not one each", async () => {
        // The memoized reader behind both (fetchAllPublishedTemplates) is what collapses the historical
        // duplication
        const { fetchPublishedEntityTemplates, fetchPublishedTemplates } = await freshApis()
        const items = [
            templateItemWithId("tpl-pages", "article", { collection: "pages" }),
            templateItemWithId("tpl-composer", "composer-detail", { collection: "composer" })
        ]
        const fetchSpy = vi.fn().mockResolvedValue(json(200, { data: { items } }))
        vi.stubGlobal("fetch", fetchSpy)

        await Promise.all([fetchPublishedTemplates(), fetchPublishedEntityTemplates(), fetchPublishedTemplates()])

        expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
})

/**
 * The regression this guards: EmDash serializes a boolean field to its
 * INTEGER column as 1/0 and never deserializes it back
 */
describe("fetchPublishedTemplates - EmDash's 1/0 boolean encoding", () => {
    it("reads the number 1 as a set default, so the collection default is honored at all", async () => {
        const { fetchPublishedTemplates } = await freshApis()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items: [templateItem({ is_default: 1 })] } })))

        await expect(fetchPublishedTemplates()).resolves.toMatchObject([{ isDefault: true }])
    })

    it("reads the number 0 as an unset default", async () => {
        const { fetchPublishedTemplates } = await freshApis()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items: [templateItem({ is_default: 0 })] } })))

        await expect(fetchPublishedTemplates()).resolves.toMatchObject([{ isDefault: false }])
    })

    it("still reads a real boolean, so the encoding may tighten without breaking the build", async () => {
        const { fetchPublishedTemplates } = await freshApis()
        const both = [templateItem({ id: "a", slug: "a", is_default: true }), templateItem({ id: "b", slug: "b", is_default: false })]
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items: both } })))

        await expect(fetchPublishedTemplates()).resolves.toMatchObject([{ isDefault: true }, { isDefault: false }])
    })
})

/** One `design_page` item as the list API returns it (the raw shape `fetchPublishedDesignPages` flattens) */
function designPageItem(id: string, slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { id, slug, status: "published", data: { title: `Page ${slug}`, design: emptyDesignDoc(), ...overrides } }
}

describe("fetchPublishedDesignPages - memoization", () => {
    it("reads the network once no matter how many callers ask for it in one build", async () => {
        // Historically DatabaseRoot.astro's own render and [...slug].astro's getStaticPaths each triggered
        // their own cursor-paginated read of design_page - this cache is what collapses them to one
        const { fetchPublishedDesignPages } = await freshApis()
        const items = [designPageItem("pg-1", "about")]
        const fetchSpy = vi.fn().mockResolvedValue(json(200, { data: { items } }))
        vi.stubGlobal("fetch", fetchSpy)

        const [first, second] = await Promise.all([fetchPublishedDesignPages(), fetchPublishedDesignPages()])

        expect(first).toBe(second)
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        expect(first.map((page) => page.slug)).toEqual(["about"])
    })
})

/** A published `design_page` fixture, as `fetchPublishedDesignPages` flattens it. */
function designPage(slug: string, overrides: Partial<BuildDesignPage> = {}): BuildDesignPage {
    return { slug, title: `Page ${slug}`, description: "", doc: emptyDesignDoc(), ...overrides }
}

describe("partitionDesignPages", () => {
    it("routes every ordinary design page and reports no 404 page when none is published", () => {
        const pages = [designPage("about"), designPage("home")]

        expect(partitionDesignPages(pages)).toEqual({ routable: pages, notFoundPage: null })
    })

    it("pulls the reserved-slug page out of the routable set", () => {
        const about = designPage("about")
        const notFound = designPage(NOT_FOUND_PAGE_SLUG, { title: "Not found" })

        const { routable, notFoundPage } = partitionDesignPages([about, notFound, designPage("home")])

        expect(routable.map((page) => page.slug)).toEqual(["about", "home"])
        expect(notFoundPage).toEqual(notFound)
    })

    it("reports no 404 page, and no exclusion, when the list is empty", () => {
        expect(partitionDesignPages([])).toEqual({ routable: [], notFoundPage: null })
    })
})
