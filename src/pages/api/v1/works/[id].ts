/**
 * /pages/api/v1/works/[id].ts
 *
 * Manages specific work records
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
import { parseAPIRequest } from "../../../../lib/api/common"
import {
    _constructHeaders,
    constructResponse,
    constructResponseErrorHook,
    lastModifiedHeader
} from "../../../../lib/api/http"
import { auth_check } from "../../../../lib/public/authservice"
import {
    attachCompositionNames,
    deleteComposition,
    getComposition,
    updateComposition,
    updateCompositionPartial
} from "../../../../lib/api/database"
import { _stateTypeAssertCompleteComposition, _stateTypeAssertPartialComposition } from "../../../../lib/api/d1"
import { canAct, canModify, withActingContributor } from "../../../../lib/api/authorize"
import { authEnabled } from "../../../../lib/api/environment"

/**
 * GET /api/v1/works/[id]
 * Returns the composition record for the specified ID
 *
 * Permissions required: none
 *
 * Meta: optional
 * Meta fields:
 *  - names: {boolean} if true, the record is returned as a CompositionWithNames object ({ object, names })
 *    with the referenced composer and contributor names resolved; off by default
 *
 * Body: none
 *
 * @param context - the Astro API context
 * @returns a Response object with payload of the composition record
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false) // fail open is set
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request; meta is optional and only the "names" field is honored
    const api_request = await parseAPIRequest(request, [])
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    const names_flag = api_request.meta?.names
    if (names_flag !== undefined && typeof names_flag !== "boolean") {
        return constructResponse(request, null, 400, "Invalid value for meta field 'names': must be a boolean")
    }
    const state_id = Number(params.id)
    if (isNaN(state_id)) {
        return constructResponse(request, null, 400, "Invalid composition ID: must be a number")
    }
    try {
        const d1_record = await getComposition(context.locals.cfContext, "composition_id", state_id.toString())
        if (d1_record === null) {
            return constructResponse(request, null, 404)
        }
        // change_date carries the record's last-modified time; surface it as the Last-Modified header
        const last_modified = lastModifiedHeader(d1_record)
        // optionally pair the record with its resolved composer names
        if (names_flag === true) {
            const [enhanced] = await attachCompositionNames(context.locals.cfContext, [d1_record])
            return constructResponse(request, enhanced, 200, undefined, last_modified)
        }
        return constructResponse(request, d1_record, 200, undefined, last_modified)
    } catch (error) {
        return constructResponseErrorHook(request, error, 404)
    }
}

/**
 * PUT /api/v1/works/[id]
 * Fully update the composition representation for the specified ID
 *
 * Permissions required: none, or *admin* if not noted as contributor
 *
 * Meta: optional
 * Meta fields:
 *  - elevate: {boolean} if true, allows consideration of admin status when reviewing contributor lockout
 *  - direct_contrib: {boolean} if true, the caller is managing contributors directly; the editor is not auto-added to contrib_addl
 *
 * Body: required, shape of Composition
 *
 * @param context - the Astro API context
 * @returns a Response object with payload of the updated composition record
 */
export const PUT: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false) // fail open is set
    // exact authorization will be reviewed later
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request
    const api_request = await parseAPIRequest(request, []) // meta is optional; parse it so the "elevate" field is honored
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    // check if the payload is not null and has a length of 1
    if (api_request.payload === null || !Array.isArray(api_request.payload) || api_request.payload.length !== 1) {
        return constructResponse(request, null, 400, "Invalid request body: must be an array with a single item")
    }
    // validate body as complete composition record
    const record: Composition | string = _stateTypeAssertCompleteComposition(api_request.payload[0], false)
    if (typeof record === "string") {
        return constructResponse(request, null, 400, `Invalid request body: ${record}`)
    }
    // validate authorization
    const auth_enabled = authEnabled(request)
    try {
        const current_record = await getComposition(context.locals.cfContext, "composition_id", params.id!)
        if (current_record === null) {
            return constructResponse(request, null, 500, "Unknown state: get composition operation returned null")
        }
        // verify acting identity is authorized to modify
        if (auth_enabled) {
            if (!canModify(current_record, locals.identity!, api_request.meta?.elevate === true)) {
                return constructResponse(
                    request,
                    null,
                    403,
                    "Forbidden: user is not a primary contributor on this object"
                )
            }
            // verify acting identity is authorized to apply proposed update
            if (!canAct(current_record, record, locals.identity!, api_request.meta?.elevate === true)) {
                return constructResponse(
                    request,
                    null,
                    403,
                    "Forbidden: user is not authorized to apply the proposed changes to this object"
                )
            }
        }
        // record the editor as an additional contributor unless they are managing contributors directly
        if (api_request.meta?.direct_contrib !== true) {
            const merged = withActingContributor(current_record, record, locals.identity!)
            if (merged !== null) {
                record.contrib_addl = merged
            }
        }
        // perform update
        await updateComposition(context.locals.cfContext, Number(params.id), record)
        return constructResponse(request, null, 204)
    } catch (error) {
        console.error(error)
        return constructResponseErrorHook(request, error, 404)
    }
}

/**
 * PATCH /api/v1/works/[id]
 * Partially update the composition representation for the specified ID
 *
 * Permissions required: none, or *admin* if not noted as contributor
 *
 * Meta: optional
 * Meta fields:
 * - elevate: {boolean} if true, allows consideration of admin status when reviewing contributor lockout
 * - direct_contrib: {boolean} if true, the caller is managing contributors directly; the editor is not auto-added to contrib_addl
 *
 * Body: required, shape of Partial<Composition>
 *
 * @param context - the Astro API context
 * @returns a Response object with payload of the updated composition record
 */
export const PATCH: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false) // fail open is set
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request
    const api_request = await parseAPIRequest(request, []) // meta is optional; parse it so the "elevate" field is honored
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    // check if the payload is not null and has a length of 1
    if (api_request.payload === null || !Array.isArray(api_request.payload) || api_request.payload.length !== 1) {
        return constructResponse(request, null, 400, "Invalid request body: must be an array with a single item")
    }
    // validate body as partial composition record
    const record: Partial<Composition> | string = _stateTypeAssertPartialComposition(api_request.payload[0], false)
    if (typeof record === "string") {
        return constructResponse(request, null, 400, `Invalid request body: ${record}`)
    }
    // validate authorization
    const auth_enabled = authEnabled(request)
    try {
        const current_record = await getComposition(context.locals.cfContext, "composition_id", params.id!)
        if (current_record === null) {
            return constructResponse(request, null, 500, "Unknown state: get composition operation returned null")
        }
        if (auth_enabled) {
            if (!canModify(current_record, locals.identity!, api_request.meta?.elevate === true)) {
                return constructResponse(
                    request,
                    null,
                    403,
                    "Forbidden: user is not a primary contributor on this object"
                )
            }
            if (!canAct(current_record, record, locals.identity!, api_request.meta?.elevate === true)) {
                return constructResponse(
                    request,
                    null,
                    403,
                    "Forbidden: user is not authorized to apply the proposed changes to this object"
                )
            }
        }
        // record the editor as an additional contributor unless they are managing contributors directly
        if (api_request.meta?.direct_contrib !== true) {
            const merged = withActingContributor(current_record, record, locals.identity!)
            if (merged !== null) {
                record.contrib_addl = merged
            }
        }
        // perform update
        await updateCompositionPartial(context.locals.cfContext, Number(params.id), record)
        return constructResponse(request, null, 204)
    } catch (error) {
        console.error(error)
        return constructResponseErrorHook(request, error, 404)
    }
}

/**
 * DELETE /api/v1/works/[id]
 * Deletes the composition record for the specified ID
 *
 * Permissions required: none, or *admin* if not noted as contributor
 *
 * Meta: optional
 * Meta fields:
 *  - elevate: {boolean} if true, allows consideration of admin status when reviewing contributor lockout
 *
 * Body: none
 *
 * @param context - the Astro API context
 * @returns a Response object with no payload
 */
export const DELETE: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false) // fail open is set
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request
    const api_request = await parseAPIRequest(request, []) // meta is optional; parse it so the "elevate" field is honored
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    // validate authorization
    const auth_enabled = authEnabled(request)
    try {
        const current_record = await getComposition(context.locals.cfContext, "composition_id", params.id!)
        if (current_record === null) {
            return constructResponse(request, null, 500, "Unknown state: get composition operation returned null")
        }
        if (auth_enabled) {
            if (!canModify(current_record, locals.identity!, api_request.meta?.elevate === true)) {
                return constructResponse(
                    request,
                    null,
                    403,
                    "Forbidden: user is not a primary contributor on this object"
                )
            }
        }
        // perform delete
        await deleteComposition(context.locals.cfContext, Number(params.id))
        return constructResponse(request, null, 204)
    } catch (error) {
        console.error(error)
        return constructResponseErrorHook(request, error, 404)
    }
}
