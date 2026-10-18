/**
 * tests/path-normalization.test.ts
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
 * Regression coverage for percent-encoded path bypass of the raw-path middleware.
 *
 * Astro decodes the pathname before routing but request.url keeps the escapes, so `/%5Femdash/api/media`
 * reached EmDash while the access, identity, rate-limit and media-upload middleware all compared the
 * encoded first segment and skipped it.
 */

import { describe, it, expect, vi } from "vitest"
import type { MiddlewareHandler } from "astro"
import { pathNormalization } from "../src/middleware/path_normalization"

type Context = Parameters<MiddlewareHandler>[0]

async function run(path: string) {
    const request = new Request(`https://kilmer.example${path}`)
    const next = vi.fn(async () => new Response("ok"))
    const response = (await pathNormalization({ request } as Context, next)) as Response
    return { response, next }
}

const UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"

describe("pathNormalization", () => {
    it.each([
        "/%5Femdash/api/media",
        "/%5femdash/api/settings",
        "/_emdash/api/%6Dedia/upload-url",
        "/_emdash/%61pi/media",
        "/%61dmin/users"
    ])("rejects %s", async (path) => {
        const { response, next } = await run(path)
        expect(response.status).toBe(400)
        expect(next).not.toHaveBeenCalled()
    })

    it("rejects an escape of every unreserved character in either hex case", async () => {
        for (const char of UNRESERVED) {
            const hex = char.charCodeAt(0).toString(16).padStart(2, "0")
            for (const escape of [`%${hex.toLowerCase()}`, `%${hex.toUpperCase()}`]) {
                const { response } = await run(`/files/a${escape}b`)
                expect(response.status, escape).toBe(400)
            }
        }
    })

    it.each([
        "/",
        "/_emdash/api/media/upload-url",
        "/files/my%20photo.png",
        "/files/100%25.png",
        "/composers/caf%C3%A9",
        "/files/a%2Fb",
        "/files/a%5Bb%5D"
    ])("passes %s", async (path) => {
        const { next } = await run(path)
        expect(next).toHaveBeenCalledOnce()
    })

    it("ignores escapes in the query string", async () => {
        const { next } = await run("/search?q=%61bc")
        expect(next).toHaveBeenCalledOnce()
    })
})
