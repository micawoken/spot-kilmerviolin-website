/**
 * pages/api/v1/contributors.ts
 * 
 * Manages contributor records used for identifying project contributors and system authorization
 * 
 * Note: this is not the intended endpoint for adding or removing contributors.
 *  - Add: POST /api/v1/identity with autoenrollment enabled
 *  - Remove: DELETE /api/v1/identity with autodeactivation enabled
 * 
 * These two endpoints in this file provide full management of the contributor table by administrators.
 * 
 * Since the contributors table is used for security-relevant operations,
 * most API endpoints default to least-privileged access and include a meta field
 * to request elevated access if authorized.
 */

import type { APIRoute } from "astro"
import { parseAPIRequest } from "../../../lib/api/common"
import { _constructHeaders, constructResponse, constructResponseErrorHook } from "../../../lib/api/http"
import { auth_check } from "../../../lib/public/authservice"
import { addContributor, listContributors } from "../../../lib/api/database"
import { _stateTypeAssertCompleteContributor } from "../../../lib/api/d1"

/**
 * GET /api/v1/contributors
 * Returns a list of contributor IDs, or the complete record if requested and authorized
 * 
 * Permissions required: none; *admin* to access complete records
 * 
 * Meta: optional
 * Meta fields:
 *  - full: {boolean} if true, returns the full contributor record instead of just IDs
 * 
 * Body: none
 * 
 * @param {APIContext} context - the Astro API context
 * @returns {Response} a Response object with payload of string[] of contributor IDs or D1Contributor[] of complete contributor records
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    // returns JSON as an API response
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    // admin status will be re-checked once meta is processed
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request
    const api_request = await parseAPIRequest(request)
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    try {
        const data = await listContributors(context.locals.cfContext)
        if (data === null) {
            return constructResponse(request, null, 500, "Unknown state: list contributor operation returned null")
        }
        switch (api_request.meta?.full) {
            case true:
                if (!locals.identity!.admin) {
                    return constructResponse(request, null, 403)
                }
                // return full contributor records
                return constructResponse(request, data, 200)
            case false:
            case undefined:
                // return contributor IDs only
                const ids = data.map(record => record.id)
                return constructResponse(request, ids, 200)
            default:
                return constructResponse(request, null, 400, "Invalid value for meta field 'full': must be boolean")
        }
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}

/**
 * POST /api/v1/contributors
 * Adds a contributor record by API request, used for the administrator pages
 * 
 * Permissions required: *admin*
 * 
 * Meta: none
 * Body: required, Contributor object
 * 
 * @param {APIContext} context - the Astro API context
 * @return {Response} a Response object with the ID of the new record, or an error
 * 
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], true)
    if (auth_response !== null) {
        return auth_response
    }
    // pull the payload
    const api_request = await parseAPIRequest(request)
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    // validate the payload as a complete contributor record
    const record: Contributor | string = _stateTypeAssertCompleteContributor(api_request.payload, false)
    if (typeof record === "string") {
        return constructResponse(request, null, 400, `Invalid request body: ${record}`)
    }
    // create the contributor record and return the new ID
    try {
        const id = await addContributor(context.locals.cfContext, record)
        return constructResponse(request, { id }, 201, undefined, {
                "Location": `/api/v1/contributors/${id}`
            }
        )
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}