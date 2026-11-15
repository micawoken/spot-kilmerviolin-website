/**
 * tests/scripts/connector-options.test.ts
 *
 * The connector sends request options as query parameters and never as the retired
 * X-MWMSC-Request-Meta header; undefined options are omitted so the server default applies
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
    addIdentity,
    bulkCreate,
    bulkDryRun,
    deleteIdentity,
    deleteWork,
    executeCommand,
    getContributor,
    getWork,
    listComposer,
    listContributor,
    listFiles,
    listTokens,
    listWork,
    purgeSite,
    rebuildSite,
    replaceWork,
    updateContributor,
    updateWork
} from "../../src/scripts/connector"

const ok = () => new Response(JSON.stringify({ success: true, payload: null, comment: "" }), { status: 200 })

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
    fetchSpy = vi.fn().mockImplementation(async () => ok())
    vi.stubGlobal("fetch", fetchSpy)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

/** The URL and init of the single request the last call issued. */
function lastRequest(): { url: string; init: RequestInit; headers: Record<string, string> } {
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    return { url, init, headers: (init.headers ?? {}) as Record<string, string> }
}

describe("connector request options", () => {
    it("sends no query string when no option is set", async () => {
        await listComposer()
        expect(lastRequest().url).toBe("/api/v1/composers")
    })

    it("sends a false option explicitly rather than dropping it", async () => {
        await listComposer(false)
        expect(lastRequest().url).toBe("/api/v1/composers?full=false")
    })

    it.each([
        ["listComposer", () => listComposer(true), "/api/v1/composers?full=true"],
        ["listContributor", () => listContributor(true), "/api/v1/contributors?full=true"],
        ["listFiles", () => listFiles(true), "/api/v1/files?full=true"],
        ["listWork", () => listWork(true, true), "/api/v1/works?full=true&names=true"],
        ["getWork", () => getWork(7, true), "/api/v1/works/7?names=true"],
        ["getContributor", () => getContributor(3, true), "/api/v1/contributors/3?elevate=true"],
        ["updateContributor", () => updateContributor(3, {}, true), "/api/v1/contributors/3?elevate=true"],
        ["listTokens", () => listTokens(true), "/api/v1/tokens?all=true"],
        ["rebuildSite", () => rebuildSite(true), "/api/v1/site?elevate=true"],
        ["deleteWork", () => deleteWork(7, true), "/api/v1/works/7?elevate=true"],
        [
            "replaceWork",
            () => replaceWork(7, {} as Composition, true, true),
            "/api/v1/works/7?elevate=true&direct_contrib=true"
        ],
        ["updateWork", () => updateWork(7, {}, true, false), "/api/v1/works/7?elevate=true&direct_contrib=false"],
        ["deleteIdentity", () => deleteIdentity("a@example.com", false), "/api/v1/identity?autodeactivation=false"]
    ])("%s sends its options in the query string", async (_name, call, expected) => {
        await call()
        const { url, headers } = lastRequest()
        expect(url).toBe(expected)
        expect(headers["X-MWMSC-Request-Meta"]).toBeUndefined()
    })

    it("omits an unset option from a call that sets another", async () => {
        await replaceWork(7, {} as Composition, true)
        expect(lastRequest().url).toBe("/api/v1/works/7?elevate=true")
    })

    it("sends bulk=true on a bulk commit and adds dry_run on a dry run", async () => {
        fetchSpy.mockImplementationOnce(
            async () => new Response(JSON.stringify({ success: true, payload: [1, 2], comment: "" }), { status: 200 })
        )
        await bulkCreate("composers", [{}, {}])
        expect(lastRequest().url).toBe("/api/v1/composers?bulk=true")
        fetchSpy.mockClear()
        await bulkDryRun("works", [{}, {}])
        expect(lastRequest().url).toBe("/api/v1/works?dry_run=true&bulk=true")
    })

    it("sends the command batch flag in the query string and the commands as the body", async () => {
        await executeCommand(["SELECT 1", "SELECT 2"], false)
        const { url, init, headers } = lastRequest()
        expect(url).toBe("/api/v1/command?batch=false")
        expect(JSON.parse(init.body as string)).toEqual(["SELECT 1", "SELECT 2"])
        expect(headers["Content-Type"]).toBe("application/json")
        expect(headers["X-MWMSC-Request-Meta"]).toBeUndefined()
    })
})

describe("connector identity bodies", () => {
    it("addIdentity sends a bare email item without enrollment", async () => {
        await addIdentity("a@example.com")
        const { url, init } = lastRequest()
        expect(url).toBe("/api/v1/identity")
        expect(JSON.parse(init.body as string)).toEqual([{ email: "a@example.com" }])
    })

    it("addIdentity moves enrollment fields into the body, never the URL", async () => {
        await addIdentity("a@example.com", true, true, "Ada Lovelace", "Physics", 2027)
        const { url, init } = lastRequest()
        expect(url).toBe("/api/v1/identity")
        expect(JSON.parse(init.body as string)).toEqual([
            {
                email: "a@example.com",
                enroll: { confer: true, name: "Ada Lovelace", major: "Physics", class_year: 2027 }
            }
        ])
    })

    it("addIdentity ignores enrollment fields when autoenrollment is off", async () => {
        await addIdentity("a@example.com", false, true, "Ada Lovelace")
        expect(JSON.parse(lastRequest().init.body as string)).toEqual([{ email: "a@example.com" }])
    })

    it("deleteIdentity keeps the email in the body", async () => {
        await deleteIdentity("a@example.com")
        const { url, init } = lastRequest()
        expect(url).toBe("/api/v1/identity")
        expect(JSON.parse(init.body as string)).toEqual(["a@example.com"])
    })
})

describe("connector requests without options", () => {
    it("sends a bodiless request with no headers", async () => {
        await purgeSite()
        expect(lastRequest().init.headers).toBeUndefined()
    })
})
