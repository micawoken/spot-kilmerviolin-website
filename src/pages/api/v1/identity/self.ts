/**
 * pages/api/v1/identity/self.ts
 *
 * Provides endpoints related to self-identity management, including identity info, self-enrollment, and other features
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
import { auth_check } from "../../../../lib/public/authservice"
import { constructResponse, constructResponseErrorHook } from "../../../../lib/api/http"
import { finishUser, changeLoginEmail, deactivateUser } from "../../../../lib/public/usermgmt"
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
 * @param context - the Astro API context
 * @returns a Response object containing the Identity object
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
 * @param context - the Astro API context
 * @returns a Response object containing the contributor ID if enrollment is successful, or an error message if enrollment fails
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
        const contributor_id = await finishUser(
            locals.cfContext,
            locals.identity!.email,
            record.name,
            record.major ?? null,
            record.class_year ?? null
        )
        if (contributor_id === null) {
            // should be imposible
            return constructResponse(
                request,
                null,
                500,
                "Failed to finish user enrollment: user is missing from access list but has a contributor record"
            )
        } else if (contributor_id === undefined) {
            // error - either is fully enrolled, or does not exist
            return constructResponse(
                request,
                null,
                500,
                "Failed to finish user enrollment: user is either fully enrolled or does not exist in the database"
            )
        } else {
            return constructResponse(request, null, 201, undefined, {
                Location: `/api/v1/contributors/${contributor_id}`
            })
        }
    } catch (error) {
        console.error("Error during self-enrollment:", error)
        return constructResponse(request, null, 500, "Failed to finish user enrollment")
    }
}

/**
 * PATCH /api/v1/identity/self
 * Change the authenticated user's own identity (sign-in) email
 *
 * This is the self-service counterpart to PATCH /api/v1/identity's identity_email operation, which is
 * admin-only and keyed by another user's email: here the target is always the caller's own contributor
 * record, derived from the authenticated identity, so no special permissions are required. The old email
 * is read from the caller's own record (changeLoginEmail), so the body carries only the new email.
 *
 * Permissions required: none (must be self; an enrollable login without a record is rejected by selfmgmt)
 *
 * Meta: none
 * Body: required, JSON array containing one string (the new identity email)
 *
 * @param context - the Astro API context
 * @returns a Response object
 */
export const PATCH: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity (selfmgmt: allows an active or inactive own record, rejects enrollable/no-record)
    const auth_response = auth_check(request, locals.identity, [], false, "selfmgmt")
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
    // validate the new email
    const new_email = api_request.payload[0]
    if (typeof new_email !== "string" || new_email.trim() === "" || !new_email.includes("@")) {
        return constructResponse(
            request,
            null,
            400,
            "Invalid request body: new identity email must be a valid email string"
        )
    }
    // the change targets the caller's own record; selfmgmt guarantees an allowed (non-enrollable) identity,
    // but guard the id explicitly (e.g. when authentication is disabled in local development, identity is absent)
    if (locals.identity === undefined || locals.identity.id === undefined || locals.identity.id === null) {
        return constructResponse(request, null, 403, "No contributor record is associated with your login")
    }
    // perform the email change on the caller's own record
    try {
        await changeLoginEmail(locals.cfContext, locals.identity.id, new_email.trim())
        return constructResponse(request, null, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Failed to update identity email")
    }
}

/**
 * DELETE /api/v1/identity/self
 * Deactivate the authenticated user's own contributor record (self-service)
 *
 * This is the self-service counterpart to the admin-only deactivation keyed by another user's email
 * (DELETE /api/v1/identity's activation operation): here the target is always the caller's own record,
 * derived from the authenticated identity, so no special permissions are required. Deactivation marks the
 * record inactive — the user keeps the ability to sign in but loses write access (read-only). It does not
 * remove the user from Cloudflare Access. Idempotent: deactivating an already-inactive record is a no-op.
 *
 * Permissions required: none (must be self; an enrollable login without a record is rejected by selfmgmt)
 *
 * Meta: none
 * Body: none
 *
 * @param context - the Astro API context
 * @returns a Response object
 */
export const DELETE: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity (selfmgmt: allows an active or inactive own record, rejects enrollable/no-record)
    const auth_response = auth_check(request, locals.identity, [], false, "selfmgmt")
    if (auth_response !== null) {
        return auth_response
    }
    // the deactivation targets the caller's own record; selfmgmt guarantees an allowed (non-enrollable)
    // identity, but guard the id explicitly (e.g. when authentication is disabled in local development)
    if (locals.identity === undefined || locals.identity.id === undefined || locals.identity.id === null) {
        return constructResponse(request, null, 403, "No contributor record is associated with your login")
    }
    // mark the caller's own record inactive
    try {
        await deactivateUser(locals.cfContext, locals.identity.id)
        return constructResponse(request, null, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Failed to deactivate your account")
    }
}
