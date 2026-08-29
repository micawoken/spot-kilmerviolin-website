/**
 * lib/api/body.ts
 *
 * Reads request bodies under an explicit byte ceiling
 *
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
 * Maximum JSON request body accepted by the authenticated API
 */
export const MAX_API_REQUEST_BODY_BYTES = 8 * 1024 * 1024

/** Multipart framing and small metadata fields allowed in addition to the uploaded file */
export const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024

/**
 * The parts of a request a bounded read needs
 */
interface BoundedBodyRequest {
    url: string
    method: string
    headers: Headers
    body: ReadableStream<Uint8Array> | null
}

export class RequestBodyTooLargeError extends Error {
    constructor(limit: number) {
        super(`Request body exceeds the ${limit} byte limit`)
        this.name = "RequestBodyTooLargeError"
    }
}

/**
 * Reads at most `limit` bytes from a request body, cancelling the stream as soon as the limit is passed
 *
 * @param {BoundedBodyRequest} request - the request whose body is read
 * @param {number} limit - the maximum number of body bytes to accept
 * @returns {Promise<Uint8Array<ArrayBuffer>>} the complete body, guaranteed to be at most `limit` bytes
 * @throws {RequestBodyTooLargeError} if the body exceeds `limit`
 */
export async function readBoundedBody(request: BoundedBodyRequest, limit: number): Promise<Uint8Array<ArrayBuffer>> {
    if (!Number.isSafeInteger(limit) || limit < 0) {
        throw new TypeError("Request body limit must be a non-negative safe integer")
    }

    const declaredLength = request.headers.get("Content-Length")
    if (declaredLength !== null) {
        const parsedLength = Number(declaredLength)
        if (Number.isFinite(parsedLength) && parsedLength > limit) {
            throw new RequestBodyTooLargeError(limit)
        }
    }

    if (request.body === null) {
        return new Uint8Array(new ArrayBuffer(0))
    }

    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0

    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > limit) {
                await reader.cancel()
                throw new RequestBodyTooLargeError(limit)
            }
            chunks.push(value)
        }
    } catch (error) {
        if (error instanceof RequestBodyTooLargeError) throw error
        try {
            await reader.cancel(error)
        } catch {
            // the original read error is the actionable failure
        }
        throw error
    }

    const body = new Uint8Array(new ArrayBuffer(total))
    let offset = 0
    for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.byteLength
    }
    return body
}

/**
 * Reads and UTF-8 decodes a bounded request body
 *
 * @param {BoundedBodyRequest} request - the request whose body is read
 * @param {number} limit - the maximum number of body bytes to accept
 * @returns {Promise<string>} the decoded body
 * @throws {RequestBodyTooLargeError} if the body exceeds `limit`
 */
export async function readBoundedText(request: BoundedBodyRequest, limit: number): Promise<string> {
    return new TextDecoder().decode(await readBoundedBody(request, limit))
}

/**
 * Parses multipart data after bounding the complete request, including framing and non-file fields
 *
 * Bounding the whole request rather than only the selected file keeps a body of many small parts from
 * growing without limit
 *
 * @param {BoundedBodyRequest} request - the multipart request to parse
 * @param {number} limit - the maximum number of body bytes to accept
 * @returns {Promise<FormData>} the parsed multipart form
 * @throws {RequestBodyTooLargeError} if the body exceeds `limit`
 */
export async function readBoundedFormData(request: BoundedBodyRequest, limit: number): Promise<FormData> {
    const body = await readBoundedBody(request, limit)
    return await new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: body.buffer
    }).formData()
}
