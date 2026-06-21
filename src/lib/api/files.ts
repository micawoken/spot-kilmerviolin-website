/**
 * lib/api/files.ts
 *
 * Provides higher-level file services on top of R2, integrating image optimization and caching
 *
 * This is the entry point other libraries and endpoints should use to reach the R2 file store; it
 * wraps the r2.ts primitives the way database.ts wraps d1.ts. Two caches sit in front of R2 to keep
 * Class A (list) and Class B (read) operations within the free plan:
 *  - the file listing (FileMeta[]) is cached in the Cache API and KV, and also backs the storage-usage
 *    figure so uploads do not trigger a fresh bucket scan; and
 *  - file bytes are cached in the Cache API per key, so repeat reads do not hit R2.
 * Writes (add/replace/delete) invalidate the affected caches.
 *
 *
 *
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

import { env } from "cloudflare:workers"
import { deleteObject, getObject, listObjects, putObject, MAX_R2_STORAGE_BYTES } from "./r2.ts"
import { optimizeImage, type CropInstruction } from "./images.ts"
import { getCache, putCache, deleteCacheKey } from "./caching.ts"
import { getKey, setKey, deleteKey } from "./kv.ts"

// in general, authorization is managed by the API endpoint, so no identity checks are made in this module

const FILES_CACHE_STORE = "files_cache" // Cache API store holding the file listing
const FILES_BLOB_STORE = "files_blob" // Cache API store holding individual file bodies
const FILES_LIST_KEY = "files_list" // Cache API / KV key for the cached listing
const blob_host = "https://spot-kilmer-violin-website.mwmsc.workers.dev" // origin for the cached file bodies; unified w/ production url since cloudflare says dns should be resolvable

/**
 * Builds the Cache API request key for a file's cached body
 */
function _blobKey(key: string): string {
    return `${blob_host}/blob/${encodeURIComponent(key)}`
}

/**
 * Derives a safe object key from a user-supplied file name
 *
 * Strips any path components, collapses whitespace to hyphens, and removes characters outside a
 * conservative filename set so the key is safe to embed in a URL path segment.
 *
 * @param {string} name - the raw file name (e.g. from the upload's filename or a provided name field)
 * @returns {string} the sanitized key, or an empty string if nothing usable remains
 */
export function deriveFileKey(name: string): string {
    const base = name.split(/[\\/]/).pop() ?? name
    return base
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^A-Za-z0-9._-]/g, "")
        .replace(/^\.+/, "")
        .slice(0, 255)
}

/**
 * Pattern matching an uploaded-file image reference (/api/v#/files/<key>); the bundled-asset form
 * (/files/<name>) and external URLs deliberately do not match
 */
const UPLOADED_FILE_PATTERN = /^\/api\/v\d+\/files\/(.+)$/

/**
 * Extracts the object key from an uploaded-file image reference
 *
 * Returns the key only when the value is an uploaded-file path (/api/v#/files/<key>); bundled assets
 * (/files/<name>) and external http(s) URLs return null, since those have no R2 object to attribute to
 * an uploader. The key is URL-decoded to match how it is stored (see _blobKey).
 *
 * @param {string} image - a contributor image reference
 * @returns {string | null} the uploaded file's key, or null when the value is not an uploaded-file path
 */
export function extractUploadedFileKey(image: string): string | null {
    const match = UPLOADED_FILE_PATTERN.exec(image.trim())
    if (match === null) {
        return null
    }
    try {
        return decodeURIComponent(match[1])
    } catch {
        // a malformed percent-encoding cannot correspond to any stored key
        return null
    }
}

/**
 * Converts an R2 object (from a listing or head) into the API file metadata representation
 */
function _toMeta(object: R2Object): FileMeta {
    const custom = object.customMetadata ?? {}
    return {
        key: object.key,
        size: object.size,
        content_type: object.httpMetadata?.contentType ?? custom.content_type ?? "application/octet-stream",
        uploaded: object.uploaded.toISOString(),
        etag: object.etag,
        uploader: custom.uploader ?? null,
        width: custom.width ? Number(custom.width) : null,
        height: custom.height ? Number(custom.height) : null,
        optimized: custom.optimized === "true"
    }
}

/**
 * Reads the entire bucket listing from R2, following pagination, as file metadata records
 */
async function _listFromR2(): Promise<FileMeta[]> {
    const records: FileMeta[] = []
    let cursor: string | undefined = undefined
    do {
        const listing: R2Objects = await listObjects(undefined, cursor)
        for (const object of listing.objects) {
            records.push(_toMeta(object))
        }
        cursor = listing.truncated ? listing.cursor : undefined
    } while (cursor !== undefined)
    return records
}

/**
 * Lists every file's metadata, served from cache where possible
 *
 * Resolution order mirrors database.ts: the Cache API (fast, short-lived), then KV (medium-lived), then
 * a single R2 scan as the source of truth, repopulating the faster layers on the way back.
 *
 * @param {ExecutionContext} ctx - the Cloudflare Worker ExecutionContext, used to schedule cache writes
 * @returns {Promise<FileMeta[]>} the metadata for every stored file
 */
export async function listFiles(ctx: ExecutionContext): Promise<FileMeta[]> {
    const cached = await getCache(FILES_CACHE_STORE, FILES_LIST_KEY)
    if (cached !== null) {
        return cached as FileMeta[]
    }
    const from_kv = await getKey(FILES_LIST_KEY)
    if (from_kv !== null && from_kv !== undefined) {
        ctx.waitUntil(putCache(FILES_CACHE_STORE, FILES_LIST_KEY, from_kv as FileMeta[], "", true))
        return from_kv as FileMeta[]
    }
    const records = await _listFromR2()
    ctx.waitUntil(putCache(FILES_CACHE_STORE, FILES_LIST_KEY, records, "", true))
    ctx.waitUntil(setKey(FILES_LIST_KEY, records, "json"))
    return records
}

/**
 * Invalidates the cached file listing and, optionally, a single file's cached body
 *
 * @param {ExecutionContext} ctx - the ExecutionContext used to schedule the cache deletions
 * @param {string} [key] - if provided, the file key whose cached body should also be evicted
 */
function _invalidate(ctx: ExecutionContext, key?: string): void {
    ctx.waitUntil(deleteCacheKey(FILES_CACHE_STORE, FILES_LIST_KEY))
    ctx.waitUntil(deleteKey(FILES_LIST_KEY))
    if (key !== undefined) {
        ctx.waitUntil(caches.open(FILES_BLOB_STORE).then((store) => store.delete(_blobKey(key))))
    }
}

/**
 * Retrieves a single file's metadata
 *
 * Resolved from the cached listing to avoid a dedicated R2 head() call.
 *
 * @param {ExecutionContext} ctx - the Cloudflare Worker ExecutionContext
 * @param {string} key - the file key
 * @returns {Promise<FileMeta | null>} the file's metadata, or null if no such file exists
 */
export async function getFileMeta(ctx: ExecutionContext, key: string): Promise<FileMeta | null> {
    const files = await listFiles(ctx)
    return files.find((file) => file.key === key) ?? null
}

/**
 * Reads a file's bytes and content type, served from the per-file body cache where possible
 *
 * On a cache miss the object is fetched from R2 and its body cached for subsequent reads. This does not
 * require an ExecutionContext because it caches inline before returning.
 *
 * @param {string} key - the file key
 * @returns {Promise<{ bytes: ArrayBuffer, content_type: string } | null>} the body and type, or null if not found
 */
export async function readFileBytes(key: string): Promise<{ bytes: ArrayBuffer; content_type: string } | null> {
    const blob_store = await caches.open(FILES_BLOB_STORE)
    const cached = await blob_store.match(_blobKey(key))
    if (cached) {
        return {
            bytes: await cached.arrayBuffer(),
            content_type: cached.headers.get("Content-Type") ?? "application/octet-stream"
        }
    }
    const object = await getObject(key)
    if (object === null) {
        return null
    }
    const bytes = await object.arrayBuffer()
    const content_type = object.httpMetadata?.contentType ?? "application/octet-stream"
    // cache the body for subsequent reads (private to the worker cache, long-lived)
    const ttl = env.CACHE_API_TTL_LONG
    await blob_store.put(
        _blobKey(key),
        new Response(bytes, {
            headers: {
                "Content-Type": content_type,
                "Cache-Control": `public, max-age=${ttl}, stale-while-revalidate=${ttl * 2}`
            }
        })
    )
    return { bytes, content_type }
}

/**
 * Builds the customMetadata stored alongside a file's bytes in R2
 */
function _buildCustomMetadata(
    content_type: string,
    uploader: string | null,
    width: number | null,
    height: number | null,
    optimized: boolean
): Record<string, string> {
    const metadata: Record<string, string> = {
        content_type,
        optimized: optimized ? "true" : "false"
    }
    if (uploader !== null) {
        metadata.uploader = uploader
    }
    if (width !== null) {
        metadata.width = String(width)
    }
    if (height !== null) {
        metadata.height = String(height)
    }
    return metadata
}

/**
 * Writes a file's bytes to R2 (optimizing images), returning its stored metadata
 *
 * @param {ExecutionContext} ctx - the ExecutionContext used to schedule cache invalidation
 * @param {string} key - the destination file key
 * @param {ArrayBuffer | Uint8Array} bytes - the original file bytes
 * @param {string} content_type - the original MIME type
 * @param {string | null} uploader - the contributor id performing the upload, or null
 * @param {number} usage_budget - bytes already used to count this write against (excludes the key when replacing)
 * @param {CropInstruction} [crop] - how to crop an image into a canonical shape; absent = centered portrait
 * @returns {Promise<FileMeta>} the stored file's metadata
 * @throws {R2CapacityError} if the write would exceed the storage ceiling
 */
async function _writeFile(
    ctx: ExecutionContext,
    key: string,
    bytes: ArrayBuffer | Uint8Array,
    content_type: string,
    uploader: string | null,
    usage_budget: number,
    crop?: CropInstruction
): Promise<FileMeta> {
    const optimized = await optimizeImage(bytes, content_type, crop)
    const custom = _buildCustomMetadata(
        optimized.content_type,
        uploader,
        optimized.width,
        optimized.height,
        optimized.optimized
    )
    const stored = await putObject(key, optimized.bytes, optimized.content_type, custom, usage_budget)
    _invalidate(ctx, key)
    return _toMeta(stored)
}

/**
 * Adds a new file, optimizing it when it is an image
 *
 * @param {ExecutionContext} ctx - the Cloudflare Worker ExecutionContext
 * @param {string} key - the destination file key; must not already exist
 * @param {ArrayBuffer | Uint8Array} bytes - the original file bytes
 * @param {string} content_type - the original MIME type
 * @param {string | null} uploader - the contributor id performing the upload, or null
 * @param {CropInstruction} [crop] - how to crop an image into a canonical shape; absent = centered portrait
 * @returns {Promise<FileMeta>} the stored file's metadata
 * @throws {Error} if a file already exists at the key (caller should map to 409)
 * @throws {R2CapacityError} if the write would exceed the storage ceiling
 */
export async function addFile(
    ctx: ExecutionContext,
    key: string,
    bytes: ArrayBuffer | Uint8Array,
    content_type: string,
    uploader: string | null,
    crop?: CropInstruction
): Promise<FileMeta> {
    const files = await listFiles(ctx)
    if (files.some((file) => file.key === key)) {
        throw new Error(`A file already exists at key "${key}"`)
    }
    const used = files.reduce((total, file) => total + file.size, 0)
    return await _writeFile(ctx, key, bytes, content_type, uploader, used, crop)
}

/**
 * Replaces an existing file's bytes, optimizing it when it is an image
 *
 * @param {ExecutionContext} ctx - the Cloudflare Worker ExecutionContext
 * @param {string} key - the file key to replace; must already exist
 * @param {ArrayBuffer | Uint8Array} bytes - the new file bytes
 * @param {string} content_type - the new MIME type
 * @param {string | null} uploader - the contributor id performing the replacement, or null
 * @param {CropInstruction} [crop] - how to crop an image into a canonical shape; absent = centered portrait
 * @returns {Promise<FileMeta>} the stored file's metadata
 * @throws {Error} if no file exists at the key (caller should map to 404)
 * @throws {R2CapacityError} if the write would exceed the storage ceiling
 */
export async function replaceFile(
    ctx: ExecutionContext,
    key: string,
    bytes: ArrayBuffer | Uint8Array,
    content_type: string,
    uploader: string | null,
    crop?: CropInstruction
): Promise<FileMeta> {
    const files = await listFiles(ctx)
    const existing = files.find((file) => file.key === key)
    if (existing === undefined) {
        throw new Error(`No file exists at key "${key}"`)
    }
    // count this write against current usage minus the object being overwritten
    const used = files.reduce((total, file) => total + file.size, 0) - existing.size
    return await _writeFile(ctx, key, bytes, content_type, uploader, used, crop)
}

/**
 * Deletes a file
 *
 * @param {ExecutionContext} ctx - the Cloudflare Worker ExecutionContext
 * @param {string} key - the file key to delete
 * @returns {Promise<void>}
 */
export async function deleteFile(ctx: ExecutionContext, key: string): Promise<void> {
    await deleteObject(key)
    _invalidate(ctx, key)
}

/**
 * Reports current and maximum storage usage for the bucket
 *
 * @param {ExecutionContext} ctx - the Cloudflare Worker ExecutionContext
 * @returns {Promise<{ used: number, max: number }>} bytes used and the configured ceiling
 */
export async function getStorageUsage(ctx: ExecutionContext): Promise<{ used: number; max: number }> {
    const files = await listFiles(ctx)
    return { used: files.reduce((total, file) => total + file.size, 0), max: MAX_R2_STORAGE_BYTES }
}

/**
 * Computes current bucket usage from a fresh R2 scan, refreshing the cached listing as it goes
 *
 * This is not a storage primitive: it builds on the r2.ts list operation rather than touching the bucket
 * directly. Unlike getStorageUsage (which sums the possibly-cached listing), computeUsage always performs
 * the Class A list scan so the figure can never be stale, and it repopulates the file-listing caches
 * (Cache API + KV) with the freshly scanned records — so the scan's result is itself cached and
 * subsequent listFiles/getFileMeta calls are served from cache rather than triggering another scan.
 *
 * Because it is authoritative and comparatively expensive, reserve it for paths that must not act on a
 * stale figure (e.g. an out-of-band reconciliation at build time); request-path callers that only need
 * to display usage should prefer getStorageUsage.
 *
 * @param {ExecutionContext} ctx - the Cloudflare Worker ExecutionContext, used to schedule cache writes
 * @returns {Promise<number>} the total number of bytes stored in the bucket
 */
export async function computeUsage(ctx: ExecutionContext): Promise<number> {
    // always scan R2 directly (never cache-first) so the usage figure reflects the bucket's true state
    const records = await _listFromR2()
    // refresh the faster cache layers with what we just scanned, so the result is cached for later reads
    ctx.waitUntil(putCache(FILES_CACHE_STORE, FILES_LIST_KEY, records, "", true))
    ctx.waitUntil(setKey(FILES_LIST_KEY, records, "json"))
    return records.reduce((total, file) => total + file.size, 0)
}
