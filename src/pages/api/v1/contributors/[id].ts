/**
 * /api/v1/contributors/[id]
 *
 * Manages specific contributor records
 *
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
 *
 * This license is also subject to additional terms as specified in the README.md.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
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
    deleteContributor,
    getContributor,
    updateContributor,
    updateContributorPartial
} from "../../../../lib/api/database"
import {
    _stateTypeAssertCompleteContributor,
    CONTRIBUTOR,
    _stateTypeAssertPartialContributor,
    redactProtected
} from "../../../../lib/api/d1"
import { authEnabled } from "../../../../lib/api/environment"
import { generateFallbackEmail, resolveIdentityEmail } from "../../../../lib/api/fallback"
import { extractUploadedFileKey, getFileMeta } from "../../../../lib/api/files"

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
        // read through the cached whole-table layer (database.ts) rather than a direct D1 row read;
        // contributor writes invalidate this cache, so the served record is current. getContributor
        // already returns the API record shape, so no formatContribFromD1 conversion is needed.
        const record = await getContributor(context.locals.cfContext, CONTRIBUTOR.primary_key, state_id.toString())
        if (record === null) {
            return constructResponse(request, null, 404)
        }

        // change_date carries the record's last-modified time; surface it as the Last-Modified header
        // (change_date is not a protected property, so it survives the redaction below)
        const last_modified = lastModifiedHeader(record)
        const auth_enabled: boolean = authEnabled(request)
        // validate self identity
        if (
            locals.identity?.id !== state_id &&
            !(api_request.meta?.elevate === true && locals.identity?.admin) &&
            auth_enabled
        ) {
            // identity is not self, and either elevate is false or user is not admin
            // filter out protected properties from the record before returning
            const filtered_record = redactProtected(CONTRIBUTOR, record)
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
 *
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
        // read the current record through the cached whole-table layer (writes invalidate it, so it is
        // current); used only for existence and the fallback-email name slug below, neither of which gates
        // authorization (that is driven by locals.identity)
        const existing_record = await getContributor(
            context.locals.cfContext,
            CONTRIBUTOR.primary_key,
            state_id.toString()
        )
        const auth_enabled: boolean = authEnabled(request)
        if (existing_record === null) {
            return constructResponse(request, null, 404)
        }
        // validate self identity
        if (
            locals.identity?.id !== state_id &&
            !(api_request.meta?.elevate === true && locals.identity?.admin) &&
            auth_enabled
        ) {
            // identity is not self, and either elevate is false or user is not admin
            return constructResponse(request, null, 403)
        }

        // an explicitly blanked identity_email is replaced with a generated fallback address so the
        // record keeps a valid (NOT NULL UNIQUE) sign-in email (see lib/api/fallback.ts). The slug is
        // drawn from the name in this update if present, else the existing record's name. identity_email
        // is a protected property, so this edit is still gated by the elevation check below.
        const raw = api_request.payload[0]
        if (
            raw !== null &&
            typeof raw === "object" &&
            "identity_email" in raw &&
            (raw.identity_email === null || raw.identity_email === "")
        ) {
            const slug_name = typeof raw.name === "string" && raw.name.trim() !== "" ? raw.name : existing_record.name
            raw.identity_email = generateFallbackEmail(slug_name)
        }
        // validate request body as partial contributor record
        const record = _stateTypeAssertPartialContributor(raw, false)
        if (typeof record === "string") {
            return constructResponse(request, null, 400, `Invalid request body: ${record}`)
        }
        const is_elevated_admin = api_request.meta?.elevate === true && locals.identity?.admin === true

        // validate that properties are safe
        if (CONTRIBUTOR.protected!.some((prop) => prop in record) && !is_elevated_admin && auth_enabled) {
            // record includes protected properties, and either elevate is false or user is not admin
            return constructResponse(
                request,
                null,
                403,
                "Request includes protected properties that require elevate permission"
            )
        }
        // a non-admin setting their own image to an uploaded file may only reference a file they uploaded
        // themselves (portraits are personal). Bundled assets (/files/<name>) and external URLs are not
        // uploaded files, so extractUploadedFileKey returns null for them and they are unaffected. Admins
        // bypass RLS and may attach any file to any contributor, so this guard does not apply to them.
        if (auth_enabled && !locals.identity?.admin && "image" in record && typeof record.image === "string") {
            const file_key = extractUploadedFileKey(record.image)
            if (file_key !== null) {
                const meta = await getFileMeta(context.locals.cfContext, file_key)
                if (meta?.uploader !== String(locals.identity?.id)) {
                    return constructResponse(request, null, 403, "The referenced file was not uploaded by you")
                }
            }
        }
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
