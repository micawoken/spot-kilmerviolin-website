/**
 * pages/api/v1/identity/email.ts
 *
 * Provides endpoints related to email changes
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
import { constructResponse, constructResponseErrorHook } from "../../../../lib/api/http"
import { auth_check } from "../../../../lib/public/authservice"
import { emailToId, _changeLoginEmail } from "../../../../lib/public/usermgmt"
import { isFallbackEmail } from "../../../../lib/api/fallback"

/**
 * PATCH /api/v1/identity/email
 * Changes the login (identity) email of the provided users, keyed by their current email
 *
 * Permissions required: *admin*
 *
 * Meta: none
 * Body: required, JSON array containing one object mapping each user's current email to their new
 *  email: { [old_email: string]: string } (up to 5 users)
 *
 * @param context - the Astro API context
 * @returns a Response object
 */
export const PATCH: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    const auth_response = auth_check(request, locals.identity, [], true)
    if (auth_response !== null) {
        return auth_response
    }
    const api_request = await parseAPIRequest(request)
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, `Bad request: ${api_request.message}`)
    }
    if (!Array.isArray(api_request.payload) || api_request.payload.length !== 1) {
        return constructResponse(request, null, 400, "Bad request: payload must be an array with a single item")
    }
    if (typeof api_request.payload[0] !== "object" || api_request.payload[0] === null) {
        return constructResponse(
            request,
            null,
            400,
            "Bad request: payload must be a JSON object mapping current emails to new emails"
        )
    }
    const email_map = api_request.payload[0] as Record<string, unknown>
    if (Object.keys(email_map).length > 5) {
        return constructResponse(request, null, 400, "Bad request: transaction exceeds max 5 users per request")
    }
    // validate every new email up front so the whole request is rejected before any change is applied
    for (const [old_email, new_email] of Object.entries(email_map)) {
        if (typeof new_email !== "string" || new_email.trim() === "" || !new_email.includes("@")) {
            return constructResponse(
                request,
                null,
                400,
                `Bad request: new email for ${old_email} must be a valid email string`
            )
        }
        // a reserved fallback address can never be enrolled in Access (see lib/api/fallback.ts); reject it
        // here so the change is not applied to the contributor record and then rejected at enrollment
        if (isFallbackEmail(new_email)) {
            return constructResponse(
                request,
                null,
                400,
                `Bad request: cannot set the identity email for ${old_email} to a reserved fallback address`
            )
        }
    }
    const errors: string[] = []
    // the email changes run sequential DB transactions; wrap them so a thrown error is reported as a clean
    // error response (with the errors accumulated so far) rather than escaping as an unhandled exception
    try {
        for (const [old_email, new_email] of Object.entries(email_map)) {
            const id = await emailToId(old_email)
            if (id === null) {
                errors.push(`no contributor record found for ${old_email}`)
                continue
            }
            await _changeLoginEmail(context.locals.cfContext, id, old_email, (new_email as string).trim())
        }
    } catch (error) {
        const response = constructResponseErrorHook(
            request,
            error,
            500,
            "Failed to change identity email; previous transactions may have succeeded"
        )
        response.headers.append("X-MWMSC-Response-Errors", JSON.stringify(errors))
        return response
    }
    const response = constructResponse(request, null, 200)
    response.headers.append("X-MWMSC-Response-Errors", JSON.stringify(errors))
    return response
}
