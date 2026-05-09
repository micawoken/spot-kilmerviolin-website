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

function constructMetadata(value: string, type: "text" | "json", ttl: number): KVMetadata {
    return {
        v: 1,
        f: type,
        t: Date.now(),
        e: ttl,
        value: value.length < 750 ? value : null
    }
}

export async function getKey(key: string, properties?: Partial<KVNamespaceGetOptions<undefined>>): Promise<any> {
    const value = await database.getWithMetadata(key, properties)
    if (!value) {
        return null
    }
    const output = (value.metadata as KVMetadata)?.f === "json" ? JSON.parse(value.value as string) : value.value
    return output
}

export async function setKey(key: string, value: string | object, mode: 'text' | 'json'): Promise<void> {
    const entry = mode === "text" ? value as string : JSON.stringify(value)
    const metadata = constructMetadata(entry, mode, env.KV_CACHE_TTL)
    await database.put(key, entry, {
        metadata: metadata,
        expirationTtl: env.KV_CACHE_TTL
    })
}