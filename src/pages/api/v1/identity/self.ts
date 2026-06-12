/**
 * pages/api/v1/identity/self.ts
 * 
 * Provides endpoints related to self-identity management, including identity info, self-enrollment, and other features
 * 
 */

import type { APIRoute } from "astro";
import { parseAPIRequest } from "../../../../lib/api/common"
import { auth_check } from "../../../../lib/public/authservice"
import { constructResponse } from "../../../../lib/api/http"
import { finishUser } from "../../../../lib/public/usermgmt"
import { _stateTypeAssertPartialContributor } from "../../../../lib/api/d1"

/**
 * GET /api/v1/identity/self
 * Returns information about the authenticated user's identity, including email and any pending self-enrollment status
 * 
 * Permissions required: none
 * 
 * Meta: none
 * Body: none
 * 
 * @param {APIContext} context - the Astro API context
 * @returns {Response} a Response object containing the Identity object
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false, "selfmgmt")
    if (auth_response !== null) {
        return auth_response
    }
    // return identity
    return constructResponse(request, locals.identity, 200)
}

/**
 * POST /api/v1/identity/self
 * Perform self-enrollment for the authenticated user and construct a Contributor record; if successful, returns the contributor ID
 * 
 * Permissions required: none
 * 
 * Meta: none
 * Body: required, JSON array containing one partial Contributor record with properties: name (required), major, class_year (optional; omitted or null values are stored as null)
 * 
 * @param {APIContext} context - the Astro API context
 * @returns {Response} a Response object containing the contributor ID if enrollment is successful, or an error message if enrollment fails
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false, "enroll")
    if (auth_response !== null) {
        return auth_response
    }
    // parse request
    const api_request = await parseAPIRequest(request)
    if (api_request instanceof Error) {
        return constructResponse(request, { error: api_request.message }, 400)
    }
    // check if the payload is not null and has a length of 1
    if (api_request.payload === null || !Array.isArray(api_request.payload) || api_request.payload.length !== 1) {
        return constructResponse(request, null, 400, "Invalid request body: must be an array with a single item")
    }
    // validate request body
    const record = _stateTypeAssertPartialContributor(api_request.payload[0], false)
    if (typeof record === "string") {
        return constructResponse(request, null, 400, `Invalid request body: ${record}`)
    }
    // validate keys
    // major and class_year are nullable columns and may be omitted or null; only the name is required
    const required_keys = ["name"]
    for (const key of required_keys) {
        if (!(key in record)) {
            return constructResponse(request, null, 400, `Invalid request body: missing required property ${key}`)
        }
    }
    // perform self-enrollment
    try {
        const contributor_id = await finishUser(locals.cfContext, locals.identity!.email, record.name, record.major ?? null, record.class_year ?? null)
        if (contributor_id === null) {
            // should be imposible
            return constructResponse(request, null, 500, "Failed to finish user enrollment: user is missing from access list but has a contributor record")
        } else if (contributor_id === undefined) {
            // error - either is fully enrolled, or does not exist
            return constructResponse(request, null, 500, "Failed to finish user enrollment: user is either fully enrolled or does not exist in the database")
        } else {
            return constructResponse(request, null, 201, undefined, {
                "Location": `/api/v1/contributors/${contributor_id}`
            })
        }
    } catch (error) {
        console.log("Error during self-enrollment:", error)
        return constructResponse(request, null, 500, "Failed to finish user enrollment")
    }
}