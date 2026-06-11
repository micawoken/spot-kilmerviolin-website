/**
 * lib/public/ratelimit.ts
 * 
 * Implements rate limiting on the API
 * 
 * 
 * 
 * 
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
     * Applies to public endpoints (i.e., those related to search)
     */
    ENDPOINT_API_PUBLIC,
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
    ENDPOINT_PAGERENDER_ADMIN
}


function generateRLValue(request: Request, identity?: Identity): { ip: string, user: string } {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown_ip"
    const user = identity ? identity.id : "unknown_id"
    return {
        ip: "key:" + ip,
        user: "key:" + user
    }
}

function _unpackKey(key_pair: { ip: string, user: string } | string, rl_key: RLScope): string {
    if (typeof key_pair === "string") {
        return key_pair
    }
    switch (rl_key) {
        case RLScope.IP_GLOBAL:
            return key_pair.ip
        case RLScope.ENDPOINT_API_PUBLIC:
        case RLScope.ENDPOINT_API_ADMIN_GLOBAL:
        case RLScope.ENDPOINT_API_ADMIN_USER:
        case RLScope.ENDPOINT_PAGERENDER_ADMIN:
            return key_pair.user
        default:
            throw new Error("Invalid RLScope")
    }
}

async function _call_RL(rl_key: RLScope, rl_value: { ip: string, user: string } | string, auto_global: boolean = true): Promise<boolean> {
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
    const outcome = await env.RL_FREQ.limit({ key: `${rl_key}:${rl_entry}` })
    return outcome.success
}

async function _call_RLs(rl_keys: RLScope[], rl_value: { ip: string, user: string } | string, auto_global: boolean = true): Promise<boolean> {
    if (auto_global) {
        const outcome_global = await env.RL_FREQ.limit({ key: typeof rl_value === "string" ? rl_value : rl_value.ip })
        if (!outcome_global.success) {
            // global RL failed
            return false
        }
    }
    for (const rl_key of rl_keys) {
        if (!_call_RL(rl_key, rl_value, false)) {
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