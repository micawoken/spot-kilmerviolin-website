/**
 * tests/kv.test.ts
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

/// <reference path="../src/lib/api/types.d.ts" />

/**
 * Tests the KV caching primitives (kv.ts) against the simulated KV namespace
 */

import { describe, it, expect } from "vitest"
import { env } from "cloudflare:workers"

import { getKey, setKey, deleteKey, listKeys } from "../src/lib/api/kv.ts"

describe("KV roundtrips", () => {
    it("stores and retrieves JSON values", async () => {
        const data = [{ a: 1, b: "two", c: null }]
        await setKey("json_key", data, "json")
        expect(await getKey("json_key")).toEqual(data)
    })

    it("stores and retrieves text values", async () => {
        await setKey("text_key", "plain text value", "text")
        expect(await getKey("text_key")).toBe("plain text value")
    })

    it("returns null for missing keys", async () => {
        expect(await getKey("does_not_exist")).toBeNull()
    })

    it("deletes keys", async () => {
        await setKey("delete_me", "value", "text")
        await deleteKey("delete_me")
        expect(await getKey("delete_me")).toBeNull()
    })

    it("retrieves JSON values larger than the metadata truncation limit", async () => {
        // metadata embeds values under 750 characters; larger values must still read back via the value itself
        const big = [{ filler: "x".repeat(2000) }]
        await setKey("big_key", big, "json")
        expect(await getKey("big_key")).toEqual(big)
    })
})

describe("KV list operations", () => {
    it("lists key names", async () => {
        await setKey("list_a", "1", "text")
        await setKey("list_b", "2", "text")
        const names = await listKeys(false) as string[]
        expect(names).toContain("list_a")
        expect(names).toContain("list_b")
    })

    it("lists records without throwing on keys that have no metadata", async () => {
        await setKey("with_meta", { ok: true }, "json")
        // simulate an externally-written key that lacks the module's metadata envelope
        await (env as { KV_DB_CACHE: KVNamespace }).KV_DB_CACHE.put("raw_key", "raw value")
        const records = await listKeys(true) as Record<string, any>
        expect(records.with_meta).toEqual({ ok: true })
        expect("raw_key" in records).toBe(true)
        expect(records.raw_key).toBeUndefined()
    })
})
