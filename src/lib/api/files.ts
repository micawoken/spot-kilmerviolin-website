/**
 * lib/api/files.ts
 *
 * Provides higher-level file services on top of R2, integrating image optimization and caching
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
import { deleteObject, emdashMediaUsageBytes, getObject, listObjects, putObject, MAX_R2_STORAGE_BYTES } from "./r2.ts"
import { isOptimizableImage, optimizeImage, type CropInstruction } from "./images.ts"
import { getCache, putCache, deleteCacheKey } from "./caching.ts"
import { getKey, setKey, deleteKey } from "./kv.ts"

// in general, authorization is managed by the API endpoint, so no identity checks are made in this module

const FILES_CACHE_STORE = "files_cache" // Cache API store holding the file listing
const FILES_BLOB_STORE = "files_blob" // Cache API store holding individual file bodies
const FILES_LIST_KEY = "files_list" // Cache API / KV key for the cached listing

/**
 * Builds the Cache API request key for a file's cached body
 *
 * Uses WORKER_ORIGIN (this worker's own origin, see wrangler.jsonc) as the cache address's host, since
 * Cloudflare recommends a resolvable domain name for cache keys
 */
function _blobKey(key: string): string {
    return `${env.WORKER_ORIGIN}/blob/${encodeURIComponent(key)}`
}

/**
 * Derives a safe object key from a user-supplied file name
 *
 * Strips any path components, collapses whitespace to hyphens, and removes characters outside a
 * conservative filename set so the key is safe to embed in a URL path segment
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

/** Random prefix length for a new object key. 12 hex characters (48 bits) is far beyond guessing for a
 * bucket of this size, and short enough to keep keys readable. */
const KEY_PREFIX_BYTES = 6

/**
 * Derives the object key for a NEW upload: a random prefix followed by the sanitized name.
 *
 * Only for creation; lookups must keep using {@link deriveFileKey} on the key from the URL, which leaves
 * an already-prefixed key untouched (the prefix uses only characters that function preserves).
 *
 * @param {string} name - the raw file name
 * @returns {string} the sanitized key behind a random prefix, or an empty string if nothing usable remains
 */
export function newFileKey(name: string): string {
    const derived = deriveFileKey(name)
    if (derived === "") {
        return ""
    }
    const bytes = new Uint8Array(KEY_PREFIX_BYTES)
    crypto.getRandomValues(bytes)
    const prefix = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
    return `${prefix}-${derived}`.slice(0, 255)
}

/**
 * Normalizes and allowlists an upload's declared content type, or null when it is not accepted
 *
 *
 * @param {string} raw - the client-declared content type, possibly with parameters or casing
 * @returns {string | null} the normalized bare MIME type, or null when it is not an accepted upload type
 */
export function normalizeUploadContentType(raw: string): string | null {
    const type = raw.split(";")[0].trim().toLowerCase()
    return isOptimizableImage(type) ? type : null
}

/**
 * Pattern matching an uploaded-file image reference (/api/v#/files/<key>); the bundled-asset form
 * (/files/<name>) and external URLs deliberately do not match
 */
const UPLOADED_FILE_PATTERN = /^\/api\/v\d+\/files\/(.+)$/

/**
 * Extracts the object key from an uploaded-file image reference
 *
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
 * Resolves the alt text to show for an entity's image field
 *
 *
 * @param {ExecutionContext} ctx - the Cloudflare Worker ExecutionContext
 * @param {string | null | undefined} image - the entity's image field value
 * @param {string} fallback - the alt text to use when no stored alt text is resolvable
 * @returns {Promise<string>} the alt text to render
 */
export async function resolveEntityImageAlt(
    ctx: ExecutionContext,
    image: string | null | undefined,
    fallback: string
): Promise<string> {
    if (!image) {
        return fallback
    }
    const key = extractUploadedFileKey(image)
    if (key === null) {
        return fallback
    }
    const meta = await getFileMeta(ctx, key)
    return meta?.alt || fallback
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
        optimized: custom.optimized === "true",
        // pre-existing objects written before alt text was required have no stored value
        alt: custom.alt ?? ""
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
 * Resolved from the cached listing to avoid a dedicated R2 head() call
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
    optimized: boolean,
    alt: string
): Record<string, string> {
    const metadata: Record<string, string> = {
        content_type,
        optimized: optimized ? "true" : "false",
        alt
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
 * @param {string} alt - the file's required alt text
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
    alt: string,
    usage_budget: number,
    crop?: CropInstruction
): Promise<FileMeta> {
    const optimized = await optimizeImage(bytes, content_type, crop)
    const custom = _buildCustomMetadata(
        optimized.content_type,
        uploader,
        optimized.width,
        optimized.height,
        optimized.optimized,
        alt
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
 * @param {string} alt - the file's required alt text
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
    alt: string,
    crop?: CropInstruction
): Promise<FileMeta> {
    const files = await listFiles(ctx)
    if (files.some((file) => file.key === key)) {
        throw new Error(`A file already exists at key "${key}"`)
    }
    // the capacity ceiling is shared with EMDASH_MEDIA (see r2.ts's MAX_R2_STORAGE_BYTES), so the budget
    // must include that bucket's current usage too, not just this one's
    const used = files.reduce((total, file) => total + file.size, 0) + (await emdashMediaUsageBytes())
    return await _writeFile(ctx, key, bytes, content_type, uploader, alt, used, crop)
}

/**
 * Replaces an existing file's bytes, optimizing it when it is an image
 *
 * @param {ExecutionContext} ctx - the Cloudflare Worker ExecutionContext
 * @param {string} key - the file key to replace; must already exist
 * @param {ArrayBuffer | Uint8Array} bytes - the new file bytes
 * @param {string} content_type - the new MIME type
 * @param {string | null} uploader - the contributor id performing the replacement, or null
 * @param {string} alt - the file's required alt text
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
    alt: string,
    crop?: CropInstruction
): Promise<FileMeta> {
    const files = await listFiles(ctx)
    const existing = files.find((file) => file.key === key)
    if (existing === undefined) {
        throw new Error(`No file exists at key "${key}"`)
    }
    // count this write against current usage minus the object being overwritten; the budget also includes
    // EMDASH_MEDIA's usage since the capacity ceiling is shared across both buckets (see r2.ts)
    const used = files.reduce((total, file) => total + file.size, 0) - existing.size + (await emdashMediaUsageBytes())
    return await _writeFile(ctx, key, bytes, content_type, uploader, alt, used, crop)
}

/**
 * Updates a stored file's alt text without rewriting its bytes
 *
 *
 * @param {ExecutionContext} ctx - the Cloudflare Worker ExecutionContext
 * @param {string} key - the file key to update; must already exist
 * @param {string} alt - the new alt text
 * @returns {Promise<FileMeta>} the stored file's metadata
 * @throws {Error} if no file exists at the key (caller should map to 404)
 */
export async function updateFileAlt(ctx: ExecutionContext, key: string, alt: string): Promise<FileMeta> {
    const files = await listFiles(ctx)
    const existing = files.find((file) => file.key === key)
    if (existing === undefined) {
        throw new Error(`No file exists at key "${key}"`)
    }
    const data = await readFileBytes(key)
    if (data === null) {
        throw new Error(`No file exists at key "${key}"`)
    }
    const custom = _buildCustomMetadata(
        data.content_type,
        existing.uploader,
        existing.width,
        existing.height,
        existing.optimized,
        alt
    )
    // re-writing the same bytes does not change total usage, so the budget excludes this object's own
    // size; EMDASH_MEDIA's usage is still included since the capacity ceiling is shared (see r2.ts)
    const used = files.reduce((total, file) => total + file.size, 0) - existing.size + (await emdashMediaUsageBytes())
    const stored = await putObject(key, data.bytes, data.content_type, custom, used)
    _invalidate(ctx, key)
    return _toMeta(stored)
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
 * Reports current and maximum storage usage against the shared ceiling
 *
 * `used` is combined across both buckets this app owns (R2_FILES + EMDASH_MEDIA) since they draw against
 * the same account-wide capacity ceiling - see r2.ts's MAX_R2_STORAGE_BYTES.
 *
 * @param {ExecutionContext} ctx - the Cloudflare Worker ExecutionContext
 * @returns {Promise<{ used: number, max: number }>} combined bytes used and the configured ceiling
 */
export async function getStorageUsage(ctx: ExecutionContext): Promise<{ used: number; max: number }> {
    const files = await listFiles(ctx)
    const used = files.reduce((total, file) => total + file.size, 0) + (await emdashMediaUsageBytes())
    return { used, max: MAX_R2_STORAGE_BYTES }
}

/**
 * Computes current bucket usage from a fresh R2 scan, refreshing the cached listing as it goes
 *
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
