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

/**
 * Per-scope rate-limit configuration. Most scopes share RL_FREQ (keyed per scope) and only differ in
 * whether they meter by IP or by user; the file scopes route to their own bindings so file traffic is
 * metered independently of the other API limits. Bindings are resolved lazily so env access happens at
 * call time rather than module load. An unmapped scope falls back to RL_FREQ for the binding (matching
 * the previous switch default) and throws when its key type is requested.
 */
const RL_SCOPE_CONFIG: Record<RLScope, { binding: () => RateLimit; keyType: "ip" | "user" }> = {
    [RLScope.IP_GLOBAL]: { binding: () => env.RL_FREQ, keyType: "ip" },
    [RLScope.ENDPOINT_API_ADMIN_GLOBAL]: { binding: () => env.RL_FREQ, keyType: "user" },
    [RLScope.ENDPOINT_API_ADMIN_USER]: { binding: () => env.RL_FREQ, keyType: "user" },
    [RLScope.ENDPOINT_PAGERENDER_ADMIN]: { binding: () => env.RL_FREQ, keyType: "user" },
    // file reads are metered by IP (mirroring the global frequency limit); file writes by user
    [RLScope.ENDPOINT_API_FILES_READ]: { binding: () => env.RL_API_FILES_READ, keyType: "ip" },
    [RLScope.ENDPOINT_API_FILES_WRITE]: { binding: () => env.RL_API_FILES_WRITE, keyType: "user" }
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
    const config = RL_SCOPE_CONFIG[rl_key]
    if (!config) {
        throw new Error("Invalid RLScope")
    }
    return config.keyType === "ip" ? key_pair.ip : key_pair.user
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

export async function ratelimit(request: Request, scope: RLScope | RLScope[], identity?: Identity): Promise<boolean> {
    const rl_value = generateRLValue(request, identity)
    if (Array.isArray(scope)) {
        return await _call_RLs(scope, rl_value)
    } else {
        return await _call_RL(scope, rl_value)
    }
}
