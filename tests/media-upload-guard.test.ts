/**
 * tests/media-upload-guard.test.ts
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

/**
 * Coverage for the EmDash media upload guard across every route that writes media bytes.
 *
 * With an R2 binding EmDash's admin client uploads through upload-url, a PUT of the bytes and confirm, and
 * replaces images through PUT replace. Only POST /media used to be guarded, so the other routes skipped the
 * size cap, the format block and the shared R2 quota.
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { env } from "cloudflare:workers"
import type { MiddlewareHandler } from "astro"
import { emdashMediaCapacity } from "../src/middleware/emdash_media_capacity"
import { getR2Usage } from "../src/lib/api/r2-quota"

type Context = Parameters<MiddlewareHandler>[0]

const ORIGIN = "https://kilmer.example"
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(24).fill(0)])
const ICNS = new Uint8Array([0x69, 0x63, 0x6e, 0x73, ...new Array(28).fill(0)])

async function resetQuota(): Promise<void> {
    const stub = env.R2_QUOTA.getByName("shared-r2-capacity")
    const response = await stub.fetch("https://r2-quota.internal/reconcile", { method: "POST" })
    expect(response.ok).toBe(true)
}

function multipart(bytes: Uint8Array<ArrayBuffer>,name = "photo.png", type = "image/png"): FormData {
    const form = new FormData()
    form.set("file", new File([bytes], name, { type }))
    return form
}

/** Runs the middleware against a request and reports whether it fell through to EmDash. */
async function run(method: string, path: string, body?: BodyInit, nextStatus = 200) {
    const request = new Request(`${ORIGIN}${path}`, { method, body })
    const next = vi.fn(async () => new Response(null, { status: nextStatus }))
    const response = await emdashMediaCapacity({ request } as Context, next)
    return { response: response as Response, next }
}

describe("signed-upload routes", () => {
    it.each([
        ["POST", "/_emdash/api/media/upload-url"],
        ["PUT", "/_emdash/api/media/01ABC/upload"],
        ["POST", "/_emdash/api/media/01ABC/confirm"]
    ])("refuses %s %s with 501 so the admin client falls back to the guarded route", async (method, path) => {
        const { response, next } = await run(method, path, "{}")
        expect(response.status).toBe(501)
        expect(next).not.toHaveBeenCalled()
    })

    it("leaves file reads whose key resembles a guarded segment alone", async () => {
        const { next } = await run("GET", "/_emdash/api/media/file/upload")
        expect(next).toHaveBeenCalledOnce()
    })

    it("leaves metadata edits alone", async () => {
        const { next } = await run("PUT", "/_emdash/api/media/01ABC", "{}")
        expect(next).toHaveBeenCalledOnce()
    })
})

describe("PUT replace", () => {
    beforeEach(resetQuota)

    it("refuses a disguised ICNS payload before EmDash sees it", async () => {
        const { response, next } = await run("PUT", "/_emdash/api/media/01ABC/replace", multipart(ICNS))
        expect(response.status).toBe(415)
        expect(next).not.toHaveBeenCalled()
        expect(await getR2Usage()).toBe(0)
    })

    it("claims capacity for a stored replacement", async () => {
        const { response, next } = await run("PUT", "/_emdash/api/media/01ABC/replace", multipart(PNG), 200)
        expect(response.status).toBe(200)
        expect(next).toHaveBeenCalledOnce()
        expect(await getR2Usage()).toBe(PNG.byteLength)
    })

    it("releases the claim when EmDash rejects the replacement", async () => {
        await run("PUT", "/_emdash/api/media/01ABC/replace", multipart(PNG), 400)
        expect(await getR2Usage()).toBe(0)
    })

    it("passes a request with no file through so EmDash answers it", async () => {
        const { next } = await run("PUT", "/_emdash/api/media/01ABC/replace", new FormData())
        expect(next).toHaveBeenCalledOnce()
        expect(await getR2Usage()).toBe(0)
    })
})

describe("POST media", () => {
    beforeEach(resetQuota)

    it("keeps the claim for a new upload (201)", async () => {
        await run("POST", "/_emdash/api/media", multipart(PNG), 201)
        expect(await getR2Usage()).toBe(PNG.byteLength)
    })

    it("releases the claim for a deduplicated upload (200)", async () => {
        await run("POST", "/_emdash/api/media", multipart(PNG), 200)
        expect(await getR2Usage()).toBe(0)
    })
})
