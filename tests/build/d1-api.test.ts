/**
 * tests/build/d1-api.test.ts
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

/**
 * Fetches a fresh module instance. `fetchComposers`/`fetchAllContributors`/`fetchCompositions` each cache
 * their read for the life of one build process (see their doc comments in d1-api.ts) — exactly the thing
 * each of these tests must NOT share, or an earlier test's mocked response (or thrown error) would leak
 * into a later test's assertions. Mirrors emdash-api.test.ts's `freshFetchMenu` helper for the same reason.
 */
async function freshD1Api() {
    vi.resetModules()
    return import("../../src/lib/build/d1-api")
}

/** A GET /api/v1/{composers,contributors,works} response, as the deployed Worker would return it. */
function apiResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function success<T>(payload: T): Response {
    return apiResponse(200, { success: true, payload, comment: "" })
}

function withConfig() {
    vi.stubEnv("CONTENT_API_BASE", "https://kilmer.example.test")
    vi.stubEnv("CF_ACCESS_CLIENT_ID", "client-1")
    vi.stubEnv("CF_ACCESS_CLIENT_SECRET", "secret-1")
    vi.stubEnv("BUILD_API_TOKEN", "skv_build_tok-1")
}

/** Settles a read under the fake clock — retries back off, so the clock must be run forward. */
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
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

describe("build API unconfigured — the bootstrap build", () => {
    it("returns null instead of throwing when any of the four env vars is unset", async () => {
        const { fetchComposers } = await freshD1Api()
        const fetchSpy = vi.fn()
        vi.stubGlobal("fetch", fetchSpy)

        await expect(fetchComposers()).resolves.toBeNull()
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it("returns null when BUILD_API_TOKEN alone is missing (Access headers are not enough — D3)", async () => {
        const { fetchComposers } = await freshD1Api()
        vi.stubEnv("CONTENT_API_BASE", "https://kilmer.example.test")
        vi.stubEnv("CF_ACCESS_CLIENT_ID", "client-1")
        vi.stubEnv("CF_ACCESS_CLIENT_SECRET", "secret-1")
        const fetchSpy = vi.fn()
        vi.stubGlobal("fetch", fetchSpy)

        await expect(fetchComposers()).resolves.toBeNull()
        expect(fetchSpy).not.toHaveBeenCalled()
    })
})

describe("build API configured but failing", () => {
    it("throws BuildTokenReadError instead of returning an empty/partial site", async () => {
        const { BuildTokenReadError, fetchComposers } = await freshD1Api()
        withConfig()
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")))

        await expect(settle(fetchComposers())).rejects.toBeInstanceOf(BuildTokenReadError)
    })

    it("retries a transient (5xx) failure and succeeds", async () => {
        const { fetchComposers } = await freshD1Api()
        withConfig()
        const fetchSpy = vi
            .fn()
            .mockResolvedValueOnce(apiResponse(500, { success: false, payload: null, comment: "boom" }))
            .mockResolvedValueOnce(success([{ id: 1, name: "Bach", tags: [] }]))
        vi.stubGlobal("fetch", fetchSpy)

        await expect(settle(fetchComposers())).resolves.toEqual([expect.objectContaining({ id: 1, name: "Bach" })])
        expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it("does not retry an API-level failure (unrecognized token / bad meta), which reads the same every time", async () => {
        const { fetchComposers } = await freshD1Api()
        withConfig()
        const fetchSpy = vi.fn().mockResolvedValue(apiResponse(200, { success: false, payload: null, comment: "not authorized" }))
        vi.stubGlobal("fetch", fetchSpy)

        await expect(settle(fetchComposers())).rejects.toThrow(/not authorized/)
        expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it("does not retry a 403 (a standing fact about the credential, not a transient failure)", async () => {
        const { fetchComposers } = await freshD1Api()
        withConfig()
        const fetchSpy = vi.fn().mockResolvedValue(apiResponse(403, { success: false, payload: null, comment: "Forbidden" }))
        vi.stubGlobal("fetch", fetchSpy)

        await expect(settle(fetchComposers())).rejects.toThrow(/403/)
        expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
})

describe("outbound request shape", () => {
    it("carries the Access service-token headers, X-Build-Token, and X-MWMSC-Request-Meta full:true", async () => {
        const { fetchComposers } = await freshD1Api()
        withConfig()
        const fetchSpy = vi.fn().mockResolvedValue(success([]))
        vi.stubGlobal("fetch", fetchSpy)

        await fetchComposers()

        const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
        expect(url).toBe("https://kilmer.example.test/api/v1/composers")
        const headers = init.headers as Record<string, string>
        expect(headers["CF-Access-Client-Id"]).toBe("client-1")
        expect(headers["CF-Access-Client-Secret"]).toBe("secret-1")
        expect(headers["X-Build-Token"]).toBe("skv_build_tok-1")
        expect(JSON.parse(headers["X-MWMSC-Request-Meta"])).toEqual({ full: true })
    })
})

describe("fetchContributors — public listing", () => {
    it("strips protected/identity columns and excludes contributors tagged `hidden`, but keeps inactive ones", async () => {
        const { fetchContributors } = await freshD1Api()
        withConfig()
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                success([
                    {
                        id: 1,
                        name: "Ada",
                        class_year: null,
                        major: null,
                        phases: null,
                        bio: null,
                        public_email: null,
                        identity_email: "ada@example.test",
                        active: true,
                        roles: ["admin"],
                        admin: true,
                        image: null,
                        tags: []
                    },
                    {
                        // REGRESSION GUARD: inactive, but not hidden — active no longer gates page
                        // existence, so this record must still come through (redacted).
                        id: 2,
                        name: "Retired Ray",
                        class_year: null,
                        major: null,
                        phases: null,
                        bio: null,
                        public_email: null,
                        identity_email: "ray@example.test",
                        active: false,
                        roles: [],
                        admin: false,
                        image: null,
                        tags: []
                    },
                    {
                        id: 3,
                        name: "Hidden Hank",
                        class_year: null,
                        major: null,
                        phases: null,
                        bio: null,
                        public_email: null,
                        identity_email: "hank@example.test",
                        active: true,
                        roles: [],
                        admin: false,
                        image: null,
                        tags: ["hidden"]
                    }
                ])
            )
        )

        const result = await fetchContributors()
        expect(result?.map((c) => c.name).sort()).toEqual(["Ada", "Retired Ray"])
        expect(result?.[0]).not.toHaveProperty("identity_email")
        expect(result?.[0]).not.toHaveProperty("roles")
        expect(result?.[0]).not.toHaveProperty("admin")
        expect(result?.[0]).not.toHaveProperty("active")
    })
})

describe("fetchAllContributors — unredacted, active or not (entity-records.ts's reference-resolution source)", () => {
    it("includes an inactive contributor and does NOT strip protected columns", async () => {
        const { fetchAllContributors } = await freshD1Api()
        withConfig()
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                success([
                    {
                        id: 1,
                        name: "Ada",
                        class_year: null,
                        major: null,
                        phases: null,
                        bio: null,
                        public_email: null,
                        identity_email: "ada@example.test",
                        active: true,
                        roles: ["admin"],
                        admin: true,
                        image: null,
                        tags: []
                    },
                    {
                        id: 2,
                        name: "Grace",
                        class_year: null,
                        major: null,
                        phases: null,
                        bio: null,
                        public_email: null,
                        identity_email: "grace@example.test",
                        active: false,
                        roles: [],
                        admin: false,
                        image: null,
                        tags: []
                    }
                ])
            )
        )

        const result = await fetchAllContributors()
        // Both rows, including the inactive one — buildReferenceIndex needs to resolve a composition's
        // reference to an inactive contributor's NAME even though that contributor gets no public page.
        expect(result).toHaveLength(2)
        expect(result?.map((c) => c.name).sort()).toEqual(["Ada", "Grace"])
        expect(result?.find((c) => c.name === "Grace")?.active).toBe(false)
        // Unredacted: this reader must not strip protected columns (redaction happens at fetchContributors,
        // the public-listing reader — never here, or the "unredacted" contract callers rely on breaks silently).
        expect(result?.[0]).toHaveProperty("identity_email")
        expect(result?.[0]).toHaveProperty("roles")
    })
})

describe("fetchCompositions — flat CompositionRecord shape (unified field-outlet rewrite)", () => {
    it("returns bare CompositionRecords — reference resolution now lives entirely in entity-records.ts", async () => {
        const { fetchCompositions } = await freshD1Api()
        withConfig()
        const compositionRecord = {
            id: 10,
            name: "Concerto",
            composer_id: 1,
            contrib_primary_1: 2,
            contrib_primary_2: null,
            contrib_addl: [],
            author_secondary: "",
            type: "Chamber",
            part: null,
            rating_suzuki: null,
            rating_nyssma: null,
            publish_location: "Loc",
            publish_name: "Pub",
            publish_year: 2000,
            uri_type: "other",
            uri: "",
            key: null,
            range: null,
            position_highest: null,
            notes_pedagogical: null,
            notes_historical: null,
            notes_other: null,
            image: null,
            phases: [],
            entry_date: 1767225600000,
            tags: [],
            change_date: 1767225600000
        }

        const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
            if (url.endsWith("/api/v1/works")) return success([compositionRecord])
            throw new Error(`unexpected request: ${url}`)
        })
        vi.stubGlobal("fetch", fetchSpy)

        // Only one request is expected now (works alone) — this function no longer reads
        // composers/contributors itself, so a call to either route would hit the `throw` above and fail
        // the test, which is itself the regression guard for "reference resolution moved out of here".
        const result = await fetchCompositions()
        expect(result).toHaveLength(1)
        expect(result?.[0].id).toBe(10)
        expect(result?.[0].name).toBe("Concerto")
        expect(result?.[0].composer_id).toBe(1)
        expect(result?.[0]).not.toHaveProperty("names")
        expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
})

describe("build-lifetime memoization", () => {
    it("fetchComposers reads the network once no matter how many pages call it in one build", async () => {
        const { fetchComposers } = await freshD1Api()
        withConfig()
        const fetchSpy = vi.fn().mockResolvedValue(success([{ id: 1, name: "Bach", tags: [] }]))
        vi.stubGlobal("fetch", fetchSpy)

        const [first, second, third] = await Promise.all([fetchComposers(), fetchComposers(), fetchComposers()])
        expect(first).toBe(second)
        expect(second).toBe(third)
        expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it("fetchAllContributors (and fetchContributors, which reads through it) reads the network once", async () => {
        const { fetchAllContributors, fetchContributors } = await freshD1Api()
        withConfig()
        const fetchSpy = vi.fn().mockResolvedValue(
            success([
                {
                    id: 1,
                    name: "Ada",
                    class_year: null,
                    major: null,
                    phases: null,
                    bio: null,
                    public_email: null,
                    identity_email: "ada@example.test",
                    active: true,
                    roles: [],
                    admin: false,
                    image: null,
                    tags: []
                }
            ])
        )
        vi.stubGlobal("fetch", fetchSpy)

        await Promise.all([fetchAllContributors(), fetchAllContributors(), fetchContributors(), fetchContributors()])
        expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it("fetchCompositions reads the network once no matter how many pages call it in one build", async () => {
        const { fetchCompositions } = await freshD1Api()
        withConfig()
        const fetchSpy = vi.fn().mockResolvedValue(success([]))
        vi.stubGlobal("fetch", fetchSpy)

        await Promise.all([fetchCompositions(), fetchCompositions()])
        expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
})
