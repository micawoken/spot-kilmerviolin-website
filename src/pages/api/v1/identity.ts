/**
 * pages/api/v1/identity.ts
 * 
 * Provides access to the Cloudflare API for Access policy management
 * 
 */

import type { APIRoute } from "astro"
import { parseAPIRequest } from "../../../lib/api/common"
import { _constructHeaders, constructResponse, } from "../../../lib/api/http"
import { list_users, add_user, remove_user } from "../../../lib/api/access_iam_mgmt"
import { auth_check } from "../../../lib/public/authservice"
import { createUser, removeUser } from "../../../lib/public/usermgmt"

/**
 * GET /api/v1/identity
 * Returns a list of emails of users in the Access policy
 * 
 * Permissions required: one of (*admin*, user_addition)
 * 
 * Meta: none
 * Body: none
 * 
 * @param {APIContext} context - the Astro API context
 * @returns {Response} a Response object with payload of string[] of user emails
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    // returns a JSON of string[] containing emails
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [ "user_addition" ])
    if (auth_response !== null) {
        return auth_response
    }
    // perform requested operation
    const result = await list_users()
    return constructResponse(request, result, 200)
}
/**
 * POST /api/v1/identity
 * Adds an authenticated user to Cloudflare Access for the provided email
 * 
 * Permissions required: one of (*admin*, user_addition)
 * 
 * Meta: optional
 * Meta fields:
 *  - autoenrollment: {boolean} Specifies whether to automatically create a contributor record to bypass self-enrollment flow
 *  - confer: {boolean or null} If autoenrollment is true, specifies whether to confer acting identity's conferrable permissions
 *  - name: {string or null} If autoenrollment is true, specifies the name to use for the created contributor record; if not provided when required, call fails
 *  - major: {string or null} If autoenrollment is true, specifies the major to use for the created contributor record; if not provided when required, call fails
 *  - class_year: {number or null} If autoenrollment is true, specifies the class year to use for the created contributor record; if not provided when required, call fails
 * 
 * Body: required, JSON array of [email_to_add: string]
 * 
 * @param {APIContext} context - the Astro API context
 * @returns {Response} a Response object
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    // accepts an API request payload as a list containing the one email to add
    const { params, request, locals } = context
    const auth_response = auth_check(request, locals.identity, [ "user_addition" ])
    if (auth_response !== null) {
        return auth_response
    }
    const api_request = await parseAPIRequest(request, ["autoenrollment", "confer", "name", "major", "class_year"])
    // the autoenrollment flag sets whether to automatically create a contributor record
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, `Bad request: ${api_request.message}`)
    }
    if (api_request.payload === null || api_request.payload.length !== 1 || typeof api_request.payload[0] !== "string") {
        return constructResponse(request, null, 400, "Bad request: payload must be a list containing exactly one email string")
    }
    if (api_request.meta?.autoenrollment === true) {
        if (typeof api_request.meta?.confer !== "boolean" || typeof api_request.meta?.name !== "string" || typeof api_request.meta?.major !== "string" || typeof api_request.meta?.class_year !== "number") {
            return constructResponse(request, null, 400, "Bad request: missing or invalid meta fields for autoenrollment")
        }
        await createUser(context.locals.cfContext, locals.identity!, api_request.meta?.confer, api_request.payload[0], api_request.meta?.name, api_request.meta?.major, api_request.meta?.class_year)
        return constructResponse(request, null, 201)
    } else {
        const email = api_request.payload[0]
        await add_user(email)
        return constructResponse(request, null, 201)
    }
}

/**
 * DELETE /api/v1/identity
 * Removes a user from Cloudflare Access for the provided email
 * 
 * Permissions required: one of (*admin*, user_addition)
 * 
 * Meta: optional
 * Meta fields:
 *  - autodeactivation: {boolean} Specifies whether to automatically deactivate the contributor record; defaults to true
 */
export const DELETE: APIRoute = async (context): Promise<Response> => {
    // accepts an API request payload as a list containing the one email to remove
    const { params, request, locals } = context
    const auth_response = auth_check(request, locals.identity, [ "user_addition" ])
    if (auth_response !== null) {
        return auth_response
    }
    const api_request = await parseAPIRequest(request, []) // autodeactivation is optional, defaults to true
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, `Bad request: ${api_request.message}`)
    }
    if (api_request.payload === null || api_request.payload.length !== 1 || typeof api_request.payload[0] !== "string") {
        return constructResponse(request, null, 400, "Bad request: payload must be a list containing exactly one email string")
    }
    if (api_request.meta?.autodeactivation === true || api_request.meta?.autodeactivation === undefined) {
        // from lib/public/usermgmt.ts, deactivates contributor record
        await removeUser(context.locals.cfContext, api_request.payload[0])
    } else {
        // from lib/api/access_iam_mgmt.ts, removes user from Access policy without changing contributor record
        await remove_user(api_request.payload[0])
    }
    return constructResponse(request, null, 200)
}