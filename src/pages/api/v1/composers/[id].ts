/**
 * /pages/api/v1/composers/[id].ts
 *
 * Manipulates specific composer records
 *
 */

import type { APIRoute } from "astro"
import { parseAPIRequest } from "../../../../lib/api/common"
import {
    _constructHeaders,
    constructResponse,
    constructResponseErrorHook,
    lastModifiedHeader
} from "../../../../lib/api/http"
import { auth_check } from "../../../../lib/public/authservice"
import { _stateTypeAssertCompleteComposer, _stateTypeAssertPartialComposer } from "../../../../lib/api/d1"
import { deleteComposer, getComposer, updateComposer, updateComposerPartial } from "../../../../lib/api/database"

/**
 * GET /api/v1/composers/[id]
 * Returns the composer record for the specified composer ID
 *
 * Permissions required: none
 *
 * Meta: none
 * Body: none
 *
 * @param context - the Astro API context
 * @returns a Response object with the composer record if found
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false) // fail open is set
    if (auth_response !== null) {
        return auth_response
    }
    // no api parsing required since there is no meta or body
    // validate composer ID
    const state_id = Number(params.id)
    if (isNaN(state_id)) {
        return constructResponse(request, null, 400, "Invalid composer ID: must be a number")
    }
    try {
        const d1_record = await getComposer(context.locals.cfContext, "composer_id", state_id.toString())
        if (d1_record === null) {
            return constructResponse(request, null, 404)
        }
        // change_date carries the record's last-modified time; surface it as the Last-Modified header
        return constructResponse(request, d1_record, 200, undefined, lastModifiedHeader(d1_record))
    } catch (error) {
        console.error(error)
        return constructResponseErrorHook(request, error, 404)
    }
}

/**
 * PUT /api/v1/composers/[id]
 * Update the full composer representation
 *
 * Permissions required: none
 *
 * Meta: none
 * Body: required, complete Composer object
 *
 * @param context - the Astro API context
 * @returns a Response object with status of the update operation
 */
export const PUT: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false) // fail open is set
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
    // validate body as complete composer record
    const record: Composer | string = _stateTypeAssertCompleteComposer(api_request.payload[0], false)
    if (typeof record === "string") {
        return constructResponse(request, null, 400, `Invalid request body: ${record}`)
    }
    // validate composer ID
    const state_id = Number(params.id)
    if (isNaN(state_id)) {
        return constructResponse(request, null, 400, "Invalid composer ID: must be a number")
    }
    // skipping existence check since operation will fail silently (no rows matched)
    try {
        await updateComposer(context.locals.cfContext, state_id, record)
        return constructResponse(request, null, 204)
    } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        return constructResponseErrorHook(request, error, 500, "Failed to update composer")
    }
}

/**
 * PATCH /api/v1/composers/[id]
 * Update a composer record with a partial representation; only provided properties will be updated
 *
 * Permissions required: none
 *
 * Meta: none
 * Body: required, partial Composer object
 *
 * @param context - the Astro API context
 * @returns a Response object with status of the update operation
 */
export const PATCH: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false) // fail open is set
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
    // validate body as partial composer record
    const record: Partial<Composer> | string = _stateTypeAssertPartialComposer(api_request.payload[0], false)
    if (typeof record === "string") {
        return constructResponse(request, null, 400, `Invalid request body: ${record}`)
    }
    // perform update
    const state_id = Number(params.id)
    if (isNaN(state_id)) {
        return constructResponse(request, null, 400, "Invalid composer ID: must be a number")
    }
    try {
        await updateComposerPartial(context.locals.cfContext, state_id, record)
        return constructResponse(request, null, 204)
    } catch (error) {
        console.error(error)
        return constructResponseErrorHook(request, error, 500, "Failed to update composer")
    }
}

/**
 * DELETE /api/v1/composers/[id]
 * Deletes the composer record with the specified ID
 *
 * Permissions required: none
 *
 * Meta: none
 * Body: none
 *
 * Note: composer IDs and names are used as foreign keys in composition records; attempting
 * to delete a composer record referenced by at least one composition record will fail
 *
 * @param context - the Astro API context
 * @returns a Response object with status of the delete operation
 */
export const DELETE: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false) // fail open is set
    if (auth_response !== null) {
        return auth_response
    }
    // validate composer ID
    const state_id = Number(params.id)
    if (isNaN(state_id)) {
        return constructResponse(request, null, 400, "Invalid composer ID: must be a number")
    }
    // skipping existence check since operation will fail silently (no rows matched)
    try {
        await deleteComposer(context.locals.cfContext, state_id)
        return constructResponse(request, null, 204)
    } catch (error) {
        return constructResponseErrorHook(
            request,
            error,
            409,
            "Operation failed; verify the composer record is not used by any composition"
        )
    }
}
