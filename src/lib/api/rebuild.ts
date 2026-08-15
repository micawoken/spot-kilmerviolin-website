/**
 * lib/api/rebuild.ts
 *
 * Provides a function to command Cloudflare Workers to rebuild the Astro site and redeploy the Worker
 *
 * Used whenever the database is modified to update the static pages with the new data
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
 * The path to the deploy hook, without the deploy hook ID secret
 */
const deploy_hook_url = "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/"

/**
 * Error thrown when a rebuild is requested before the cooldown window has elapsed since the current build.
 */
export class RebuildCooldownError extends Error {
    constructor(public readonly retry_after_sec: number) {
        super(`Too soon after the last rebuild. Try again in ${retry_after_sec} seconds.`)
        this.name = "RebuildCooldownError"
    }
}

/**
 * Cooldown, in seconds, available to an admin who opts into the override
 */
export const ADMIN_REBUILD_OVERRIDE_COOLDOWN_SEC = 180

/**
 * KV key recording when a rebuild was last fired
 */
const REBUILD_TRIGGER_KEY = "rebuild:last_trigger_ms"

/** Seconds in the applicable cooldown window. */
function cooldownSeconds(elevated: boolean): number {
    return elevated ? ADMIN_REBUILD_OVERRIDE_COOLDOWN_SEC : Number(env.REBUILD_COOLDOWN_SEC)
}

/**
 * Returns the number of seconds remaining before another rebuild is permitted (0 if allowed now)
 *
 * @param {boolean} elevated - when true, checks against the shorter admin-override cooldown instead of
 *   the standard REBUILD_COOLDOWN_SEC window
 * @returns {Promise<number>} seconds remaining in the cooldown window, or 0 when a rebuild may proceed
 * @throws {Error} when the trigger record cannot be read, so an unreadable throttle blocks rather than opens
 */
export async function rebuildCooldownRemaining(elevated: boolean = false): Promise<number> {
    const cooldown_ms = cooldownSeconds(elevated) * 1000
    const now = Date.now()

    // A missing key legitimately means "no recent trigger"
    const raw = await env.KV_DB_CACHE.get(REBUILD_TRIGGER_KEY)
    const last_trigger = raw === null ? 0 : Number(raw)
    const trigger_remaining = isNaN(last_trigger) ? cooldown_ms : last_trigger + cooldown_ms - now

    // Secondary floor: the running version's own build time
    const built = Date.parse(env.CF_VERSION_METADATA.timestamp)
    const build_remaining = isNaN(built) ? cooldown_ms : built + cooldown_ms - now

    const remaining_ms = Math.max(trigger_remaining, build_remaining)
    return remaining_ms > 0 ? Math.ceil(remaining_ms / 1000) : 0
}

/**
 * Trigger an automated rebuild and deploy of the Astro site to Cloudflare Workers
 *
 * @param {boolean} elevated - when true, enforces the shorter admin-override cooldown instead of the
 *   standard one; the caller is responsible for verifying admin status before setting this
 * @throws {RebuildCooldownError} when a rebuild was triggered too recently
 */
export default async function rebuild(elevated: boolean = false) {
    const remaining = await rebuildCooldownRemaining(elevated)
    if (remaining > 0) {
        throw new RebuildCooldownError(remaining)
    }
    const cooldown_sec = cooldownSeconds(elevated)
    // Record the trigger BEFORE calling the hook
    await env.KV_DB_CACHE.put(REBUILD_TRIGGER_KEY, String(Date.now()), { expirationTtl: cooldown_sec + 60 })
    const deploy_hook = deploy_hook_url + env.CF_DEPLOY_HOOK
    const response = await fetch(deploy_hook, {
        method: "POST"
    })
    if (!response.ok) {
        // throw so the endpoint surfaces a 5xx
        console.error("Failed to trigger rebuild:", response.statusText)
        throw new Error(`Deploy hook responded ${response.status} ${response.statusText}`)
    }
}
