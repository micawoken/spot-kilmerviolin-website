/**
 * middleware/emdash_media_capacity.ts
 *
 * Bounds EmDash media upload bodies and reserves shared R2 capacity before the request reaches EmDash,
 * and disables its signed-upload flow, which would otherwise skip those guards
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

import type { MiddlewareHandler } from "astro"
import { MAX_MULTIPART_OVERHEAD_BYTES, readBoundedFormData, RequestBodyTooLargeError } from "../lib/api/body"
import { maxUploadBytes, R2CapacityError } from "../lib/api/r2"
import { adjustR2Usage, claimR2Capacity } from "../lib/api/r2-quota"

const MEDIA_UPLOAD_PATH = "/_emdash/api/media"
const SIGNED_UPLOAD_PATH = "/_emdash/api/media/upload-url"
const PENDING_UPLOAD_PATH = /^\/_emdash\/api\/media\/[^/]+\/upload$/
const PENDING_CONFIRM_PATH = /^\/_emdash\/api\/media\/[^/]+\/confirm$/
const REPLACE_PATH = /^\/_emdash\/api\/media\/[^/]+\/replace$/
const BLOCKED_EXTENSIONS = [".avif", ".heic", ".heif", ".icns", ".jxl"]
const BLOCKED_MEDIA_TYPES = new Set([
    "image/avif",
    "image/heic",
    "image/heif",
    "image/icns",
    "image/jxl",
    "image/x-icns"
])

function errorResponse(code: string, message: string, status: number): Response {
    return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "private, no-store" } })
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
    return String.fromCharCode(...bytes.slice(start, end))
}

/**
 * Detects every format that can reach the unpatched image-size infinite-loop parsers
 *
 * `image-size@2.0.2` has no published fix for GHSA-w3rx-r6r6-pgpr (ICNS) or GHSA-5p2g-fcmc-qvqq (JXL and
 * HEIF), and EmDash calls it on every upload, so the formats are refused before the parser sees them.
 * The declared type and the extension are both untrusted, hence the magic-number check.
 *
 * @param {File} file - the uploaded multipart file
 * @returns {Promise<boolean>} true when the upload must be refused
 * @exported for tests; the middleware below is the only production caller
 */
export async function isBlockedImage(file: File): Promise<boolean> {
    const type = file.type.split(";", 1)[0].trim().toLowerCase()
    const name = file.name.toLowerCase()
    if (BLOCKED_MEDIA_TYPES.has(type) || BLOCKED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
        return true
    }

    const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer())
    if (ascii(bytes, 0, 4) === "icns" || (bytes[0] === 0xff && bytes[1] === 0x0a)) return true
    if (ascii(bytes, 4, 8) === "JXL ") return true
    if (ascii(bytes, 4, 8) !== "ftyp") return false
    return ["avif", "heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(ascii(bytes, 8, 12))
}

/**
 * Whether a request belongs to EmDash's signed-upload flow: upload-url, then a PUT of the bytes, then confirm
 *
 * With an R2 binding EmDash answers upload-url with a Worker-proxied PUT URL instead of 501, so the admin
 * client never reaches the guarded multipart route.
 */
function isSignedUploadRoute(method: string, pathname: string): boolean {
    if (method === "POST" && pathname === SIGNED_UPLOAD_PATH) return true
    if (method === "PUT" && PENDING_UPLOAD_PATH.test(pathname)) return true
    return method === "POST" && PENDING_CONFIRM_PATH.test(pathname)
}

/**
 * Applies the size, format and capacity guards to a multipart upload before EmDash stores it
 *
 * @param {Parameters<MiddlewareHandler>[0]} context - the request context
 * @param {() => Promise<Response>} next - EmDash's handler
 * @param {number} storedStatus - the status EmDash answers when it wrote new bytes; any other outcome releases the claim
 */
async function guardUpload(
    context: Parameters<MiddlewareHandler>[0],
    next: () => Promise<Response>,
    storedStatus: number
): Promise<Response> {
    const uploadLimit = maxUploadBytes()
    let file: File
    try {
        const form = await readBoundedFormData(context.request.clone(), uploadLimit + MAX_MULTIPART_OVERHEAD_BYTES)
        const entry = form.get("file")
        if (!(entry instanceof File)) return next()
        file = entry
    } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
            return errorResponse("PAYLOAD_TOO_LARGE", "Upload too large", 413)
        }
        return errorResponse("INVALID_REQUEST", "Invalid multipart upload", 400)
    }

    if (file.size > uploadLimit) {
        return errorResponse("PAYLOAD_TOO_LARGE", "Upload too large", 413)
    }
    if (await isBlockedImage(file)) {
        return errorResponse("INVALID_TYPE", "This image format is temporarily unavailable", 415)
    }

    try {
        await claimR2Capacity(file.size)
    } catch (error) {
        if (error instanceof R2CapacityError) {
            return errorResponse("STORAGE_CAPACITY_EXCEEDED", "Storage capacity exceeded", 507)
        }
        throw error
    }

    try {
        const response = await next()
        // EmDash answers a stored upload with 201; every other outcome - including the 200 it returns when
        // a content hash already exists - writes no new bytes, so the reservation is given back
        if (response.status !== storedStatus) {
            await adjustR2Usage(-file.size)
        }
        return response
    } catch (error) {
        await adjustR2Usage(-file.size)
        throw error
    }
}

export const emdashMediaCapacity: MiddlewareHandler = async (context, next) => {
    const { method } = context.request
    const { pathname } = new URL(context.request.url)

    if (method === "POST" && pathname === MEDIA_UPLOAD_PATH) {
        return guardUpload(context, next, 201)
    }
    // a replacement overwrites the stored object, so the claim also counts the replaced bytes until the
    // quota object's hourly reconcile corrects the total
    if (method === "PUT" && REPLACE_PATH.test(pathname)) {
        return guardUpload(context, next, 200)
    }
    if (isSignedUploadRoute(method, pathname)) {
        return errorResponse("NOT_SUPPORTED", "Signed uploads are disabled; upload through the media library", 501)
    }
    return next()
}
