/**
 * lib/api/r2.ts
 *
 * Provides primitives to access Cloudflare R2 object storage, mainly for images
 *
 * These primitives are deliberately thin: they expose put/get/head/list/delete over the R2_FILES
 * bucket and enforce a storage-capacity ceiling so the bucket stays within the R2 free plan. No
 * caching happens here; lib/api/files.ts layers caching (Cache API + KV) on top of these, mirroring
 * how database.ts layers caching over d1.ts, and is the entry point other libraries should use.
 *
 * OPERATION DISCIPLINE
 * R2 free-plan operation ceilings (Class A: writes/lists, 1M/mo; Class B: reads, 10M/mo) are kept in
 * check by (1) per-request rate limits on the files API (RL_API_FILES_READ / RL_API_FILES_WRITE) and
 * (2) the caching in files.ts. Internal logic must therefore avoid fanning out into many R2 calls
 * (e.g. no per-object head() in a loop). The one place a full bucket scan is acceptable is the build
 * process, which runs out-of-band and is not subject to the request rate limits.
 */

import { env } from "cloudflare:workers"

/**
 * The maximum total number of bytes the bucket is allowed to hold
 *
 * Kept below the R2 free-plan 10 GB ceiling to leave headroom; putObject rejects writes that would
 * push total usage past this value.
 */
export const MAX_R2_STORAGE_BYTES = 9 * 1024 * 1024 * 1024 // 9 GiB

/**
 * Thrown by putObject when a write would exceed MAX_R2_STORAGE_BYTES; endpoints map this to 507
 */
export class R2CapacityError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "R2CapacityError"
    }
}

/**
 * Sums the size of every object in the bucket, following list pagination to completion
 *
 * This is a Class A (list) operation and may issue several calls on a large bucket, so callers in the
 * request path should cache the result (see files.ts) rather than calling it on every request.
 *
 * @returns {Promise<number>} the total number of bytes stored in the bucket
 */
export async function computeUsage(): Promise<number> {
    let total = 0
    let cursor: string | undefined = undefined
    do {
        const listing: R2Objects = await env.R2_FILES.list({ cursor, include: [] })
        for (const object of listing.objects) {
            total += object.size
        }
        cursor = listing.truncated ? listing.cursor : undefined
    } while (cursor !== undefined)
    return total
}

/**
 * Lists objects in the bucket, optionally scoped to a key prefix
 *
 * By default the listing includes each object's httpMetadata and customMetadata so callers can build
 * full file records without a per-object head() call.
 *
 * @param {string} [prefix] - if provided, only objects whose key starts with this prefix are returned
 * @param {string} [cursor] - an opaque pagination cursor returned by a previous call
 * @param {("httpMetadata" | "customMetadata")[]} [include] - which metadata to include on each object
 * @returns {Promise<R2Objects>} the listing, including objects, truncation flag, and next cursor
 */
export async function listObjects(prefix?: string, cursor?: string, include: ("httpMetadata" | "customMetadata")[] = ["httpMetadata", "customMetadata"]): Promise<R2Objects> {
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
 * The capacity check uses usage_budget — the number of bytes already stored that this write should be
 * counted against — so a caller replacing an existing object can subtract that object's current size to
 * avoid double-counting. When usage_budget is omitted it is computed with computeUsage() (a Class A
 * scan); request-path callers should pass a cached figure (see files.ts) instead.
 *
 * @param {string} key - the object key to write
 * @param {ArrayBuffer | Uint8Array} body - the object bytes (size must be known for the capacity check)
 * @param {string} content_type - the MIME type to store as httpMetadata.contentType
 * @param {Record<string, string>} [custom_metadata] - opaque metadata to store on the object
 * @param {number} [usage_budget] - bytes already used to count this write against; computed if omitted
 * @returns {Promise<R2Object>} the written object's metadata
 * @throws {R2CapacityError} if the write would push total usage past MAX_R2_STORAGE_BYTES
 */
export async function putObject(key: string, body: ArrayBuffer | Uint8Array, content_type: string, custom_metadata?: Record<string, string>, usage_budget?: number): Promise<R2Object> {
    const incoming = body.byteLength
    const used = usage_budget !== undefined ? usage_budget : await computeUsage()
    if (used + incoming > MAX_R2_STORAGE_BYTES) {
        throw new R2CapacityError(`Storage capacity exceeded: ${used + incoming} bytes would exceed the ${MAX_R2_STORAGE_BYTES} byte ceiling`)
    }
    return await env.R2_FILES.put(key, body, {
        httpMetadata: { contentType: content_type },
        customMetadata: custom_metadata
    })
}

/**
 * Deletes an object from the bucket
 *
 * @param {string} key - the object key to delete
 * @returns {Promise<void>}
 */
export async function deleteObject(key: string): Promise<void> {
    return await env.R2_FILES.delete(key)
}
