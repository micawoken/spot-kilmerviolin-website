/**
 * lib/api/kv.ts
 * 
 * Provides primitives to access Cloudflare KV storage, including reading, writing, and listing keys
 * 
 * 
 */

import { env } from "cloudflare:workers";

const database = env.KV_DB_CACHE

/**
 * KV guarantees eventual consistency, so it's suitable for caching D1 query results
 * Entries are keyed by the SQL statement
 */

/**
 * Builds a metadata object for a KV entry
 * Properties:
 *  - v: version number
 *  - f: data type - text or json
 *  - t: creation timestamp, in milliseconds since epoch
 *  - e: expiration time in seconds, set in env.KV_CACHE_TTL
 *  - h: whether the key has a value, i.e. is not null or ""
 *  - value: the value to cache; truncated if greater than 750 characters to stay under 1024 character limit
 * 
 * @param value The string value to cache
 * @param type The data type, as text or json
 * @param ttl The TTL of the cache entry, in seconds
 * @return A KVMetadata object to use for the cache entry
 */
function constructMetadata(value: string, type: "text" | "json", ttl: number): KVMetadata {
    return {
        v: 2,
        f: type,
        t: Date.now(),
        e: ttl,
        h: value.length !== 0,
        value: value.length < 750 ? value : (type === "json" ? null : "")
    }
}

/**
 * Retrieves a value from KV by key
 * 
 * @param key The key to retrieve
 * @param properties Optional KV get properties
 * @return The value stored at the key, parsed as JSON if the metadata indicates it is JSON; null if the key does not exist
 * @throws Error if the metadata version is unrecognized
 */
export async function getKey(key: string, properties?: Partial<KVNamespaceGetOptions<undefined>>): Promise<any> {
    const value = await database.getWithMetadata(key, properties)
    if (!value) {
        return null
    }
    if (value.value === null) {
        // key does not exist
        return null
    }
    if (value.metadata === null || value.metadata === undefined) {
        // no metadata - assume text
        return value.value
    }
    if ((value.metadata as KVMetadata).v === 1) {
        const output = (value.metadata as KVMetadata)?.f === "json" ? JSON.parse(value.value as string) : value.value
        return output
    } else if ((value.metadata as KVMetadata).v === 2) {
        if ((value.metadata as KVMetadata).h) {
            // has data
            const output = (value.metadata as KVMetadata)?.f === "json" ? JSON.parse(value.value as string) : value.value
            return output
        } else {
            // no data
            return undefined
        }
    } else {
        throw new Error(`Unrecognized KV metadata version ${(value.metadata as KVMetadata).v} for key ${key}`)
    }
}

/**
 * Sets a value in KV with the specified key and value, and metadata indicating the data type and TTL
 * 
 * @param key The key to set
 * @param value The value to set, as a string or object (which will be stringified)
 * @param mode The data type of the value, as text or json
 * @return void
 */
export async function setKey(key: string, value: string | object, mode: 'text' | 'json'): Promise<void> {
    const entry = mode === "text" ? value as string : JSON.stringify(value)
    const metadata = constructMetadata(entry, mode, env.KV_CACHE_TTL)
    await database.put(key, entry, {
        metadata: metadata,
        expirationTtl: env.KV_CACHE_TTL
    })
}

/**
 * Delete a key from KV
 *
 * @param key The key to delete
 */
export async function deleteKey(key: string): Promise<void> {
    await database.delete(key)
}

/**
 * Perform a list operation with automatic pagination, and return a list of keys
 * 
 * @returns A promise that resolves to a list of keys with their metadata and expiration times
 */
async function _listKeys(): Promise<{name: string, expiration: number | null, metadata: KVMetadata}[]> {
    let cursor: string | undefined = undefined
    let keys: {name: string, expiration: number | null, metadata: KVMetadata}[] = []
    do {
        if (!cursor) {
            const result = await database.list({ limit: 1000 })
            keys = keys.concat(result.keys as {name: string, expiration: number | null, metadata: KVMetadata}[])
            cursor = "cursor" in result ? result.cursor : undefined
            if (result.list_complete) {
                break
            }
        } else {
            const result = await database.list({ limit: 1000, cursor: cursor })
            keys = keys.concat(result.keys as {name: string, expiration: number | null, metadata: KVMetadata}[])
            cursor = "cursor" in result ? result.cursor : undefined
            if (result.list_complete) {
                break
            }
        }
    } while (cursor !== undefined)
    return keys
}


/**
 * List keys in KV, with optional data
 * 
 * @param {boolean} records - Whether to return response data, if available
 * @returns {Promise<string[] | Record<string, any>>} A promise that resolves to either a list of keys, or an object mapping keys to their values if records is true
 * @throws {Error} If an unrecognized metadata version is encountered
 */
export async function listKeys(records: boolean = false): Promise<string[] | Record<string, any>> {
    const key_data = await _listKeys()
    if (!records) {
        return key_data.map(k => k.name)
    } else {
        return key_data.reduce((acc, k) => {
            if (k.metadata === null || k.metadata === undefined) {
                // keys written without metadata (e.g., externally) have no recoverable value from a list operation
                acc[k.name] = undefined
                return acc
            }
            if (k.metadata.v === 1) {
                acc[k.name] = (k.metadata as KVMetadata)?.f === "json" ? JSON.parse(k.metadata.value as string) : k.metadata.value
                return acc
            } else if (k.metadata.v === 2) {
                if (k.metadata.h) {
                    acc[k.name] = (k.metadata as KVMetadata)?.f === "json" ? JSON.parse(k.metadata.value as string) : k.metadata.value
                } else {
                    acc[k.name] = undefined
                }
                return acc
            } else {
                throw new Error(`Unrecognized KV metadata version ${k.metadata.v} for key ${k.name}`)
            }
        }, {} as Record<string, any>)
    }
}