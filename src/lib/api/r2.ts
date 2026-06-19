/**
 * lib/api/r2.ts
 *
 * Provides primitives to access Cloudflare R2 object storage, mainly for images
 *
 *
 */

import { env } from "cloudflare:workers"

/**
 * R2 free plan limits are maintained using rate limiters and caching to prevent overages; logic should
 * be written to prevent overages (do not scan the entire bucket, unless it is build time)
 */


/**
 * The maximum total number of bytes the bucket is allowed to hold
 *
 * Kept below the R2 free-plan 10 GB ceiling to leave headroom; putObject rejects writes that would
 * push total usage past this value.
 */
export const MAX_R2_STORAGE_BYTES = 9 * 1024 * 1024 * 1024 // 9 GiB

/**
 * The maximum size, in bytes, of a single uploaded file
 *
 * Enforced by the upload endpoints before the body is read into memory, so a client cannot exhaust
 * worker memory or storage with one oversized upload. Images are optimized down after upload, but the
 * cap applies to the original bytes the client sends.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25 MiB

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
 * avoid double-counting. Computing current usage is not a storage primitive (it builds on a list scan),
 * so it is the caller's responsibility: files.ts derives the budget from its cached listing and passes
 * it here (see computeUsage in files.ts).
 *
 * @param {string} key - the object key to write
 * @param {ArrayBuffer | Uint8Array} body - the object bytes (size must be known for the capacity check)
 * @param {string} content_type - the MIME type to store as httpMetadata.contentType
 * @param {Record<string, string> | undefined} custom_metadata - opaque metadata to store on the object
 * @param {number} usage_budget - bytes already used to count this write against
 * @returns {Promise<R2Object>} the written object's metadata
 * @throws {R2CapacityError} if the write would push total usage past MAX_R2_STORAGE_BYTES
 */
export async function putObject(key: string, body: ArrayBuffer | Uint8Array, content_type: string, custom_metadata: Record<string, string> | undefined, usage_budget: number): Promise<R2Object> {
    const incoming = body.byteLength
    const used = usage_budget
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
