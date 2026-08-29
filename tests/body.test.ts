/**
 * tests/body.test.ts
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
 * Regression coverage for the bounded request-body reader (security audit SEC-002).
 *
 * The property that matters is that an oversized body is refused *without* being buffered in full, so
 * the tests assert on how much of the stream was pulled, not only on the thrown error.
 */

import { describe, it, expect } from "vitest"
import {
    readBoundedBody,
    readBoundedFormData,
    readBoundedText,
    RequestBodyTooLargeError
} from "../src/lib/api/body"

/** A request whose body is produced lazily, counting the chunks the reader actually pulls. */
function streamingRequest(
    chunkCount: number,
    chunkSize: number,
    headers: Record<string, string> = {}
): { request: Request; pulled: () => number } {
    let pulled = 0
    let emitted = 0
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (emitted >= chunkCount) {
                controller.close()
                return
            }
            emitted += 1
            pulled += 1
            controller.enqueue(new Uint8Array(chunkSize).fill(0x61))
        }
    })
    return {
        request: new Request("https://example.test/upload", { method: "POST", body, headers }),
        pulled: () => pulled
    }
}

/** Builds a real multipart body so the parser, not a hand-rolled string, is what gets exercised. */
async function multipartRequest(fileBytes: number): Promise<Request> {
    const form = new FormData()
    form.set("fieldId", "cover")
    form.set("file", new File([new Uint8Array(fileBytes).fill(0x62)], "photo.png", { type: "image/png" }))
    return new Request("https://example.test/upload", { method: "POST", body: form })
}

describe("readBoundedBody", () => {
    it("returns a body that fits within the limit", async () => {
        const request = new Request("https://example.test/x", { method: "POST", body: "hello" })
        expect(await readBoundedBody(request, 1024)).toEqual(new TextEncoder().encode("hello"))
    })

    it("returns an empty body when the request carries none", async () => {
        const request = new Request("https://example.test/x", { method: "GET" })
        expect((await readBoundedBody(request, 1024)).byteLength).toBe(0)
    })

    it("accepts a body exactly at the limit", async () => {
        const request = new Request("https://example.test/x", { method: "POST", body: "abcd" })
        expect((await readBoundedBody(request, 4)).byteLength).toBe(4)
    })

    it("rejects a body one byte over the limit", async () => {
        const request = new Request("https://example.test/x", { method: "POST", body: "abcde" })
        await expect(readBoundedBody(request, 4)).rejects.toBeInstanceOf(RequestBodyTooLargeError)
    })

    it("stops reading as soon as the limit is passed instead of buffering the whole stream", async () => {
        // 100 chunks of 1 KiB against a 4 KiB limit: a full buffer would pull every chunk
        const { request, pulled } = streamingRequest(100, 1024)
        await expect(readBoundedBody(request, 4096)).rejects.toBeInstanceOf(RequestBodyTooLargeError)
        expect(pulled()).toBeLessThanOrEqual(5)
    })

    it("rejects a declared oversized Content-Length without reading the stream itself", async () => {
        const { request, pulled } = streamingRequest(100, 1024, { "Content-Length": "102400" })
        // the Request constructor primes one chunk on its own, so the baseline is what matters here
        const primed = pulled()
        await expect(readBoundedBody(request, 4096)).rejects.toBeInstanceOf(RequestBodyTooLargeError)
        expect(pulled()).toBe(primed)
    })

    it("still bounds a stream that declares no Content-Length", async () => {
        const { request } = streamingRequest(100, 1024)
        expect(request.headers.get("Content-Length")).toBeNull()
        await expect(readBoundedBody(request, 4096)).rejects.toBeInstanceOf(RequestBodyTooLargeError)
    })

    it("ignores an unparseable Content-Length and falls back to counting the stream", async () => {
        const { request } = streamingRequest(100, 1024, { "Content-Length": "not-a-number" })
        await expect(readBoundedBody(request, 4096)).rejects.toBeInstanceOf(RequestBodyTooLargeError)
    })

    it("refuses a nonsensical limit rather than silently reading unbounded", async () => {
        const request = new Request("https://example.test/x", { method: "POST", body: "abc" })
        await expect(readBoundedBody(request, -1)).rejects.toBeInstanceOf(TypeError)
        await expect(readBoundedBody(request, 1.5)).rejects.toBeInstanceOf(TypeError)
    })
})

describe("readBoundedText", () => {
    it("decodes a body inside the limit", async () => {
        const request = new Request("https://example.test/x", { method: "POST", body: '{"payload":[]}' })
        expect(await readBoundedText(request, 1024)).toBe('{"payload":[]}')
    })

    it("propagates the size error rather than returning a truncated string", async () => {
        const request = new Request("https://example.test/x", { method: "POST", body: "0123456789" })
        await expect(readBoundedText(request, 4)).rejects.toBeInstanceOf(RequestBodyTooLargeError)
    })
})

describe("readBoundedFormData", () => {
    it("parses a multipart body that fits", async () => {
        const form = await readBoundedFormData(await multipartRequest(64), 1024 * 1024)
        const file = form.get("file")
        expect(file).toBeInstanceOf(File)
        expect((file as File).size).toBe(64)
        expect(form.get("fieldId")).toBe("cover")
    })

    it("bounds the whole request, not just the selected file", async () => {
        // the file alone is under the limit; multipart framing and the extra field push the body over it
        const request = await multipartRequest(400)
        await expect(readBoundedFormData(request, 420)).rejects.toBeInstanceOf(RequestBodyTooLargeError)
    })

    it("surfaces a malformed multipart body as a parse failure, not a size failure", async () => {
        const request = new Request("https://example.test/x", {
            method: "POST",
            headers: { "Content-Type": "multipart/form-data; boundary=----abc" },
            body: "this is not multipart data"
        })
        const error = await readBoundedFormData(request, 1024).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(Error)
        expect(error).not.toBeInstanceOf(RequestBodyTooLargeError)
    })
})
