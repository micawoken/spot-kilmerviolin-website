/**
 * /pages/api/v1/works.ts
 * 
 * List and create work entries
 * 
 */

import type { APIRoute } from "astro"
import { _stateTypeAssertCompleteComposition } from "../../../lib/api/d1"
import { addComposition, listCompositions } from "../../../lib/api/database"
import { auth_check } from "../../../lib/public/authservice"
import { parseAPIRequest } from "../../../lib/api/common"
import { constructResponse, constructResponseErrorHook } from "../../../lib/api/http"

/**
 * GET /api/v1/works
 * Returns a list of work IDs, or a list of work records if the "full" meta param is set to true
 * 
 * Permissions required: none
 * 
 * Meta: optional
 * Meta fields:
 * - full: {boolean} if true, returns full work records; if false or not provided, returns only work IDs
 * 
 * Body: none
 * 
 * @param {APIContext} context - the Astro API context
 * @returns {Response} either a list of IDs or the full records
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request
    const api_request = await parseAPIRequest(request, ["full"])
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    try {
        const data = await listCompositions(context.locals.cfContext)
        if (data === null) {
            return constructResponse(request, null, 500, "Unknown state: list composition operation returned null")
        }
        switch (api_request.meta?.full) {
            case true:
                // return full composition records
                return constructResponse(request, data, 200)
            case false:
            case undefined:
                // return composition IDs only
                const ids = data.map(record => record.id)
                return constructResponse(request, ids, 200)
            default:
                return constructResponse(request, null, 400, "Invalid value for meta field 'full': must be a boolean")
        }
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}

/**
 * POST /api/v1/works
 * Creates a new work record with the provided data
 * 
 * Permissions required: none
 * 
 * Meta: none
 * Body: required; shape of a Composition object
 * 
 * @param {APIContext} context - the Astro API context
 * @returns {Response} the created record, or an error message
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
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
    // validate body as complete composition record
    const record = _stateTypeAssertCompleteComposition(api_request.payload[0], false)
    if (typeof record === "string") {
        return constructResponse(request, null, 400, `Invalid request body: ${record}`)
    }
    try {
        const add_response = await addComposition(context.locals.cfContext, record)
        return constructResponse(request, add_response, 201, undefined, {
            Location: `/api/v1/works/${add_response.toString()}`
        })
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}