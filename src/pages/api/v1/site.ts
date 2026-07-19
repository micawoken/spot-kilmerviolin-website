/**
 * /pages/api/v1/site.ts
 *
 * Provides several endpoints for the site's machinery
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

import type { APIRoute } from "astro"
import { auth_check } from "../../../lib/public/authservice"
import { constructResponse, constructResponseErrorHook } from "../../../lib/api/http"
import verinfo from "../../../lib/api/verinfo"
import rebuild, { RebuildCooldownError } from "../../../lib/api/rebuild"
import { purgeCacheAll } from "../../../lib/api/database"
import { detectEnvironment } from "../../../lib/api/environment"
import { requiresOneOf } from "../../../lib/api/authorize"

/**
 * GET /api/v1/site
 * Returns information about the current worker build, including build timestamp, build ID, and git tag (if available)
 *
 * Permissions required: none
 *
 * Meta: none
 * Body: none
 *
 * @param context - the Astro API context
 * @returns a Response object with payload of the worker build information, or an error message if authentication fails
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    try {
        const data = verinfo(request)
        return constructResponse(request, data, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Failed to retrieve build information")
    }
}

/**
 * POST /api/v1/site
 * Triggers a rebuild on Worker Builds using the deploy hook
 *
 * Permissions required: cms_editor or design_editor (a rebuild only publishes content or design changes,
 * so it is restricted to callers who can make one of those)
 *
 * Meta: none
 * Body: none
 *
 * @param context - the Astro API context
 * @returns a Response object with payload of success message, or an error message if authentication fails
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    // auth_check's own perms list is an AND across permissions (requiresAllOf); this needs an OR of the
    // two, so it is checked separately here. locals.identity is only undefined when auth is disabled
    // (local dev, per auth_check above), which is left unrestricted like every other endpoint here.
    if (locals.identity && !locals.identity.admin && !requiresOneOf(["cms_editor", "design_editor"], locals.identity, false)) {
        return constructResponse(request, null, 403, "Forbidden")
    }
    // rebuilds redeploy the live Worker, which is meaningless from a local development build
    if (detectEnvironment(request) === "development") {
        return constructResponse(request, null, 403, "Site rebuild is disabled in the development environment")
    }
    try {
        const data = await rebuild()
        return constructResponse(request, data, 200)
    } catch (error) {
        // a rebuild requested too soon after the last build is rejected as 429, surfacing the wait time
        if (error instanceof RebuildCooldownError) {
            return constructResponse(request, { retry_after_sec: error.retry_after_sec }, 429, error.message, {
                "Retry-After": error.retry_after_sec.toString()
            })
        }
        return constructResponseErrorHook(request, error, 500, "Failed to trigger rebuild")
    }
}

/**
 * DELETE /api/v1/site
 * Purge the database cache for the site
 *
 * Permissions required: none
 *
 * Meta: none
 * Body: none
 *
 * @param context - the Astro API context
 * @returns a Response object with payload of success message, or an error message if authentication fails
 */
export const DELETE: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    try {
        const success = await purgeCacheAll()
        if (success) {
            return constructResponse(request, { message: "Cache purged successfully" }, 200)
        } else {
            return constructResponse(request, { error: "Failed to purge cache" }, 500)
        }
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Failed to purge cache")
    }
}
