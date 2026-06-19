/**
 * lib/api/caching.ts
 * 
 * Provides services enabling data storage and eviction using the Cache API
 * 
 * Data storage items include:
 * - database records,
 * - API responses, and
 * - HTTP responses
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


import { env } from "cloudflare:workers";

/**
 * Caching policy:
 *  - For complex requests (ones that cannot be executed on the virtual SQL table):
 *    - Check the Cache API (here) using the serialized command
 *    - Query D1 and store the result in Cache API
 *  - For simple requests:
 *    - Check the Cache API (here) using the serialized command
 *    - Check if the Cache API has the full database cached; if so, execute the command on the virtualized database
 *    - Check if KV has the full database cached; if so, execute the command on the virtualized database
 *    - Query D1 for the entire database, store it in cache, and execute it on the virtualized database
 * 
 * Methodology:
 * The main bottlenecks in this Worker are (1) D1 read limits and (2) KV read/write limits. D1 read limits are at 5 million
 * rows read per day, and KV is limited to 100,000 reads per day (1,000 writes and lists per day). Assuming the worst scenario
 * (consistent cache misses, probably caused by low Internet traffic), KV and D1 will be hit frequently. To reduce resources
 * used, KV's main purpose is to store a D1 representation as JSON, with a TTL of about a day, for each D1 table. The database is
 * keyed with the table name, and if the Cache API returns a miss, KV will be queried next. This works for most SQL commands
 * expected from clients - the virtual SQL representation can execute most commands (right now, only commands containing ORDER BY or
 * LIMIT are not "simple"), so no hits to D1 are necessary once KV contains the database representation. The Cache API is used to
 * reduce local requests to KV by caching recent queries to the short cache TTL and by caching the table to the long cache TTL.
 * 
 * A concern with this access pattern is that the KV read pool could be exhausted (as the flip side of the worst case scenario).
 * In this case, functions in the KV module will return no data, and queries will then hit D1 and globally use the long cache policy on
 * the Cache API. Once D1 is exhausted, queries will depend on the cache until it is evicted, after which point no output will be returned.
 * This scenario, however, is very unlikely since if KV and D1 are exhausted, then the Worker invocation limit will have been hit.
 * 
 * Long-term, I intend on making the virtual table able to execute all SQL commands that the SQL statement object can represent so
 * that queries to D1 are minimized as much as possible. However, that isn't a current priority.
 * 
 */


/**
 * The hostname to construct the caching address from
 * 
 * Cloudflare recommends that this be a valid domain name since DNS resolution may occur, so this is being used for now
 * 
 */
const cache_host = "https://spot-kilmer-violin-website.mwmsc.workers.dev"

function generateCacheKey(key: string): string {
    // keys are constants today (table names / fixed identifiers), but encode defensively so a key carrying
    // reserved URL characters cannot alter the cache address path (a one-time miss as constant keys re-derive)
    return `${cache_host}/cache/${encodeURIComponent(key)}`
}

function constructResponse(payload: any[] | null, comment: string, long: boolean): Response {
    const body = JSON.stringify({
        payload: payload,
        comment: comment
    } as CacheRecord)
    const ttl = long ? env.CACHE_API_TTL_LONG : env.CACHE_API_TTL
    return new Response(body, {
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${ttl}, stale-while-revalidate=${ttl * 2}`
        }
    })
}

export async function _putCache(store_name: string, cache_key: string, response: Response): Promise<void> {
    const cache_store = await caches.open(store_name)
    return cache_store.put(cache_key, response.clone())
}

export async function putCache(store_name: string, key: string, payload: any[] | null, comment: string, long: boolean): Promise<void> {
    const response = constructResponse(payload, comment, long)
    await _putCache(store_name, generateCacheKey(key), response)
}

export async function _getCache(store_name: string, cache_key: string): Promise<Response | undefined> {
    const cache_store = await caches.open(store_name)
    return await cache_store.match(cache_key)
}

export async function getCache(store_name: string, key: string): Promise<any[] | null> {
    const cached_response = await _getCache(store_name, generateCacheKey(key))
    if (!cached_response) {
        return null
    }
    const cached_data = await cached_response.json() as CacheRecord
    return cached_data.payload
}

export async function deleteCache(ctx: ExecutionContext, store_name: string, key: string): Promise<void> {
    const db_cache = await caches.open(store_name)
    ctx.waitUntil(db_cache.delete(generateCacheKey(key)))
}

/**
 * Deletes a single entry from the Cache API and resolves once the deletion completes
 * Unlike deleteCache, this does not require an ExecutionContext, so callers control scheduling
 *
 * @param store_name the cache store to delete from
 * @param key the cache key to delete
 * @returns whether an entry existed and was deleted
 */
export async function deleteCacheKey(store_name: string, key: string): Promise<boolean> {
    const cache_store = await caches.open(store_name)
    return await cache_store.delete(generateCacheKey(key))
}