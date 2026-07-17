/**
 * tests/build/d1-api.test.ts
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

import { D1ReadError, fetchAllContributors, fetchComposers, fetchContributors, fetchCompositions } from "../../src/lib/build/d1-api"

/** A Cloudflare D1 REST query response, as the query endpoint would return it. */
function d1Response(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function success(rows: Record<string, unknown>[]): Response {
    return d1Response(200, { success: true, result: [{ results: rows }] })
}

function withD1() {
    vi.stubEnv("D1_ACCOUNT_ID", "acct-1")
    vi.stubEnv("D1_DATABASE_ID", "db-1")
    vi.stubEnv("D1_API_TOKEN", "tok-1")
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

describe("D1 unconfigured — the bootstrap build", () => {
    it("returns null instead of throwing when D1 env is not set", async () => {
        const fetchSpy = vi.fn()
        vi.stubGlobal("fetch", fetchSpy)

        await expect(fetchComposers()).resolves.toBeNull()
        expect(fetchSpy).not.toHaveBeenCalled()
    })
})

describe("D1 configured but failing", () => {
    it("throws D1ReadError instead of returning an empty/partial site", async () => {
        withD1()
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")))

        await expect(settle(fetchComposers())).rejects.toBeInstanceOf(D1ReadError)
    })

    it("retries a transient (5xx) failure and succeeds", async () => {
        withD1()
        const fetchSpy = vi
            .fn()
            .mockResolvedValueOnce(d1Response(500, { success: false, errors: [{ message: "boom" }] }))
            .mockResolvedValueOnce(success([{ composer_id: 1, name: "Bach", tags: "" }]))
        vi.stubGlobal("fetch", fetchSpy)

        await expect(settle(fetchComposers())).resolves.toEqual([expect.objectContaining({ id: 1, name: "Bach" })])
        expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    it("does not retry an API-level failure (bad SQL / wrong token scope), which reads the same every time", async () => {
        withD1()
        const fetchSpy = vi.fn().mockResolvedValue(d1Response(200, { success: false, errors: [{ message: "not authorized" }] }))
        vi.stubGlobal("fetch", fetchSpy)

        await expect(settle(fetchComposers())).rejects.toThrow(/not authorized/)
        expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it("selects the schema's explicit columns, never `SELECT *`", async () => {
        withD1()
        const fetchSpy = vi.fn().mockResolvedValue(success([]))
        vi.stubGlobal("fetch", fetchSpy)

        await fetchComposers()

        const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
        const body = JSON.parse(init.body as string)
        expect(body.sql).toMatch(/^SELECT composer_id, name, .* FROM composers;$/)
        expect(body.sql).not.toContain("*")
    })
})

describe("fetchContributors — public listing", () => {
    it("strips protected/identity columns and excludes inactive contributors", async () => {
        withD1()
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                success([
                    {
                        contributor_id: 1,
                        name: "Ada",
                        class_year: null,
                        major: null,
                        phases: null,
                        bio: null,
                        public_email: null,
                        identity_email: "ada@example.test",
                        active: 1,
                        roles: "admin",
                        admin: 1,
                        image: null,
                        tags: ""
                    },
                    {
                        contributor_id: 2,
                        name: "Grace",
                        class_year: null,
                        major: null,
                        phases: null,
                        bio: null,
                        public_email: null,
                        identity_email: "grace@example.test",
                        active: 0,
                        roles: "",
                        admin: 0,
                        image: null,
                        tags: ""
                    }
                ])
            )
        )

        const result = await fetchContributors()
        expect(result).toHaveLength(1)
        expect(result?.[0]).not.toHaveProperty("identity_email")
        expect(result?.[0]).not.toHaveProperty("roles")
        expect(result?.[0]).not.toHaveProperty("admin")
        expect(result?.[0].name).toBe("Ada")
    })
})

describe("fetchAllContributors — unredacted, active or not (entity-records.ts's reference-resolution source)", () => {
    it("includes an inactive contributor and does NOT strip protected columns", async () => {
        withD1()
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                success([
                    {
                        contributor_id: 1,
                        name: "Ada",
                        class_year: null,
                        major: null,
                        phases: null,
                        bio: null,
                        public_email: null,
                        identity_email: "ada@example.test",
                        active: 1,
                        roles: "admin",
                        admin: 1,
                        image: null,
                        tags: ""
                    },
                    {
                        contributor_id: 2,
                        name: "Grace",
                        class_year: null,
                        major: null,
                        phases: null,
                        bio: null,
                        public_email: null,
                        identity_email: "grace@example.test",
                        active: 0,
                        roles: "",
                        admin: 0,
                        image: null,
                        tags: ""
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

describe("fetchCompositions — flat D1 record shape (unified field-outlet rewrite)", () => {
    it("returns bare CompositionRecords — reference resolution now lives entirely in entity-records.ts", async () => {
        withD1()
        const compositionRow = {
            composition_id: 10,
            name: "Concerto",
            composer_id: 1,
            contrib_primary_1: 2,
            contrib_primary_2: null,
            contrib_addl: "",
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
            phases: "",
            entry_date: "2026-01-01",
            tags: "",
            change_date: "2026-01-01"
        }

        const fetchSpy = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
            const { sql } = JSON.parse(init.body as string)
            if (sql.includes("FROM compositions")) return success([compositionRow])
            throw new Error(`unexpected query: ${sql}`)
        })
        vi.stubGlobal("fetch", fetchSpy)

        // Only one query is expected now (compositions alone) — this function no longer reads
        // composers/contributors itself, so a call to either table would hit the `throw` above and fail
        // the test, which is itself the regression guard for "reference resolution moved out of here".
        const result = await fetchCompositions()
        expect(result).toHaveLength(1)
        expect(result?.[0].id).toBe(10)
        expect(result?.[0].name).toBe("Concerto")
        expect(result?.[0].composer_id).toBe(1)
        expect(result?.[0]).not.toHaveProperty("names")
    })
})
