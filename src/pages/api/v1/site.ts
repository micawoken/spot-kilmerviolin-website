/**
 * /pages/api/v1/site.ts
 *
 * Provides several endpoints for the site's machinery
 *
 */

import type { APIRoute } from "astro"
import { auth_check } from "../../../lib/public/authservice"
import { constructResponse, constructResponseErrorHook } from "../../../lib/api/http"
import verinfo from "../../../lib/api/verinfo"
import rebuild, { RebuildCooldownError } from "../../../lib/api/rebuild"
import { purgeCacheAll } from "../../../lib/api/database"
import { detectEnvironment } from "../../../lib/api/environment"

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
 * Permissions required: none
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
