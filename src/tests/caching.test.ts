/**
 * Tests the database caching layer
 * 
 * 
 */

import { describe, it, expect } from 'vitest'

import { putCache, _putCache, getCache, _getCache } from '../lib/api/caching'

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