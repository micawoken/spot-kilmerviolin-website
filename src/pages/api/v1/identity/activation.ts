/**
 * pages/api/v1/identity/activation.ts
 *
 * Provides a dedicated sub-resource for managing the active state of contributor records, with
 * per-method authorization. This is the delegated counterpart to PATCH /api/v1/identity's
 * active.activate/active.deactivate operations (which are admin-only): activation is opened up to the
 * user_activation permission so enrollment-capable users can bring accounts online, while
 * deactivation (which revokes an active user's access) remains admin-only.
 *
 */

import type { APIContext, APIRoute } from "astro"
import { parseAPIRequest } from "../../../../lib/api/common"
import { constructResponse, constructResponseErrorHook } from "../../../../lib/api/http"
import { auth_check } from "../../../../lib/public/authservice"
import { emailToId, activateUser, deactivateUser } from "../../../../lib/public/usermgmt"

/**
 * Shared validation and execution for both verbs. Parses the request body, resolves each identity
 * email to its contributor record, and toggles the active state. Missing records are reported as
 * non-fatal errors (via X-MWMSC-Response-Errors) rather than failing the whole request, mirroring
 * PATCH /api/v1/identity.
 *
 * @param context - the Astro API context
 * @param request - the Request object
 * @param activate - true to activate the listed users, false to deactivate them
 * @returns a Response object
 */
async function _processActivation(context: APIContext, request: Request, activate: boolean): Promise<Response> {
    const api_request = await parseAPIRequest(request)
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, `Bad request: ${api_request.message}`)
    }
    // verify that the request body is an array with a single item
    if (!Array.isArray(api_request.payload) || api_request.payload.length !== 1) {
        return constructResponse(request, null, 400, "Bad request: payload must be an array with a single item")
    }
    // verify the type of the request body and fields
    if (typeof api_request.payload[0] !== "object" || api_request.payload[0] === null) {
        return constructResponse(request, null, 400, "Bad request: payload must be a JSON object")
    }
    const emails = (api_request.payload[0] as { emails: unknown }).emails
    if (!Array.isArray(emails) || !emails.every((email: any) => typeof email === "string")) {
        return constructResponse(request, null, 400, "Bad request: emails field must be a list of strings (emails)")
    }
    if (emails.length > 5) {
        return constructResponse(request, null, 400, "Bad request: transaction exceeds max 5 users per request")
    }
    const errors: string[] = []
    // the toggles run sequential DB transactions; wrap them so a thrown error is reported as a clean
    // error response (with the errors accumulated so far) rather than escaping as an unhandled exception
    try {
        for (const email of emails) {
            const id = await emailToId(email)
            if (id === null) {
                errors.push(`no contributor record found for ${email}`)
                continue
            }
            if (activate) {
                await activateUser(context.locals.cfContext, id)
            } else {
                await deactivateUser(context.locals.cfContext, id)
            }
        }
    } catch (error) {
        const response = constructResponseErrorHook(request, error, 500, "Failed to update activation state; previous transactions may have succeeded")
        response.headers.append("X-MWMSC-Response-Errors", JSON.stringify(errors))
        return response
    }
    const response = constructResponse(request, null, 200)
    response.headers.append("X-MWMSC-Response-Errors", JSON.stringify(errors))
    return response
}

/**
 * PUT /api/v1/identity/activation
 * Activates the contributor records mapped to the provided identity emails (sets active = true)
 *
 * Permissions required: one of (*admin*, user_activation)
 *
 * Meta: none
 * Body: required, JSON array containing one object of the shape { emails: string[] } (up to 5 emails)
 *
 * @param context - the Astro API context
 * @returns a Response object
 */
export const PUT: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    const auth_response = auth_check(request, locals.identity, [ "user_activation" ])
    if (auth_response !== null) {
        return auth_response
    }
    return _processActivation(context, request, true)
}

/**
 * DELETE /api/v1/identity/activation
 * Deactivates the contributor records mapped to the provided identity emails (sets active = false)
 *
 * Permissions required: *admin* (deactivation revokes an active user's access; not delegated)
 *
 * Meta: none
 * Body: required, JSON array containing one object of the shape { emails: string[] } (up to 5 emails)
 *
 * @param context - the Astro API context
 * @returns a Response object
 */
export const DELETE: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    const auth_response = auth_check(request, locals.identity, [], true)
    if (auth_response !== null) {
        return auth_response
    }
    return _processActivation(context, request, false)
}
