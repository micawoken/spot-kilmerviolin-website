/**
 * /api/v1/contributors/[id]
 * 
 * Manages specific contributor records
 * 
 */

import type { APIRoute } from "astro"
import { formatContribFromD1, parseAPIRequest } from "../../../../lib/api/common"
import { _constructHeaders, constructResponse, constructResponseErrorHook } from "../../../../lib/api/http"
import { auth_check } from "../../../../lib/public/authservice"
import { addContributor, deleteContributor, listContributors, updateContributor, updateContributorPartial } from "../../../../lib/api/database"
import { getRecord, _stateTypeAssertCompleteContributor, CONTRIBUTOR, _stateTypeAssertPartialContributor } from "../../../../lib/api/d1"
import { env } from "cloudflare:workers"

/**
 * GET /api/v1/contributors/[id]
 * Returns the contributor record for the specified contributor ID
 * If self, it returns the full record, if not self, it returns non-protected properties only unless elevation is requested
 * 
 * Permissions required: none; *admin* to access protected properties
 * 
 * Meta: optional
 * Meta fields:
 *  - escalate: {boolean} if true, and the user is an admin, disable the safe property check for non-self contributors; defaults to false
 * 
 * Body: none
 * @param {APIContext} context - the Astro API context
 * @returns {Response} a Response object with payload of the contributor record, filtered based on permissions and elevation request
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false) // fail open is set
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request 
    const api_request = await parseAPIRequest(request, []) // escalate is optional, defaults to false
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    // validate identity exists
    const state_id = Number(params.id)
    if (isNaN(state_id)) {
        return constructResponse(request, null, 400, "Invalid contributor ID: must be a number")
    }
    try {
        const d1_result = await getRecord(CONTRIBUTOR, state_id)
        if (d1_result.results.length === 0) {
            return constructResponse(request, null, 404)
        }
        const d1_record = d1_result.results[0] as D1Contributor
        // convert the record type
        const record = formatContribFromD1(d1_record)

        const auth_enabled: boolean = env.AUTH_ENABLED || import.meta.env.PROD
        // validate self identity
        if (locals.identity?.id !== state_id && !(api_request.meta?.escalate === true && locals.identity?.admin) && auth_enabled) {
            // identity is not self, and either escalate is false or user is not admin
            // filter out protected properties from the record before returning
            const filtered_record = Object.fromEntries(Object.entries(record).filter(([key]) => !CONTRIBUTOR.protected!.includes(key)))
            return constructResponse(request, filtered_record, 200)
        }
        // return full record
        return constructResponse(request, record, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 404)
    }
}

/**
 * PUT /api/v1/contributors/[id]
 * Updates the complete contributor record for the specified contributor ID
 * If the contributor ID does not exist, the endpoint returns 409 Conflict
 * 
 * Permissions required: *admin*
 * (User modifications should use PATCH, as PUT modifies all fields, including security-relevant ones)
 * 
 * Meta: none
 * Body: required, JSON object of complete contributor record with updated fields
 * 
 * @param {APIContext} context - the Astro API context
 * @returns {Response} a Response object
 */
export const PUT: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], true)
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request
    const api_request = await parseAPIRequest(request)
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    // check if the payload is not null and has a length of 1
    if (api_request.payload === null || !Array.isArray(api_request.payload) || api_request.payload.length !== 1) {
        return constructResponse(request, null, 400, "Invalid request body: must be an array with a single item")
    }
    // validate request body as complete contributor record
    const record = _stateTypeAssertCompleteContributor(api_request.payload[0], false)
    if (typeof record === "string") {
        return constructResponse(request, null, 400, `Invalid request body: ${record}`)
    }
    // check that the specified contributor ID exists
    const state_id = Number(params.id)
    if (isNaN(state_id)) {
        return constructResponse(request, null, 400, "Invalid contributor ID: must be a number")
    }
    try {
        await updateContributor(context.locals.cfContext, state_id, record)
        return constructResponse(request, null, 204)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Failed to update contributor")
    }
}

/**
 * PATCH /api/v1/contributors/[id]
 * Partially updates fields of the contributor record for the specified contributor ID
 * 
 * Permissions required: *admin*, or none if self
 * 
 * Meta: optional
 * Meta fields:
 *  - escalate: {boolean} if true, and the user is an admin, disable the safe property check and disable row-level security for this request
 * 
 * Body: required, JSON object of partial contributor record with fields to update; must include the id field and value must match the ID in the URL
 * @param {APIContext} context - the Astro API context
 * @returns {Response} a Response object
 */
export const PATCH: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false, "selfmgmt") // fail open is set
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request
    const api_request = await parseAPIRequest(request, []) // escalate is optional, defaults to false
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    // check if the payload is not null and has a length of 1
    if (api_request.payload === null || !Array.isArray(api_request.payload) || api_request.payload.length !== 1) {
        return constructResponse(request, null, 400, "Invalid request body: must be an array with a single item")
    }
    // validate identity exists
    const state_id = Number(params.id)
    if (isNaN(state_id)) {
        return constructResponse(request, null, 400, "Invalid contributor ID: must be a number")
    }
    try {
        const d1_record = await getRecord(CONTRIBUTOR, state_id)
        const auth_enabled: boolean = env.AUTH_ENABLED || import.meta.env.PROD
        if (d1_record.results.length === 0) {
            return constructResponse(request, null, 404)
        }
        // validate self identity
        console.log(locals.identity?.id !== state_id, !(api_request.meta?.escalate === true && locals.identity?.admin), auth_enabled)
        if (locals.identity?.id !== state_id && !(api_request.meta?.escalate === true && locals.identity?.admin) && auth_enabled) {
            // identity is not self, and either escalate is false or user is not admin
            return constructResponse(request, null, 403)
        }
        
        // validate request body as partial contributor record
        console.log(api_request.payload[0])
        const record = _stateTypeAssertPartialContributor(api_request.payload[0], false)
        if (typeof record === "string") {
            return constructResponse(request, null, 400, `Invalid request body: ${record}`)
        }
        console.log("record: ", record)
        // validate that properties are safe
        if (CONTRIBUTOR.protected!.some(prop => prop in record) && !(api_request.meta?.escalate === true && locals.identity?.admin) && auth_enabled) {
            // record includes protected properties, and either escalate is false or user is not admin
            return constructResponse(request, null, 403, "Request includes protected properties that require escalate permission")
        }
        // perform update
        await updateContributorPartial(context.locals.cfContext, state_id, record)
        return constructResponse(request, null, 204)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Failed to update contributor")
    }
}

/**
 * DELETE /api/v1/contributors/[id]
 * Deletes the contributor record for the specified contributor ID
 * 
 * Permissions required: *admin*
 * 
 * Meta: none
 * Body: none
 * 
 * @param {APIContext} context - the Astro API context
 * @returns {Response} a Response object
 */
export const DELETE: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], true)
    if (auth_response !== null) {
        return auth_response
    }
    // validate identity exists
    const state_id = Number(params.id)
    if (isNaN(state_id)) {
        return constructResponse(request, null, 400, "Invalid contributor ID: must be a number")
    }
    // check if self
    if (locals.identity?.id === state_id) {
        return constructResponse(request, null, 403, "Self-deletion is not implemented")
    }
    // the delete operation will succeed even if the record doesn't exist, so don't need to verify existence to ensure idempotency
    try {
        await deleteContributor(context.locals.cfContext, state_id)
        return constructResponse(request, null, 204)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Failed to delete contributor")
    }
}