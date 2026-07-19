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
 * Carries the number of seconds the caller must still wait so it can be surfaced to the client.
 */
export class RebuildCooldownError extends Error {
    constructor(public readonly retry_after_sec: number) {
        super(`Too soon after the last rebuild. Try again in ${retry_after_sec} seconds.`)
        this.name = "RebuildCooldownError"
    }
}

/**
 * Returns the number of seconds remaining before another rebuild is permitted (0 if allowed now)
 *
 * @returns {number} seconds remaining in the cooldown window, or 0 when a rebuild may proceed
 */
export function rebuildCooldownRemaining(): number {
    const built = Date.parse(env.CF_VERSION_METADATA.timestamp)
    if (isNaN(built)) {
        // without a usable build timestamp we cannot enforce the cooldown, so do not block
        return 0
    }
    const cooldown_ms = Number(env.REBUILD_COOLDOWN_SEC) * 1000
    const remaining_ms = built + cooldown_ms - Date.now()
    return remaining_ms > 0 ? Math.ceil(remaining_ms / 1000) : 0
}

/**
 * Trigger an automated rebuild and deploy of the Astro site to Cloudflare Workers
 *
 */
export default async function rebuild() {
    const remaining = rebuildCooldownRemaining()
    if (remaining > 0) {
        throw new RebuildCooldownError(remaining)
    }
    const deploy_hook = deploy_hook_url + env.CF_DEPLOY_HOOK
    const response = await fetch(deploy_hook, {
        method: "POST"
    })
    if (!response.ok) {
        // throw so the endpoint surfaces a 5xx; a non-ok deploy-hook response means the rebuild did not
        // start, and silently returning undefined would let the caller report success
        console.error("Failed to trigger rebuild:", response.statusText)
        throw new Error(`Deploy hook responded ${response.status} ${response.statusText}`)
    }
}
