/**
 * tests/r2-quota.test.ts
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

/**
 * Regression coverage for the shared R2 storage quota (security audit SEC-003).
 *
 * The bypass the audit found was a check-then-write that concurrent uploads could all pass, so the
 * decisive test is that overlapping claims are settled one at a time and cannot collectively exceed the
 * ceiling.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { env } from "cloudflare:test"
import { adjustR2Usage, claimR2Capacity, getR2Usage, MAX_R2_STORAGE_BYTES, R2CapacityError } from "../src/lib/api/r2-quota"

/** Resets the singleton quota object so each test starts from a reconciled, empty count. */
async function resetQuota(): Promise<void> {
    const stub = env.R2_QUOTA.getByName("shared-r2-capacity")
    const response = await stub.fetch("https://r2-quota.internal/reconcile", { method: "POST" })
    expect(response.ok).toBe(true)
}

describe("shared R2 quota", () => {
    beforeEach(resetQuota)

    it("reports zero usage against the configured ceiling when both buckets are empty", async () => {
        expect(await getR2Usage()).toBe(0)
    })

    it("accumulates claims", async () => {
        await claimR2Capacity(1024)
        await claimR2Capacity(512)
        expect(await getR2Usage()).toBe(1536)
    })

    it("releases capacity when a write is rolled back", async () => {
        await claimR2Capacity(4096)
        await adjustR2Usage(-4096)
        expect(await getR2Usage()).toBe(0)
    })

    it("never lets the counter fall below zero", async () => {
        await adjustR2Usage(-4096)
        expect(await getR2Usage()).toBe(0)
    })

    it("refuses a claim that would cross the ceiling", async () => {
        await expect(claimR2Capacity(MAX_R2_STORAGE_BYTES + 1)).rejects.toBeInstanceOf(R2CapacityError)
        expect(await getR2Usage()).toBe(0)
    })

    it("admits a claim that lands exactly on the ceiling", async () => {
        await claimR2Capacity(MAX_R2_STORAGE_BYTES)
        expect(await getR2Usage()).toBe(MAX_R2_STORAGE_BYTES)
        await expect(claimR2Capacity(1)).rejects.toBeInstanceOf(R2CapacityError)
    })

    it("serializes concurrent claims so they cannot collectively exceed the ceiling", async () => {
        // each claim is over half the ceiling, so exactly one of the two may succeed
        const half = Math.floor(MAX_R2_STORAGE_BYTES / 2) + 1
        const results = await Promise.allSettled([claimR2Capacity(half), claimR2Capacity(half)])

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
        const rejected = results.find((result) => result.status === "rejected")
        expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(R2CapacityError)
        expect(await getR2Usage()).toBe(half)
    })

    it("rejects a malformed claim rather than treating it as zero", async () => {
        const stub = env.R2_QUOTA.getByName("shared-r2-capacity")
        const response = await stub.fetch("https://r2-quota.internal/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bytes: "lots" })
        })
        expect(response.status).toBe(400)
        expect(await getR2Usage()).toBe(0)
    })

    it("rejects a negative claim", async () => {
        const stub = env.R2_QUOTA.getByName("shared-r2-capacity")
        const response = await stub.fetch("https://r2-quota.internal/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bytes: -1 })
        })
        expect(response.status).toBe(400)
    })

    it("reconciles the counter against the real bucket contents", async () => {
        await env.R2_FILES.put("quota-test/a.bin", new Uint8Array(2048))
        await env.EMDASH_MEDIA.put("quota-test/b.bin", new Uint8Array(1024))
        try {
            await resetQuota()
            expect(await getR2Usage()).toBe(3072)
        } finally {
            await env.R2_FILES.delete("quota-test/a.bin")
            await env.EMDASH_MEDIA.delete("quota-test/b.bin")
        }
    })
})
