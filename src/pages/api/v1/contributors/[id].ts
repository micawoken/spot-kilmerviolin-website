/**
 * /api/v1/contributors/[id]
 * 
 * Manages specific contributor records
 * 
 */

import type { APIRoute } from "astro"
import { formatContribFromD1, parseAPIRequest } from "../../../../lib/api/common"
import { _constructHeaders, constructResponse, constructResponseErrorHook, lastModifiedHeader } from "../../../../lib/api/http"
import { auth_check } from "../../../../lib/public/authservice"
import { deleteContributor, updateContributor, updateContributorPartial } from "../../../../lib/api/database"
import { getRecord, _stateTypeAssertCompleteContributor, CONTRIBUTOR, _stateTypeAssertPartialContributor } from "../../../../lib/api/d1"
import { authEnabled } from "../../../../lib/api/environment"
import { generateFallbackEmail, resolveIdentityEmail } from "../../../../lib/api/fallback"

/**
 * GET /api/v1/contributors/[id]
 * Returns the contributor record for the specified contributor ID
 * If self, it returns the full record, if not self, it returns non-protected properties only unless elevation is requested
 * 
 * Permissions required: none; *admin* to access protected properties
 * 
 * Meta: optional
 * Meta fields:
 *  - elevate: {boolean} if true, and the user is an admin, disable the safe property check for non-self contributors; defaults to false
 * 
 * Body: none
 * @param context - the Astro API context
 * @returns a Response object with payload of the contributor record, filtered based on permissions and elevation request
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false) // fail open is set
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request 
    const api_request = await parseAPIRequest(request, []) // elevate is optional, defaults to false
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

        // change_date carries the record's last-modified time; surface it as the Last-Modified header
        // (change_date is not a protected property, so it survives the redaction below)
        const last_modified = lastModifiedHeader(record)
        const auth_enabled: boolean = authEnabled(request)
        // validate self identity
        if (locals.identity?.id !== state_id && !(api_request.meta?.elevate === true && locals.identity?.admin) && auth_enabled) {
            // identity is not self, and either elevate is false or user is not admin
            // filter out protected properties from the record before returning
            const filtered_record = Object.fromEntries(Object.entries(record).filter(([key]) => !CONTRIBUTOR.protected!.includes(key)))
            return constructResponse(request, filtered_record, 200, undefined, last_modified)
        }
        // return full record
        return constructResponse(request, record, 200, undefined, last_modified)
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
 * @param context - the Astro API context
 * @returns a Response object
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
    // a blank/omitted identity_email is replaced with a generated fallback address (see lib/api/fallback.ts)
    // so the record still satisfies the identity_email NOT NULL UNIQUE constraint
    const raw = api_request.payload[0]
    if (raw !== null && typeof raw === "object" && typeof raw.name === "string") {
        raw.identity_email = resolveIdentityEmail(raw.identity_email, raw.name)
    }
    // validate request body as complete contributor record
    const record = _stateTypeAssertCompleteContributor(raw, false)
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
 *  - elevate: {boolean} if true, and the user is an admin, disable the safe property check and disable row-level security for this request
 * 
 * Body: required, JSON object of partial contributor record with fields to update; must include the id field and value must match the ID in the URL
 * @param context - the Astro API context
 * @returns a Response object
 */
export const PATCH: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false, "selfmgmt") // fail open is set
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request
    const api_request = await parseAPIRequest(request, []) // elevate is optional, defaults to false
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
        const auth_enabled: boolean = authEnabled(request)
        if (d1_record.results.length === 0) {
            return constructResponse(request, null, 404)
        }
        // validate self identity
        if (locals.identity?.id !== state_id && !(api_request.meta?.elevate === true && locals.identity?.admin) && auth_enabled) {
            // identity is not self, and either elevate is false or user is not admin
            return constructResponse(request, null, 403)
        }
        
        // an explicitly blanked identity_email is replaced with a generated fallback address so the
        // record keeps a valid (NOT NULL UNIQUE) sign-in email (see lib/api/fallback.ts). The slug is
        // drawn from the name in this update if present, else the existing record's name. identity_email
        // is a protected property, so this edit is still gated by the elevation check below.
        const raw = api_request.payload[0]
        if (raw !== null && typeof raw === "object" && "identity_email" in raw && (raw.identity_email === null || raw.identity_email === "")) {
            const existing = d1_record.results[0] as D1Contributor
            const slug_name = typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name : existing.name
            raw.identity_email = generateFallbackEmail(slug_name)
        }
        // validate request body as partial contributor record
        const record = _stateTypeAssertPartialContributor(raw, false)
        if (typeof record === "string") {
            return constructResponse(request, null, 400, `Invalid request body: ${record}`)
        }
        // validate that properties are safe
        if (CONTRIBUTOR.protected!.some(prop => prop in record) && !(api_request.meta?.elevate === true && locals.identity?.admin) && auth_enabled) {
            // record includes protected properties, and either elevate is false or user is not admin
            return constructResponse(request, null, 403, "Request includes protected properties that require elevate permission")
        }
        // perform update; protected properties have already been gated by the elevate + admin check above,
        // so authorize the data layer to write them (allowProtected)
        await updateContributorPartial(context.locals.cfContext, state_id, record, true)
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
 * @param context - the Astro API context
 * @returns a Response object
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