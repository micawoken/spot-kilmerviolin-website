/**
 * lib/public/ratelimit.ts
 *
 * Implements rate limiting on the API
 *
 *
 *
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

import { env } from "cloudflare:workers"

/**
 * Identifies the rate limit scope, used to select which rate limit applies
 */
export enum RLScope {
    /**
     * Applies to all Worker invocations
     */
    IP_GLOBAL,
    /**
     * Applies to all admin API endpoints (everything behind Access)
     */
    ENDPOINT_API_ADMIN_GLOBAL,
    /**
     * Applies to admin API endpoints and limits by user
     */
    ENDPOINT_API_ADMIN_USER,
    /**
     * Applies to admin pages that are dynamically rendered, limits by user
     */
    ENDPOINT_PAGERENDER_ADMIN,
    /**
     * Aggregate backstop across all callers, applied before authentication resolves an identity — so it
     * covers requests that are about to be REJECTED as well as those that succeed
     */
    ENDPOINT_API_PUBLIC,
    /**
     * Applies to file reads (GET /api/v1/files/{id}), limited by IP against the dedicated
     * RL_API_FILES_READ binding to keep R2 Class B operation volume within the free plan
     */
    ENDPOINT_API_FILES_READ,
    /**
     * Applies to file lists/uploads/replacements/deletions, limited by user against the dedicated
     * RL_API_FILES_WRITE binding to keep R2 Class A operation volume within the free plan
     */
    ENDPOINT_API_FILES_WRITE
}

/** How a scope's bucket is keyed: per client IP, per authenticated user, or one bucket for everyone. */
export type RLKeyType = "ip" | "user" | "global"

/** The single bucket every "global" scope shares — an aggregate cap, not a per-caller one. */
const GLOBAL_KEY = "key:global"

/**
 * Per-scope rate-limit configuration. Each scope routes to the binding declared for it in wrangler.jsonc
 * so the configured budgets are actually in force: previously every scope but the two file ones pointed
 * at RL_FREQ (20 per 10s), which left RL_API_PUBLIC, RL_API_ADMIN_GLOBAL, RL_API_ADMIN_USER and
 * RL_ADMIN_RENDER declared but unreferenced — and made the effective admin-API allowance ~120/min rather
 * than the intended 50/min. Bindings are resolved lazily so env access happens at call time rather than
 * module load. An unmapped scope falls back to RL_FREQ for the binding and throws when its key type is
 * requested.
 */
const RL_SCOPE_CONFIG: Record<RLScope, { binding: () => RateLimit; keyType: RLKeyType }> = {
    [RLScope.IP_GLOBAL]: { binding: () => env.RL_FREQ, keyType: "ip" },
    // "global" in the name means one aggregate bucket, so it must not be keyed per user — that made it a
    // duplicate of the per-user scope beside it and left nothing bounding total API volume.
    [RLScope.ENDPOINT_API_ADMIN_GLOBAL]: { binding: () => env.RL_API_ADMIN_GLOBAL, keyType: "global" },
    [RLScope.ENDPOINT_API_ADMIN_USER]: { binding: () => env.RL_API_ADMIN_USER, keyType: "user" },
    [RLScope.ENDPOINT_PAGERENDER_ADMIN]: { binding: () => env.RL_ADMIN_RENDER, keyType: "user" },
    // the aggregate backstop for callers with no identity yet (see the pre-identity pass in
    // middleware/ratelimit.ts), which is where unmetered anonymous volume used to land
    [RLScope.ENDPOINT_API_PUBLIC]: { binding: () => env.RL_API_PUBLIC, keyType: "global" },
    // file reads are metered by IP (mirroring the global frequency limit); file writes by user
    [RLScope.ENDPOINT_API_FILES_READ]: { binding: () => env.RL_API_FILES_READ, keyType: "ip" },
    [RLScope.ENDPOINT_API_FILES_WRITE]: { binding: () => env.RL_API_FILES_WRITE, keyType: "user" }
}

/**
 * How a scope is keyed, so the middleware can split scopes across its pre-identity and post-identity
 * passes: an IP- or globally-keyed scope needs no identity and runs before authentication, a user-keyed
 * one cannot run until an identity exists.
 *
 * @param {RLScope} scope - the scope to classify
 * @returns {RLKeyType} the scope's key type
 * @throws {Error} when the scope has no configuration entry
 */
export function scopeKeyType(scope: RLScope): RLKeyType {
    const config = RL_SCOPE_CONFIG[scope]
    if (!config) {
        throw new Error("Invalid RLScope")
    }
    return config.keyType
}

/**
 * Maps a rate-limit scope to the binding that enforces it, falling back to RL_FREQ for any unmapped
 * scope (preserving the previous shared-binding default).
 */
function _scopeBinding(rl_key: RLScope): RateLimit {
    return (RL_SCOPE_CONFIG[rl_key]?.binding ?? (() => env.RL_FREQ))()
}

function generateRLValue(request: Request, identity?: Identity): { ip: string; user: string } {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown_ip"
    const user = identity ? identity.id : "unknown_id"
    return {
        ip: "key:" + ip,
        user: "key:" + user
    }
}

function _unpackKey(key_pair: { ip: string; user: string } | string, rl_key: RLScope): string {
    if (typeof key_pair === "string") {
        return key_pair
    }
    switch (scopeKeyType(rl_key)) {
        case "ip":
            return key_pair.ip
        case "user":
            return key_pair.user
        // one shared bucket, so the key is a constant rather than anything caller-derived
        case "global":
            return GLOBAL_KEY
    }
}

async function _call_RL(
    rl_key: RLScope,
    rl_value: { ip: string; user: string } | string,
    auto_global: boolean = true
): Promise<boolean> {
    let rl_entry: string
    if (typeof rl_value !== "string") {
        rl_entry = _unpackKey(rl_value, rl_key)
    } else {
        rl_entry = rl_value
    }
    if (auto_global) {
        const outcome_global = await env.RL_FREQ.limit({ key: rl_entry })
        if (!outcome_global.success) {
            // global RL failed
            return false
        }
    }
    if (rl_key === RLScope.IP_GLOBAL && auto_global) {
        // global RL already called; return
        return true
    }
    // most scopes share RL_FREQ keyed per scope; the file scopes use their own dedicated bindings
    const outcome = await _scopeBinding(rl_key).limit({ key: `${rl_key}:${rl_entry}` })
    return outcome.success
}

async function _call_RLs(
    rl_keys: RLScope[],
    rl_value: { ip: string; user: string } | string,
    auto_global: boolean = true
): Promise<boolean> {
    if (auto_global) {
        const outcome_global = await env.RL_FREQ.limit({ key: typeof rl_value === "string" ? rl_value : rl_value.ip })
        if (!outcome_global.success) {
            // global RL failed
            return false
        }
    }
    for (const rl_key of rl_keys) {
        // _call_RL is async; without awaiting it the returned Promise is always truthy and every
        // per-scope limit would be silently skipped (only the global RL_FREQ check above would apply)
        if (!(await _call_RL(rl_key, rl_value, false))) {
            return false
        }
    }
    return true
}

/**
 * Applies the given rate-limit scopes to a request, returning false when any of them is exceeded.
 *
 * @param {Request} request - the request being metered
 * @param {RLScope | RLScope[]} scope - the scope(s) to apply
 * @param {Identity} [identity] - the authenticated identity, required for user-keyed scopes
 * @param {boolean} [auto_global] - whether to additionally apply the shared per-IP frequency limit
 *   (RL_FREQ). Set false on a second pass over the same request so one request is not counted twice
 *   against it.
 * @returns {Promise<boolean>} true when the request may proceed
 */
export async function ratelimit(
    request: Request,
    scope: RLScope | RLScope[],
    identity?: Identity,
    auto_global: boolean = true
): Promise<boolean> {
    const rl_value = generateRLValue(request, identity)
    if (Array.isArray(scope)) {
        return await _call_RLs(scope, rl_value, auto_global)
    } else {
        return await _call_RL(scope, rl_value, auto_global)
    }
}
