/**
 * tests/caching.test.ts
 * 
 * Tests the database caching layer
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

import { describe, it, expect } from 'vitest'

import { env } from 'cloudflare:workers'

import { putCache, _putCache, getCache, _getCache, deleteCacheKey } from '../src/lib/api/caching'

const generic_data = {
    status: 200,
    message: "data here",
    payload: {
        "a": 1,
        "b": 2,
        "c": 3
    }
}

const null_data = null

const array_data = [1,2,3]

describe("Put generic into cache", () => {
    it("should put generic data into cache and retrieve it", async () => {
        await putCache("test_store", "generic_key", [generic_data], "generic comment", false)
        const cached_response = await getCache("test_store", "generic_key")
        expect(cached_response).toEqual([generic_data])
    })
}
)

describe("Put null into cache", () => {
    it("should put null data into cache and retrieve it", async () => {
        await putCache("test_store", "null_key", null_data, "null comment", false)
        const cached_response = await getCache("test_store", "null_key")
        expect(cached_response).toEqual(null_data)
    })
})

describe("Cache TTL policy", () => {
    it("uses the short TTL when long is false", async () => {
        await putCache("test_store", "short_ttl_key", array_data, "short", false)
        const response = await _getCache("test_store", `${env.WORKER_ORIGIN}/cache/short_ttl_key`)
        expect(response).toBeDefined()
        expect(response!.headers.get("Cache-Control")).toContain(`max-age=${env.CACHE_API_TTL}`)
    })

    it("uses the long TTL when long is true", async () => {
        await putCache("test_store", "long_ttl_key", array_data, "long", true)
        const response = await _getCache("test_store", `${env.WORKER_ORIGIN}/cache/long_ttl_key`)
        expect(response).toBeDefined()
        expect(response!.headers.get("Cache-Control")).toContain(`max-age=${env.CACHE_API_TTL_LONG}`)
    })
})

describe("Cache eviction", () => {
    it("deleteCacheKey removes a cached entry", async () => {
        await putCache("test_store", "evict_key", array_data, "to be evicted", false)
        expect(await getCache("test_store", "evict_key")).toEqual(array_data)
        const deleted = await deleteCacheKey("test_store", "evict_key")
        expect(deleted).toBe(true)
        expect(await getCache("test_store", "evict_key")).toBeNull()
    })

    it("deleteCacheKey returns false for missing entries", async () => {
        expect(await deleteCacheKey("test_store", "never_existed")).toBe(false)
    })
})