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
 * 
 * 
 */

/**
 * Builds a metadata object for a KV entry
 * Properties:
 *  - v: version number
 *  - f: data type - text or json
 *  - t: creation timestamp, in milliseconds since epoch
 *  - e: expiration time in seconds, set in env.KV_CACHE_TTL
 *  - value: the value to cache; truncated if greater than 750 characters to stay under 1024 character limit
 * 
 * @param value The string value to cache
 * @param type The data type, as text or json
 * @param ttl The TTL of the cache entry, in seconds
 * @return A KVMetadata object to use for the cache entry
 */
function constructMetadata(value: string, type: "text" | "json", ttl: number): KVMetadata {
    return {
        v: 1,
        f: type,
        t: Date.now(),
        e: ttl,
        value: value.length < 750 ? value : null
    }
}

/**
 * Retrieves a value from KV by key
 * 
 * @param key The key to retrieve
 * @param properties Optional KV get properties
 * @return The value stored at the key, parsed as JSON if the metadata indicates it is JSON; null if the key does not exist
 */
export async function getKey(key: string, properties?: Partial<KVNamespaceGetOptions<undefined>>): Promise<any> {
    const value = await database.getWithMetadata(key, properties)
    if (!value) {
        return null
    }
    const output = (value.metadata as KVMetadata)?.f === "json" ? JSON.parse(value.value as string) : value.value
    return output
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