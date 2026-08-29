/**
 * lib/api/r2.ts
 *
 * Provides primitives to access Cloudflare R2 object storage, mainly for images
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

import { env } from "cloudflare:workers"
import { adjustR2Usage, claimR2Capacity, MAX_R2_STORAGE_BYTES, R2CapacityError } from "./r2-quota"

// the storage ceiling and its error live with the quota Durable Object that now owns them; re-exported
// here so existing callers keep importing storage concerns from this module
export { MAX_R2_STORAGE_BYTES, R2CapacityError } from "./r2-quota"

/**
 * R2 free plan limits are maintained using rate limiters and caching to prevent overages; logic should
 * be written to prevent overages (do not scan the entire bucket, unless it is build time)
 */

/**
 * The maximum size, in bytes, of a single uploaded file, sourced from the `MAX_UPLOAD_BYTES` wrangler var.
 *
 * Enforced by the upload endpoints before the body is read into memory, so a client cannot exhaust
 * worker memory or storage with one oversized upload
 *
 * @returns {number} the configured per-file upload cap in bytes
 */
export function maxUploadBytes(): number {
    return Number(env.MAX_UPLOAD_BYTES)
}

/**
 * Lists objects in the bucket, optionally scoped to a key prefix
 *
 * @param {string} [prefix] - if provided, only objects whose key starts with this prefix are returned
 * @param {string} [cursor] - an opaque pagination cursor returned by a previous call
 * @param {("httpMetadata" | "customMetadata")[]} [include] - which metadata to include on each object
 * @returns {Promise<R2Objects>} the listing, including objects, truncation flag, and next cursor
 */
export async function listObjects(
    prefix?: string,
    cursor?: string,
    include: ("httpMetadata" | "customMetadata")[] = ["httpMetadata", "customMetadata"]
): Promise<R2Objects> {
    return await env.R2_FILES.list({ prefix, cursor, include })
}

/**
 * Reads an object and its body from the bucket
 *
 * @param {string} key - the object key
 * @returns {Promise<R2ObjectBody | null>} the object with its readable body, or null if it does not exist
 */
export async function getObject(key: string): Promise<R2ObjectBody | null> {
    return await env.R2_FILES.get(key)
}

/**
 * Reads an object's metadata without its body
 *
 * @param {string} key - the object key
 * @returns {Promise<R2Object | null>} the object metadata, or null if it does not exist
 */
export async function headObject(key: string): Promise<R2Object | null> {
    return await env.R2_FILES.head(key)
}

/**
 * Writes an object to the bucket, enforcing the storage-capacity ceiling
 *
 *
 * @param {string} key - the object key to write
 * @param {ArrayBuffer | Uint8Array} body - the object bytes (size must be known for the capacity check)
 * @param {string} content_type - the MIME type to store as httpMetadata.contentType
 * @param {Record<string, string> | undefined} custom_metadata - opaque metadata to store on the object
 * @param {number} [replaced_bytes] - bytes occupied by the object this atomic write replaces
 * @returns {Promise<R2Object>} the written object's metadata
 * @throws {R2CapacityError} if the write would push total usage past MAX_R2_STORAGE_BYTES
 */
export async function putObject(
    key: string,
    body: ArrayBuffer | Uint8Array,
    content_type: string,
    custom_metadata: Record<string, string> | undefined,
    replaced_bytes = 0
): Promise<R2Object> {
    const incoming = body.byteLength
    const growth = incoming - replaced_bytes
    if (growth > 0) {
        await claimR2Capacity(growth)
    }
    try {
        const stored = await env.R2_FILES.put(key, body, {
            httpMetadata: { contentType: content_type },
            customMetadata: custom_metadata
        })
        if (growth < 0) {
            await adjustR2Usage(growth)
        }
        return stored
    } catch (error) {
        if (growth > 0) {
            await adjustR2Usage(-growth)
        }
        throw error
    }
}

/**
 * Deletes an object from the bucket and releases its bytes back to the shared storage quota
 *
 * @param {string} key - the object key to delete
 * @returns {Promise<void>}
 */
export async function deleteObject(key: string): Promise<void> {
    // head first so the freed bytes are known; the quota is only released once the delete succeeds
    const existing = await env.R2_FILES.head(key)
    await env.R2_FILES.delete(key)
    if (existing !== null) {
        await adjustR2Usage(-existing.size)
    }
}
