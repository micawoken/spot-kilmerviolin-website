/**
 * lib/api/r2-quota.ts
 *
 * Serializes the app's shared R2 storage ceiling through a Durable Object so concurrent writes cannot
 * collectively exceed it
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

import { DurableObject, env } from "cloudflare:workers"

export const MAX_R2_STORAGE_BYTES = 9 * 1024 * 1024 * 1024

const QUOTA_OBJECT_NAME = "shared-r2-capacity"
const STATE_KEY = "quota-state"
const RECONCILE_INTERVAL_MS = 60 * 60 * 1000

interface QuotaState {
    used: number
    reconciledAt: number
}

interface QuotaMutation {
    bytes: number
}

export class R2CapacityError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "R2CapacityError"
    }
}

async function quotaRequest(path: string, body?: QuotaMutation): Promise<Response> {
    const stub = env.R2_QUOTA.getByName(QUOTA_OBJECT_NAME)
    return await stub.fetch(`https://r2-quota.internal${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
    })
}

/** Atomically claims storage capacity before a write begins. */
export async function claimR2Capacity(bytes: number): Promise<void> {
    const response = await quotaRequest("/claim", { bytes })
    if (response.status === 507) {
        throw new R2CapacityError(`Storage capacity exceeded while claiming ${bytes} bytes`)
    }
    if (!response.ok) {
        throw new Error(`R2 quota claim failed with status ${response.status}`)
    }
}

/** Adjusts tracked usage after a failed write, replacement, or deletion. */
export async function adjustR2Usage(bytes: number): Promise<void> {
    const response = await quotaRequest("/adjust", { bytes })
    if (!response.ok) {
        throw new Error(`R2 quota adjustment failed with status ${response.status}`)
    }
}

/** Returns the Durable Object's shared usage counter. */
export async function getR2Usage(): Promise<number> {
    const response = await quotaRequest("/usage")
    if (!response.ok) {
        throw new Error(`R2 quota usage request failed with status ${response.status}`)
    }
    const result = (await response.json()) as { used: unknown }
    if (!Number.isSafeInteger(result.used) || (result.used as number) < 0) {
        throw new Error("R2 quota returned an invalid usage value")
    }
    return result.used as number
}

/** Serializes shared R2 usage checks and periodically reconciles the counter against both buckets. */
export class R2Quota extends DurableObject<Env> {
    private operation: Promise<unknown> = Promise.resolve()

    private serialize<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.operation.then(operation, operation)
        this.operation = result.then(
            () => undefined,
            () => undefined
        )
        return result
    }

    private async bucketUsage(bucket: R2Bucket): Promise<number> {
        let total = 0
        let cursor: string | undefined
        do {
            const listing = await bucket.list({ cursor })
            for (const object of listing.objects) total += object.size
            cursor = listing.truncated ? listing.cursor : undefined
        } while (cursor !== undefined)
        return total
    }

    private async reconcile(): Promise<QuotaState> {
        const [files, media] = await Promise.all([
            this.bucketUsage(this.env.R2_FILES),
            this.bucketUsage(this.env.EMDASH_MEDIA)
        ])
        const state = { used: files + media, reconciledAt: Date.now() }
        await this.ctx.storage.put(STATE_KEY, state)
        return state
    }

    private async state(): Promise<QuotaState> {
        const stored = await this.ctx.storage.get<QuotaState>(STATE_KEY)
        if (
            stored === undefined ||
            !Number.isSafeInteger(stored.used) ||
            stored.used < 0 ||
            !Number.isFinite(stored.reconciledAt) ||
            Date.now() - stored.reconciledAt >= RECONCILE_INTERVAL_MS
        ) {
            return await this.reconcile()
        }
        return stored
    }

    private async mutation(request: Request): Promise<number | null> {
        try {
            const body = (await request.json()) as Partial<QuotaMutation>
            return Number.isSafeInteger(body.bytes) ? (body.bytes as number) : null
        } catch {
            return null
        }
    }

    private async route(request: Request): Promise<Response> {
        const pathname = new URL(request.url).pathname
        if (request.method === "GET" && pathname === "/usage") {
            const state = await this.state()
            return Response.json({ used: state.used, max: MAX_R2_STORAGE_BYTES })
        }
        if (request.method === "POST" && pathname === "/claim") {
            const bytes = await this.mutation(request)
            if (bytes === null || bytes < 0) return new Response("Invalid quota claim", { status: 400 })
            const state = await this.state()
            if (state.used + bytes > MAX_R2_STORAGE_BYTES) {
                return new Response("Storage capacity exceeded", { status: 507 })
            }
            await this.ctx.storage.put(STATE_KEY, { ...state, used: state.used + bytes })
            return new Response(null, { status: 204 })
        }
        if (request.method === "POST" && pathname === "/adjust") {
            const bytes = await this.mutation(request)
            if (bytes === null) return new Response("Invalid quota adjustment", { status: 400 })
            const state = await this.state()
            await this.ctx.storage.put(STATE_KEY, { ...state, used: Math.max(0, state.used + bytes) })
            return new Response(null, { status: 204 })
        }
        if (request.method === "POST" && pathname === "/reconcile") {
            const state = await this.reconcile()
            return Response.json({ used: state.used, max: MAX_R2_STORAGE_BYTES })
        }
        return new Response("Not found", { status: 404 })
    }

    override fetch(request: Request): Promise<Response> {
        return this.serialize(() => this.route(request))
    }
}
