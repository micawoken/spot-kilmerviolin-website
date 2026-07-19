/**
 * tests/build/emdash-api.test.ts
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

import {
    CmsReadError,
    EMDASH_MAX_WAIT_MS,
    READ_TIMEOUT_MS,
    emdashGet,
    fetchPublishedPages,
    fetchPublishedPosts
} from "../../src/lib/build/emdash-api"

/** A JSON Response, as EmDash's API would return it. */
function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function withCms() {
    vi.stubEnv("CONTENT_API_BASE", "https://cms.example.test")
}

/**
 * Settles a read under the fake clock. Reads back off between attempts, so the clock must be run forward
 * or the promise never settles.
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
    // The retry backoff would otherwise cost ~9s of real time per exhausted read.
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
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

        await expect(settle(emdashGet("/_emdash/api/settings"))).rejects.toBeInstanceOf(CmsReadError)
    })

    it("throws on a non-OK status", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(500, { error: { message: "boom" } })))

        await expect(settle(emdashGet("/_emdash/api/settings"))).rejects.toThrow(/500/)
    })

    it("names the path it could not read", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))

        await expect(settle(emdashGet("/_emdash/api/content/pages"))).rejects.toThrow(
            /\/_emdash\/api\/content\/pages/
        )
    })
})

describe("emdashGet — waiting out a cold CMS", () => {
    it("does not abort below EmDash's cold-start budget", () => {
        // The regression this guards: a client abort mid-cold-start poisons the worker isolate EmDash is
        // initializing in, so "every subsequent request in the isolate hangs until the platform kills it"
        // (emdash/src/utils/init-lock.ts). A queued request there needs up to EMDASH_MAX_WAIT_MS, so any
        // timeout at or below that re-creates the CMS "flapping" this fix removed — the old value was 15s.
        expect(READ_TIMEOUT_MS).toBeGreaterThan(EMDASH_MAX_WAIT_MS)
    })

    it("retries a transient failure and succeeds", async () => {
        withCms()
        const fetchSpy = vi
            .fn()
            .mockRejectedValueOnce(new Error("socket hang up"))
            .mockResolvedValueOnce(json(503, { error: { message: "cold" } }))
            .mockResolvedValueOnce(json(200, { data: { title: "Site" } }))
        vi.stubGlobal("fetch", fetchSpy)

        await expect(settle(emdashGet("/_emdash/api/settings"))).resolves.toEqual({ title: "Site" })
        expect(fetchSpy).toHaveBeenCalledTimes(3)
    })

    it("gives up after the attempt budget rather than retrying forever", async () => {
        withCms()
        const fetchSpy = vi.fn().mockRejectedValue(new Error("socket hang up"))
        vi.stubGlobal("fetch", fetchSpy)

        await expect(settle(emdashGet("/_emdash/api/settings"))).rejects.toBeInstanceOf(CmsReadError)
        expect(fetchSpy).toHaveBeenCalledTimes(3)
    })

    it("does not retry a 4xx, which will read the same every time", async () => {
        withCms()
        const fetchSpy = vi.fn().mockResolvedValue(json(403, { error: { message: "forbidden" } }))
        vi.stubGlobal("fetch", fetchSpy)

        await expect(settle(emdashGet("/_emdash/api/settings"))).rejects.toThrow(/Access service token/)
        expect(fetchSpy).toHaveBeenCalledTimes(1)
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
        await expect(settle(fetchPublishedPages())).rejects.toBeInstanceOf(CmsReadError)
    })

    it("still returns [] when the CMS genuinely has no published pages", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items: [] } })))

        await expect(fetchPublishedPages()).resolves.toEqual([])
    })
})

describe("fetchPublishedPosts — the same shape, out of a differently-shaped collection", () => {
    /** One published post, as EmDash's list API serves it. */
    const postItem = {
        id: "post-1",
        slug: "first-post",
        status: "published",
        data: {
            title: "First Post",
            excerpt: "A short blurb.",
            content: [{ _type: "block", _key: "a", style: "normal", children: [] }],
            featured_image: { id: "med-1", alt: "A violin", meta: { storageKey: "01KWY.jpg" } },
            design: "tpl-1"
        }
    }

    it("reads the posts collection", async () => {
        withCms()
        const fetchSpy = vi.fn().mockResolvedValue(json(200, { data: { items: [] } }))
        vi.stubGlobal("fetch", fetchSpy)

        await fetchPublishedPosts()

        expect(fetchSpy.mock.calls[0][0]).toContain("/_emdash/api/content/posts?")
        expect(fetchSpy.mock.calls[0][0]).toContain("status=published")
    })

    it("maps `excerpt` onto description — posts have no `description` field", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items: [postItem] } })))

        const [post] = await fetchPublishedPosts()

        expect(post.description).toBe("A short blurb.")
    })

    it("has no published_at: the field does not exist on posts, so the D3 render shows no date", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items: [postItem] } })))

        const [post] = await fetchPublishedPosts()

        expect(post.published_at).toBeNull()
    })

    it("carries featured_image through in `fields` — the only image field an outlet can bind", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items: [postItem] } })))

        const [post] = await fetchPublishedPosts()

        // ContentImage reads the raw field value out of `fields`; losing it here would make the outlet
        // unbindable everywhere, since `pages` defines no image field at all.
        expect(post.fields.featured_image).toEqual(postItem.data.featured_image)
    })

    it("surfaces the design pointer, so a post can name a template like any entry", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { data: { items: [postItem] } })))

        const [post] = await fetchPublishedPosts()

        expect(post.designRef).toBe("tpl-1")
        expect(post.slug).toBe("first-post")
    })

    it("throws on a read failure rather than building a site with every post missing", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")))

        await expect(settle(fetchPublishedPosts())).rejects.toBeInstanceOf(CmsReadError)
    })

    it("throws on a 404: posts is a seed collection, so its absence means the wrong CMS", async () => {
        withCms()
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(404, { error: { message: "not found" } })))

        // Deliberately NOT allowMissing (unlike design_template, which does not exist until setup runs).
        await expect(settle(fetchPublishedPosts())).rejects.toBeInstanceOf(CmsReadError)
    })
})

describe("fetchMenu", () => {
    /**
     * Fetches a fresh module instance and returns its `fetchMenu`. `fetchMenu` resolves page/post
     * references through a module-level cache (see `getPageHrefMap` in emdash-api.ts) that is meant to
     * survive one `astro build`'s worth of page renders — exactly the thing each of these tests must NOT
     * share, or an earlier test's mocked pages/posts would leak into a later test's assertions.
     */
    async function freshFetchMenu() {
        vi.resetModules()
        const mod = await import("../../src/lib/build/emdash-api")
        return mod.fetchMenu
    }

    /** Routes a fetch mock by substring match against the requested URL, 404ing anything unlisted. */
    function mockApi(routes: Record<string, unknown>) {
        vi.stubGlobal(
            "fetch",
            vi.fn(async (url: string) => {
                for (const [path, body] of Object.entries(routes)) {
                    if (url.includes(path)) return json(200, { data: body })
                }
                return json(404, { error: { message: "not found" } })
            })
        )
    }

    it("resolves a Custom URL item directly, without reading the pages/posts collections", async () => {
        withCms()
        const fetchSpy = vi.fn(async (url: string) => {
            if (url.includes("/_emdash/api/menus/footer")) {
                return json(200, { data: { items: [{ label: "About", type: "custom", customUrl: "/about" }] } })
            }
            throw new Error(`unexpected read: ${url}`)
        })
        vi.stubGlobal("fetch", fetchSpy)
        const fetchMenu = await freshFetchMenu()

        await expect(fetchMenu("footer")).resolves.toEqual([{ label: "About", url: "/about" }])
        expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it("drops a custom item with no customUrl authored", async () => {
        withCms()
        mockApi({
            "/_emdash/api/menus/footer": { items: [{ label: "Broken", type: "custom", customUrl: null }] }
        })
        const fetchMenu = await freshFetchMenu()

        await expect(fetchMenu("footer")).resolves.toEqual([])
    })

    it("resolves a page-reference item against the published pages collection", async () => {
        withCms()
        mockApi({
            "/_emdash/api/menus/footer": {
                items: [{ label: "Privacy Policy", type: "page", referenceId: "pg-1" }]
            },
            "/_emdash/api/content/pages": {
                items: [{ id: "pg-1", slug: "privacy-policy", status: "published", data: {} }]
            },
            "/_emdash/api/content/posts": { items: [] }
        })
        const fetchMenu = await freshFetchMenu()

        await expect(fetchMenu("footer")).resolves.toEqual([{ label: "Privacy Policy", url: "/privacy-policy" }])
    })

    it("maps the 'home'-slug page to '/', matching pages/[...slug].astro's routing", async () => {
        withCms()
        mockApi({
            "/_emdash/api/menus/primary": { items: [{ label: "Home", type: "page", referenceId: "pg-home" }] },
            "/_emdash/api/content/pages": {
                items: [{ id: "pg-home", slug: "home", status: "published", data: {} }]
            },
            "/_emdash/api/content/posts": { items: [] }
        })
        const fetchMenu = await freshFetchMenu()

        await expect(fetchMenu("primary")).resolves.toEqual([{ label: "Home", url: "/" }])
    })

    it("resolves a post-reference item under the /posts/ prefix", async () => {
        withCms()
        mockApi({
            "/_emdash/api/menus/footer": {
                items: [{ label: "Announcement", type: "post", referenceId: "post-1" }]
            },
            "/_emdash/api/content/pages": { items: [] },
            "/_emdash/api/content/posts": {
                items: [{ id: "post-1", slug: "first-post", status: "published", data: {} }]
            }
        })
        const fetchMenu = await freshFetchMenu()

        await expect(fetchMenu("footer")).resolves.toEqual([{ label: "Announcement", url: "/posts/first-post" }])
    })

    it("drops a reference item whose target is not published (draft, deleted, or a stale id)", async () => {
        withCms()
        mockApi({
            "/_emdash/api/menus/footer": {
                items: [{ label: "Draft Page", type: "page", referenceId: "pg-missing" }]
            },
            "/_emdash/api/content/pages": { items: [] },
            "/_emdash/api/content/posts": { items: [] }
        })
        const fetchMenu = await freshFetchMenu()

        await expect(fetchMenu("footer")).resolves.toEqual([])
    })

    it("drops an unsupported reference kind (taxonomy, custom-collection entries) rather than guessing", async () => {
        withCms()
        mockApi({
            "/_emdash/api/menus/footer": { items: [{ label: "A Tag", type: "taxonomy", referenceId: "tax-1" }] }
        })
        const fetchMenu = await freshFetchMenu()

        await expect(fetchMenu("footer")).resolves.toEqual([])
    })

    it("returns [] for an unauthored menu (404) instead of failing the build", async () => {
        withCms()
        mockApi({})
        const fetchMenu = await freshFetchMenu()

        await expect(fetchMenu("footer")).resolves.toEqual([])
    })
})
