/**
 * pages/api/v1/composers.ts
 *
 * Returns a list of composer records
 *
 */

import type { APIRoute } from "astro"
import { _stateTypeAssertCompleteComposer } from "../../../lib/api/d1"
import { addComposer, listComposers } from "../../../lib/api/database"
import { auth_check } from "../../../lib/public/authservice"
import { parseAPIRequest } from "../../../lib/api/common"
import { constructResponse, constructResponseErrorHook, lastModifiedHeader } from "../../../lib/api/http"

/**
 * GET /api/v1/composers
 * Returns a list of composer IDs, or a list of composer records if the "full" query parameter is set to true
 *
 * Permissions required: none
 *
 * Meta: optional
 * Meta fields:
 * - full: {boolean} if true, returns full composer records; if false or not provided, returns only composer IDs
 *
 * Body: none
 *
 * @param context - the Astro API context
 * @return either a list of IDs or the full records
 *
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request
    const api_request = await parseAPIRequest(request, [])
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    try {
        const data = await listComposers(context.locals.cfContext)
        if (data === null) {
            return constructResponse(request, null, 500, "Unknown state: list composer operation returned null")
        }
        // the latest change_date across the listed records is the collection's last-modified time
        const last_modified = lastModifiedHeader(data)
        switch (api_request.meta?.full) {
            case true:
                // return full composer records
                return constructResponse(request, data, 200, undefined, last_modified)
            case false:
            case undefined:
                // return composer IDs only
                const ids = data.map((record) => record.id)
                return constructResponse(request, ids, 200, undefined, last_modified)
            default:
                return constructResponse(request, null, 400, "Invalid value for meta field 'full': must be a boolean")
        }
    } catch (error) {
        console.error("Error in GET /api/v1/composers:", error)
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}

/**
 * POST /api/v1/composers
 * Adds a new composer record, returning the location
 *
 * Permissions required: none
 *
 * Meta: none
 * Body: required, Composer[] single item
 *
 * @param context - the Astro API context
 * @return a Response object with the ID of the new record, or an error
 *
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
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
    // validate the payload as a complete composer record
    const record: Composer | string = _stateTypeAssertCompleteComposer(api_request.payload[0], false)
    if (typeof record === "string") {
        return constructResponse(request, null, 400, `Invalid request body: ${record}`)
    }
    try {
        const new_id = await addComposer(context.locals.cfContext, record)
        return constructResponse(request, null, 201, undefined, {
            Location: `/api/v1/composers/${new_id}`
        })
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Error adding composer record")
    }
}
