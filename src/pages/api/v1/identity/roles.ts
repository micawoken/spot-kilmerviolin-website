/**
 * pages/api/v1/identity/roles.ts
 *
 * Provides a dedicated sub-resource for managing the roles of contributor records. This is the
 * counterpart to PATCH /api/v1/identity's roles.add/roles.remove operations, extracted so the role
 * workflow no longer depends on the complex multi-operation PATCH handler. Both verbs remain
 * admin-only (access control is unchanged):
 *  - PATCH performs incremental add/remove (mirrors PATCH /api/v1/identity's roles operation)
 *  - PUT replaces a user's entire role set (set semantics)
 *
 */

import type { APIRoute } from "astro"
import { parseAPIRequest } from "../../../../lib/api/common"
import { constructResponse, constructResponseErrorHook } from "../../../../lib/api/http"
import { auth_check } from "../../../../lib/public/authservice"
import { roles } from "../../../../lib/api/authorize"
import { emailToId, assignRole, removeRole, setRoles } from "../../../../lib/public/usermgmt"

/**
 * Validates that a value is a map of identity email to a valid role list, enforcing the per-request
 * and per-user transaction caps. Returns a normalized list of [email, roles] entries, or a Response
 * (the 400 to return) on validation failure.
 *
 * @param value - the candidate map to validate
 * @param request - the Request object (for response construction)
 * @param label - the field label used in error messages (e.g. "roles.add")
 * @returns normalized entries, or a 400 Response on failure
 */
function _validateRoleMap(value: unknown, request: Request, label: string): [string, string[]][] | Response {
    if (typeof value !== "object" || value === null) {
        return constructResponse(request, null, 400, `Bad request: ${label} must be an object; previous transactions may have succeeded`)
    }
    if (Object.keys(value).length > 5) {
        return constructResponse(request, null, 400, `Bad request: transaction exceeds max 5 users per ${label}; previous transactions may have succeeded`)
    }
    const entries: [string, string[]][] = []
    for (const [email, role_list] of Object.entries(value)) {
        if (!Array.isArray(role_list) || !role_list.every((role: any) => role in roles)) {
            return constructResponse(request, null, 400, `Bad request: roles for ${email} in ${label} must be valid roles; previous transactions may have succeeded`)
        }
        if (role_list.length > 5) {
            return constructResponse(request, null, 400, `Bad request: transaction exceeds max 5 roles per user for ${label}; previous transactions may have succeeded`)
        }
        entries.push([email, role_list])
    }
    return entries
}

/**
 * PATCH /api/v1/identity/roles
 * Incrementally adds and/or removes roles for the provided users
 *
 * Permissions required: *admin*
 *
 * Meta: none
 * Body: required, JSON array containing one object of the shape
 *  { add?: { [email: string]: string[] }, remove?: { [email: string]: string[] } }
 *  (up to 5 users per operation, up to 5 roles per user)
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
        return constructResponse(request, null, 400, "Bad request: payload must be a JSON object")
    }
    const payload = api_request.payload[0] as { add?: unknown; remove?: unknown }
    const errors: string[] = []
    // the role mutations run sequential DB transactions; wrap them so a thrown error is reported as a clean
    // error response (with the errors accumulated so far) rather than escaping as an unhandled exception
    try {
        if ("add" in payload) {
            const entries = _validateRoleMap(payload.add, request, "roles.add")
            if (entries instanceof Response) {
                return entries
            }
            for (const [email, roles_add] of entries) {
                const id = await emailToId(email)
                if (id === null) {
                    errors.push(`roles.add: no contributor record found for ${email}`)
                    continue
                }
                for (const role of roles_add) {
                    await assignRole(context.locals.cfContext, id, role)
                }
            }
        }
        if ("remove" in payload) {
            const entries = _validateRoleMap(payload.remove, request, "roles.remove")
            if (entries instanceof Response) {
                return entries
            }
            for (const [email, roles_remove] of entries) {
                const id = await emailToId(email)
                if (id === null) {
                    errors.push(`roles.remove: no contributor record found for ${email}`)
                    continue
                }
                for (const role of roles_remove) {
                    await removeRole(context.locals.cfContext, id, role)
                }
            }
        }
    } catch (error) {
        const response = constructResponseErrorHook(request, error, 500, "Failed to update roles; previous transactions may have succeeded")
        response.headers.append("X-MWMSC-Response-Errors", JSON.stringify(errors))
        return response
    }
    const response = constructResponse(request, null, 200)
    response.headers.append("X-MWMSC-Response-Errors", JSON.stringify(errors))
    return response
}

/**
 * PUT /api/v1/identity/roles
 * Replaces the entire role set for the provided users (set semantics)
 *
 * Permissions required: *admin*
 *
 * Meta: none
 * Body: required, JSON array containing one object of the shape
 *  { set: { [email: string]: string[] } } (up to 5 users, up to 5 roles per user)
 *
 * @param context - the Astro API context
 * @returns a Response object
 */
export const PUT: APIRoute = async (context): Promise<Response> => {
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
        return constructResponse(request, null, 400, "Bad request: payload must be a JSON object")
    }
    const payload = api_request.payload[0] as { set?: unknown }
    if (!("set" in payload)) {
        return constructResponse(request, null, 400, "Bad request: payload must contain a set field")
    }
    const entries = _validateRoleMap(payload.set, request, "roles.set")
    if (entries instanceof Response) {
        return entries
    }
    const errors: string[] = []
    // the role replacements run sequential DB transactions; wrap them so a thrown error is reported as a clean
    // error response (with the errors accumulated so far) rather than escaping as an unhandled exception
    try {
        for (const [email, role_list] of entries) {
            const id = await emailToId(email)
            if (id === null) {
                errors.push(`roles.set: no contributor record found for ${email}`)
                continue
            }
            await setRoles(context.locals.cfContext, id, role_list)
        }
    } catch (error) {
        const response = constructResponseErrorHook(request, error, 500, "Failed to set roles; previous transactions may have succeeded")
        response.headers.append("X-MWMSC-Response-Errors", JSON.stringify(errors))
        return response
    }
    const response = constructResponse(request, null, 200)
    response.headers.append("X-MWMSC-Response-Errors", JSON.stringify(errors))
    return response
}
