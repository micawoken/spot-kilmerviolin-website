/**
 * tests/api/request-options.test.ts
 *
 * Request options travel as boolean query parameters (the retired X-MWMSC-Request-Meta header is rejected):
 * the shared parser, the identity body validator, and the route-level behavior that depends on them
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

import { describe, it, expect } from "vitest"

import { parseAPIRequest, parseIdentityAddition, parseRequestFlags } from "../../src/lib/api/common.ts"
import { POST as composersPOST, GET as composersGET } from "../../src/pages/api/v1/composers.ts"
import { GET as tokensGET } from "../../src/pages/api/v1/tokens.ts"
import { POST as identityPOST, DELETE as identityDELETE } from "../../src/pages/api/v1/identity.ts"

const BASE = "https://localhost/api/v1/composers"
const LEGACY_HEADER = "X-MWMSC-Request-Meta"

function get(query: string, headers: Record<string, string> = {}): Request {
    return new Request(`${BASE}${query}`, { headers })
}

function post(url: string, body: unknown, headers: Record<string, string> = {}): Request {
    return new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body)
    })
}

function identity(admin: boolean): Identity {
    return {
        sub: "sub-test",
        email: "options-test@example.com",
        nbf: 0,
        exp: Number.POSITIVE_INFINITY,
        allowed: true,
        active: true,
        enrollable: false,
        roles: [],
        id: 1,
        admin,
        userinfo: {} as Identity["userinfo"],
        permissions: {} as IdentityPermissions
    }
}

async function comment(response: Response): Promise<string> {
    return ((await response.json()) as { comment: string }).comment
}

describe("parseRequestFlags", () => {
    it("returns undefined without reading the query when the route declares no flags", () => {
        expect(parseRequestFlags(get("?anything=goes"))).toBeUndefined()
    })

    it("returns an empty object when no option is present", () => {
        expect(parseRequestFlags(get(""), ["full"])).toEqual({})
    })

    it("parses true and false", () => {
        expect(parseRequestFlags(get("?full=true&names=false"), ["full", "names"])).toEqual({
            full: true,
            names: false
        })
    })

    it("rejects a parameter the route does not accept", () => {
        const result = parseRequestFlags(get("?elevate=true"), ["full"])
        expect(result).toBeInstanceOf(Error)
        expect((result as Error).message).toContain("Unknown query parameter 'elevate'")
    })

    it("rejects every parameter when the route accepts none", () => {
        expect(parseRequestFlags(get("?full=true"), [])).toBeInstanceOf(Error)
    })

    it.each(["1", "yes", "TRUE", "", "null"])("rejects the non-boolean value %j", (value) => {
        const result = parseRequestFlags(get(`?full=${value}`), ["full"])
        expect(result).toBeInstanceOf(Error)
        expect((result as Error).message).toContain("must be true or false")
    })

    it("rejects a valueless parameter", () => {
        expect(parseRequestFlags(get("?full"), ["full"])).toBeInstanceOf(Error)
    })

    it("rejects a repeated parameter, whatever its values", () => {
        const result = parseRequestFlags(get("?elevate=false&elevate=true"), ["elevate"])
        expect(result).toBeInstanceOf(Error)
        expect((result as Error).message).toContain("must not be repeated")
    })

    it("treats parameter names as case-sensitive", () => {
        expect(parseRequestFlags(get("?Full=true"), ["full"])).toBeInstanceOf(Error)
    })

    it("rejects the retired header, with or without declared flags", () => {
        const request = get("", { [LEGACY_HEADER]: JSON.stringify({ full: true }) })
        expect(parseRequestFlags(request, ["full"])).toBeInstanceOf(Error)
        const result = parseRequestFlags(request)
        expect(result).toBeInstanceOf(Error)
        expect((result as Error).message).toContain("query parameters")
    })
})

describe("parseAPIRequest options", () => {
    it("returns the options beside a JSON body", async () => {
        const request = post(`${BASE}?bulk=true&dry_run=true`, [{ a: 1 }, { a: 2 }])
        expect(await parseAPIRequest(request, ["bulk", "dry_run"])).toEqual({
            payload: [{ a: 1 }, { a: 2 }],
            meta: { bulk: true, dry_run: true }
        })
    })

    it("returns the options for a bodiless request", async () => {
        expect(await parseAPIRequest(get("?full=true"), ["full"])).toEqual({ payload: null, meta: { full: true } })
    })

    it("keeps the options when the body is an empty array", async () => {
        const result = await parseAPIRequest(post(`${BASE}?dry_run=true`, []), ["dry_run"])
        expect(result).toEqual({ payload: null, meta: { dry_run: true } })
    })

    it("omits meta when the route declares no flags", async () => {
        expect(await parseAPIRequest(get("?full=true"))).toEqual({ payload: null, meta: undefined })
    })

    it("rejects the retired header even when the body is valid", async () => {
        const request = post(BASE, [{ a: 1 }], { [LEGACY_HEADER]: JSON.stringify({ bulk: true }) })
        expect(await parseAPIRequest(request, ["bulk"])).toBeInstanceOf(Error)
    })

    it("still rejects a malformed body before reading options", async () => {
        const request = new Request(`${BASE}?bulk=true`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{"
        })
        const result = await parseAPIRequest(request, ["bulk"])
        expect(result).toBeInstanceOf(Error)
        expect((result as Error).message).toContain("Failed to parse request body")
    })
})

describe("parseIdentityAddition", () => {
    it("accepts a bare email", () => {
        expect(parseIdentityAddition({ email: "a@example.com" })).toEqual({ email: "a@example.com" })
    })

    it("accepts an enrollment and normalizes an omitted major and class_year to null", () => {
        expect(parseIdentityAddition({ email: "a@example.com", enroll: { confer: true, name: "Ada" } })).toEqual({
            email: "a@example.com",
            enroll: { confer: true, name: "Ada", major: null, class_year: null }
        })
    })

    it("keeps a supplied major and class_year", () => {
        expect(
            parseIdentityAddition({
                email: "a@example.com",
                enroll: { confer: false, name: "Ada", major: "Physics", class_year: 2027 }
            })
        ).toEqual({
            email: "a@example.com",
            enroll: { confer: false, name: "Ada", major: "Physics", class_year: 2027 }
        })
    })

    it.each([
        ["the retired bare-string item", "a@example.com"],
        ["null", null],
        ["an array", ["a@example.com"]],
        ["a missing email", { enroll: { confer: true, name: "Ada" } }],
        ["a non-string email", { email: 5 }],
        ["a null enroll", { email: "a@example.com", enroll: null }],
        ["an array enroll", { email: "a@example.com", enroll: [] }],
        ["a missing confer", { email: "a@example.com", enroll: { name: "Ada" } }],
        ["a string confer", { email: "a@example.com", enroll: { confer: "true", name: "Ada" } }],
        ["a missing name", { email: "a@example.com", enroll: { confer: true } }],
        ["a numeric major", { email: "a@example.com", enroll: { confer: true, name: "Ada", major: 5 } }],
        ["a string class_year", { email: "a@example.com", enroll: { confer: true, name: "Ada", class_year: "2027" } }]
    ])("rejects %s", (_label, item) => {
        expect(typeof parseIdentityAddition(item)).toBe("string")
    })
})

describe("route options: bulk create (POST /api/v1/composers)", () => {
    const locals = { identity: identity(true) }

    it("requires bulk=true for a multi-item body", async () => {
        const response = await composersPOST({ request: post(BASE, [{}, {}]), locals } as any)
        expect(response.status).toBe(400)
        expect(await comment(response)).toContain("bulk=true")
    })

    it("honors bulk=true and dry_run=true, returning a per-row report without writing", async () => {
        const response = await composersPOST({
            request: post(`${BASE}?bulk=true&dry_run=true`, [{}, {}]),
            locals
        } as any)
        expect(response.status).toBe(200)
        const body = (await response.json()) as { payload: { dry_run: boolean; ok: boolean; count: number } }
        expect(body.payload).toMatchObject({ dry_run: true, ok: false, count: 2 })
    })

    it("rejects an option this route does not take instead of ignoring it", async () => {
        const response = await composersPOST({ request: post(`${BASE}?elevate=true`, [{}]), locals } as any)
        expect(response.status).toBe(400)
        expect(await comment(response)).toContain("Unknown query parameter 'elevate'")
    })

    it("rejects a non-boolean bulk value", async () => {
        const response = await composersPOST({ request: post(`${BASE}?bulk=1`, [{}, {}]), locals } as any)
        expect(response.status).toBe(400)
        expect(await comment(response)).toContain("must be true or false")
    })

    it("does not honor bulk sent in the retired header", async () => {
        const request = post(BASE, [{}, {}], { [LEGACY_HEADER]: JSON.stringify({ bulk: true }) })
        const response = await composersPOST({ request, locals } as any)
        expect(response.status).toBe(400)
        expect(await comment(response)).toContain("query parameters")
    })
})

describe("route options: build-token reads require ?full=true", () => {
    const locals = { buildTokenAuth: true }

    it("rejects a build-token read without full", async () => {
        const response = await composersGET({ request: get(""), locals } as any)
        expect(response.status).toBe(400)
        expect(await comment(response)).toContain("full=true")
    })

    it("rejects full=false", async () => {
        const response = await composersGET({ request: get("?full=false"), locals } as any)
        expect(response.status).toBe(400)
        expect(await comment(response)).toContain("full=true")
    })

    it("rejects a malformed full value before the full check", async () => {
        const response = await composersGET({ request: get("?full=maybe"), locals } as any)
        expect(response.status).toBe(400)
        expect(await comment(response)).toContain("must be true or false")
    })

    it("does not accept full sent in the retired header", async () => {
        const request = get("", { [LEGACY_HEADER]: JSON.stringify({ full: true }) })
        const response = await composersGET({ request, locals } as any)
        expect(response.status).toBe(400)
        expect(await comment(response)).toContain("query parameters")
    })
})

describe("route options: GET /api/v1/tokens ?all=true is admin only", () => {
    it("forbids a non-admin from listing every token", async () => {
        const response = await tokensGET({
            request: new Request("https://localhost/api/v1/tokens?all=true"),
            locals: { identity: identity(false) }
        } as any)
        expect(response.status).toBe(403)
        expect(await comment(response)).toContain("'all' requires admin")
    })

    it("rejects a malformed all value", async () => {
        const response = await tokensGET({
            request: new Request("https://localhost/api/v1/tokens?all=yes"),
            locals: { identity: identity(true) }
        } as any)
        expect(response.status).toBe(400)
    })
})

describe("route options: /api/v1/identity", () => {
    const url = "https://localhost/api/v1/identity"
    const locals = { identity: identity(true) }

    it("DELETE rejects the retired header, so autodeactivation=false is never silently dropped", async () => {
        const request = new Request(url, {
            method: "DELETE",
            headers: {
                "Content-Type": "application/json",
                [LEGACY_HEADER]: JSON.stringify({ autodeactivation: false })
            },
            body: JSON.stringify(["someone@example.com"])
        })
        const response = await identityDELETE({ request, locals } as any)
        expect(response.status).toBe(400)
        expect(await comment(response)).toContain("query parameters")
    })

    it("DELETE rejects a malformed autodeactivation value", async () => {
        const request = new Request(`${url}?autodeactivation=nope`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(["someone@example.com"])
        })
        expect((await identityDELETE({ request, locals } as any)).status).toBe(400)
    })

    it("POST rejects the retired bare-email item shape", async () => {
        const response = await identityPOST({ request: post(url, ["someone@example.com"]), locals } as any)
        expect(response.status).toBe(400)
    })

    it("POST rejects an enrollment with missing fields", async () => {
        const response = await identityPOST({
            request: post(url, [{ email: "someone@example.com", enroll: { confer: true } }]),
            locals
        } as any)
        expect(response.status).toBe(400)
    })

    it("POST takes no query parameters", async () => {
        const response = await identityPOST({
            request: post(`${url}?autoenrollment=true`, [{ email: "someone@example.com" }]),
            locals
        } as any)
        expect(response.status).toBe(400)
        expect(await comment(response)).toContain("Unknown query parameter 'autoenrollment'")
    })
})
