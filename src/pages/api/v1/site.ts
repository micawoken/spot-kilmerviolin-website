/**
 * /pages/api/v1/site.ts
 * 
 * Provides several endpoints for the site's machinery
 * 
 */

import type { APIRoute } from "astro"
import { auth_check } from "../../../lib/public/authservice"
import { constructResponse } from "../../../lib/api/http"
import verinfo from "../../../lib/api/verinfo"
import rebuild from "../../../lib/api/rebuild"
import { purgeCache } from "../../../lib/api/caching"
import { purgeCacheAll } from "../../../lib/api/database"

/**
 * GET /api/v1/site
 * Returns information about the current worker build, including build timestamp, build ID, and git tag (if available)
 * 
 * Permissions required: none
 * 
 * Meta: none
 * Body: none
 * 
 * @param {APIContext} context - the Astro API context
 * @returns {Response} a Response object with payload of the worker build information, or an error message if authentication fails
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    const data = verinfo(request)
    return constructResponse(request, data, 200)
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
 * @param {APIContext} context - the Astro API context
 * @returns {Response} a Response object with payload of success message, or an error message if authentication fails
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    const data = await rebuild()
    return constructResponse(request, data, 200)
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
 * @param {APIContext} context - the Astro API context
 * @returns {Response} a Response object with payload of success message, or an error message if authentication fails
 */
export const DELETE: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    const success = await purgeCacheAll()
    if (success) {
        return constructResponse(request, { message: "Cache purged successfully" }, 200)
    } else {
        return constructResponse(request, { error: "Failed to purge cache" }, 500)
    }
}