/**
 * pages/api/v1/identity.ts
 *
 * Provides access to the Cloudflare API for Access policy management, and provides an interface to quickly modify the identity aspects of contributors
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

import type { APIContext, APIRoute } from "astro"
import { parseAPIRequest } from "../../../lib/api/common"
import { _constructHeaders, constructResponse, constructResponseErrorHook } from "../../../lib/api/http"
import { list_users, add_user, remove_user } from "../../../lib/api/access_iam_mgmt"
import { isFallbackEmail } from "../../../lib/api/fallback"
import { auth_check } from "../../../lib/public/authservice"
import { roles } from "../../../lib/api/authorize"
import {
    createUser,
    removeUser,
    emailToId,
    elevateUser,
    demoteUser,
    activateUser,
    deactivateUser,
    assignRole,
    removeRole,
    getUserInfo,
    _changeLoginEmail
} from "../../../lib/public/usermgmt"

/**
 * GET /api/v1/identity
 * Returns a list of emails of users in the Access policy
 *
 * Permissions required: one of (*admin*, user_addition)
 *
 * Meta: none
 * Body: none
 *
 * @param context - the Astro API context
 * @returns a Response object with payload of string[] of user emails
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    // returns a JSON of string[] containing emails
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, ["user_addition"])
    if (auth_response !== null) {
        return auth_response
    }
    // perform requested operation
    try {
        const result = await list_users()
        return constructResponse(request, result, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Failed to list users")
    }
}
/**
 * POST /api/v1/identity
 * Adds an authenticated user to Cloudflare Access for the provided email
 *
 * Permissions required: one of (*admin*, user_addition)
 *
 * Meta: optional
 * Meta fields:
 *  - autoenrollment: {boolean} Specifies whether to automatically create a contributor record to bypass self-enrollment flow; defaults to false
 *  - confer: {boolean or null} If autoenrollment is true, specifies whether to confer acting identity's conferrable permissions
 *  - name: {string or null} If autoenrollment is true, specifies the name to use for the created contributor record; if not provided when required, call fails
 *  - major: {string or null} If autoenrollment is true, specifies the major to use for the created contributor record; if not provided when required, call fails
 *  - class_year: {number or null} If autoenrollment is true, specifies the class year to use for the created contributor record; if not provided when required, call fails
 *
 * Body: required, JSON array of [email_to_add: string]
 *
 * @param context - the Astro API context
 * @returns a Response object
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    // accepts an API request payload as a list containing the one email to add
    const { request, locals } = context
    const auth_response = auth_check(request, locals.identity, ["user_addition"])
    if (auth_response !== null) {
        return auth_response
    }
    const api_request = await parseAPIRequest(request, [])
    // the autoenrollment flag sets whether to automatically create a contributor record
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, `Bad request: ${api_request.message}`)
    }
    if (
        api_request.payload === null ||
        api_request.payload.length !== 1 ||
        typeof api_request.payload[0] !== "string"
    ) {
        return constructResponse(
            request,
            null,
            400,
            "Bad request: payload must be a list containing exactly one email string"
        )
    }
    // fallback identity emails are reserved placeholders that can never authenticate (see lib/api/fallback.ts);
    // reject an attempt to enroll one up front with a clear 400, rather than letting add_user throw deep in
    // the enrollment flow
    if (isFallbackEmail(api_request.payload[0])) {
        return constructResponse(
            request,
            null,
            400,
            "Cannot enroll a reserved fallback identity email. Assign the contributor a real sign-in email before enrolling them in Access."
        )
    }
    // any enrollment failure (the add_user fallback guard as a backstop, or a Cloudflare Access API error)
    // is reported as a clean error response so the request never crashes with an unhandled exception
    try {
        if (api_request.meta?.autoenrollment === true) {
            // major and class_year map to nullable columns: null (or an omitted key) is accepted and stored as null
            const meta_major = api_request.meta?.major ?? null
            const meta_class_year = api_request.meta?.class_year ?? null
            if (
                typeof api_request.meta?.confer !== "boolean" ||
                typeof api_request.meta?.name !== "string" ||
                (meta_major !== null && typeof meta_major !== "string") ||
                (meta_class_year !== null && typeof meta_class_year !== "number")
            ) {
                return constructResponse(
                    request,
                    null,
                    400,
                    "Bad request: missing or invalid meta fields for autoenrollment"
                )
            }
            await createUser(
                context.locals.cfContext,
                locals.identity!,
                api_request.meta?.confer,
                api_request.payload[0],
                api_request.meta?.name,
                meta_major,
                meta_class_year
            )
            return constructResponse(request, null, 201)
        } else {
            const email = api_request.payload[0]
            await add_user(email)
            return constructResponse(request, null, 201)
        }
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Failed to add user")
    }
}

/**
 * PUT /api/v1/identity
 * Method not implemented; use PUT /api/v1/contributors/[id]
 *
 * PATCH (defined below) wraps around the contributor endpoint to provide an identity-centric management interface, but a ContributorRecord underlies it
 */
export const PUT: APIRoute = async (context): Promise<Response> => {
    return constructResponse(
        context.request,
        null,
        405,
        "Method not allowed: use PATCH /api/v1/identity (for identity-centric updates) or PUT /api/v1/contributors/[id] (for contributor-centric updates)",
        {
            Allow: "GET, POST, PATCH, DELETE",
            Location: "/api/v1/contributors/[id]"
        }
    )
}

/**
 * PATCH /api/v1/identity
 * Updates an identity property of a user/contributor
 *
 * Identity properties available to modify:
 *  - admin: elevate and demote
 *  - active: activate and deactivate
 *  - roles: add and remove
 *  - identity_email: update
 *
 * (up to 5 transactions per scope, such as admin.elevate, per request)
 *
 * Note: this endpoint is provided for convenience; however, for complex updates requiring multiple transactions, it is highly encouraged to use PATCH or PUT on /api/v1/contributors/[id] because the sequential execution process is inherently more expensive and error-prone
 *
 * Permissions: *admin*
 *
 * Meta: none
 * Body: required, see shape spec below
 *
 * Body interface: {
 *     admin?: {
 *         elevate?: string[] -- list of identity emails to elevate
 *         demote?: string[] -- list of identity emails to demote
 *     },
 *     active?: {
 *        activate?: string[] -- list of identity emails to activate
 *        deactivate?: string[] -- list of identity emails to deactivate
 *     },
 *     roles?: {
 *         add?: { [email: string]: string[] } -- map of identity email to list of roles to add
 *         remove?: { [email: string]: string[] } -- map of identity email to list of roles to remove
 *     },
 *     identity_email?: {
 *         old_email: string -- the new email
 *     }
 * }
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
    // parse and validate request body
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
    let errors: string[] = []
    // the sub-parsers run sequential DB transactions; wrap them so a thrown error (e.g. a SQLite failure
    // mid-sequence) is reported as a clean error response, with whatever errors accumulated so far attached,
    // rather than escaping as an unhandled exception
    try {
        const admin_exec =
            "admin" in api_request.payload[0] ? await _parseAdmin(context, request, api_request.payload[0]) : []
        if (admin_exec instanceof Response) {
            admin_exec.headers.append("X-MWMSC-Response-Errors", JSON.stringify(errors))
            return admin_exec
        }
        errors = errors.concat(admin_exec)
        const active_exec =
            "active" in api_request.payload[0] ? await _parseActive(context, request, api_request.payload[0]) : []
        if (active_exec instanceof Response) {
            active_exec.headers.append("X-MWMSC-Response-Errors", JSON.stringify(errors))
            return active_exec
        }
        errors = errors.concat(active_exec)
        const roles_exec =
            "roles" in api_request.payload[0] ? await _parseRoles(context, request, api_request.payload[0]) : []
        if (roles_exec instanceof Response) {
            roles_exec.headers.append("X-MWMSC-Response-Errors", JSON.stringify(errors))
            return roles_exec
        }
        errors = errors.concat(roles_exec)
        const identity_email_exec =
            "identity_email" in api_request.payload[0]
                ? await _parseIdEmail(context, request, api_request.payload[0])
                : []
        if (identity_email_exec instanceof Response) {
            identity_email_exec.headers.append("X-MWMSC-Response-Errors", JSON.stringify(errors))
            return identity_email_exec
        }
        errors = errors.concat(identity_email_exec)
        // operation succeeded
        const response = constructResponse(request, null, 200)
        response.headers.append("X-MWMSC-Response-Errors", JSON.stringify(errors))
        return response
    } catch (error) {
        const response = constructResponseErrorHook(
            request,
            error,
            500,
            "Failed to apply identity update; previous transactions may have succeeded"
        )
        response.headers.append("X-MWMSC-Response-Errors", JSON.stringify(errors))
        return response
    }
}

async function _parseAdmin(
    context: APIContext,
    request: Request,
    payload: { admin: unknown }
): Promise<string[] | Response> {
    let errors: string[] = []
    if (typeof payload.admin !== "object" || payload.admin === null) {
        return constructResponse(
            request,
            null,
            400,
            "Bad request: admin field if specified must be an object; previous transactions may have succeeded"
        )
    }
    if ("elevate" in payload.admin) {
        if (
            !Array.isArray(payload.admin.elevate) ||
            !payload.admin.elevate.every((email: any) => typeof email === "string")
        ) {
            return constructResponse(
                request,
                null,
                400,
                "Bad request: elevate field if specified must be a list of strings (emails); previous transactions may have succeeded"
            )
        }
        if (payload.admin.elevate.length > 5) {
            return constructResponse(
                request,
                null,
                400,
                "Bad request: transaction exceeds max 5 users per admin.elevate; previous transactions may have succeeded"
            )
        }
        for (const email of payload.admin.elevate) {
            const id = await emailToId(email)
            if (id === null) {
                errors.push(`admin.elevate: no contributor record found for ${email}`)
                continue
            }
            await elevateUser(context.locals.cfContext, id)
        }
    }
    if ("demote" in payload.admin) {
        if (
            !Array.isArray(payload.admin.demote) ||
            !payload.admin.demote.every((email: any) => typeof email === "string")
        ) {
            return constructResponse(
                request,
                null,
                400,
                "Bad request: demote field if specified must be a list of strings (emails); previous transactions may have succeeded"
            )
        }
        if (payload.admin.demote.length > 5) {
            return constructResponse(
                request,
                null,
                400,
                "Bad request: transaction exceeds max 5 users per admin.demote; previous transactions may have succeeded"
            )
        }
        for (const email of payload.admin.demote) {
            const id = await emailToId(email)
            if (id === null) {
                errors.push(`admin.demote: no contributor record found for ${email}`)
                continue
            }
            await demoteUser(context.locals.cfContext, id)
        }
    }
    return errors
}

async function _parseActive(
    context: APIContext,
    request: Request,
    payload: { active: unknown }
): Promise<string[] | Response> {
    let errors: string[] = []
    if (typeof payload.active !== "object" || payload.active === null) {
        return constructResponse(
            request,
            null,
            400,
            "Bad request: active field if specified must be an object; previous transactions may have succeeded"
        )
    }
    if ("activate" in payload.active) {
        if (
            !Array.isArray(payload.active.activate) ||
            !payload.active.activate.every((email: any) => typeof email === "string")
        ) {
            return constructResponse(
                request,
                null,
                400,
                "Bad request: activate field if specified must be a list of strings (emails); previous transactions may have succeeded"
            )
        }
        if (payload.active.activate.length > 5) {
            return constructResponse(
                request,
                null,
                400,
                "Bad request: transaction exceeds max 5 users per active.activate; previous transactions may have succeeded"
            )
        }
        for (const email of payload.active.activate) {
            const id = await emailToId(email)
            if (id === null) {
                errors.push(`active.activate: no contributor record found for ${email}`)
                continue
            }
            await activateUser(context.locals.cfContext, id)
        }
    }
    if ("deactivate" in payload.active) {
        if (
            !Array.isArray(payload.active.deactivate) ||
            !payload.active.deactivate.every((email: any) => typeof email === "string")
        ) {
            return constructResponse(
                request,
                null,
                400,
                "Bad request: deactivate field if specified must be a list of strings (emails); previous transactions may have succeeded"
            )
        }
        if (payload.active.deactivate.length > 5) {
            return constructResponse(
                request,
                null,
                400,
                "Bad request: transaction exceeds max 5 users per active.deactivate; previous transactions may have succeeded"
            )
        }
        for (const email of payload.active.deactivate) {
            const id = await emailToId(email)
            if (id === null) {
                errors.push(`active.deactivate: no contributor record found for ${email}`)
                continue
            }
            await deactivateUser(context.locals.cfContext, id)
        }
    }
    return errors
}

async function _parseRoles(
    context: APIContext,
    request: Request,
    payload: { roles: unknown }
): Promise<string[] | Response> {
    let errors: string[] = []
    if (typeof payload.roles !== "object" || payload.roles === null) {
        return constructResponse(
            request,
            null,
            400,
            "Bad request: roles field if specified must be an object; previous transactions may have succeeded"
        )
    }
    if ("add" in payload.roles) {
        if (typeof payload.roles.add !== "object" || payload.roles.add === null) {
            return constructResponse(
                request,
                null,
                400,
                "Bad request: add field if specified must be an object; previous transactions may have succeeded"
            )
        }
        // length check
        if (Object.keys(payload.roles.add).length > 5) {
            return constructResponse(
                request,
                null,
                400,
                "Bad request: transaction exceeds max 5 users per roles.add; previous transactions may have succeeded"
            )
        }
        for (const [email, roles_add] of Object.entries(payload.roles.add)) {
            if (!Array.isArray(roles_add) || !roles_add.every((role: any) => role in roles)) {
                return constructResponse(
                    request,
                    null,
                    400,
                    `Bad request: roles to add for ${email} must be valid roles`
                )
            }
            const id = await emailToId(email)
            if (id === null) {
                errors.push(`roles.add: no contributor record found for ${email}`)
                continue
            }
            if (roles_add.length > 5) {
                return constructResponse(
                    request,
                    null,
                    400,
                    `Bad request: transaction exceeds max 5 roles per user for roles.add; previous transactions may have succeeded`
                )
            }
            for (const role of roles_add) {
                await assignRole(context.locals.cfContext, id, role)
            }
        }
    }
    if ("remove" in payload.roles) {
        if (typeof payload.roles.remove !== "object" || payload.roles.remove === null) {
            return constructResponse(
                request,
                null,
                400,
                "Bad request: remove field if specified must be an object; previous transactions may have succeeded"
            )
        }
        if (Object.keys(payload.roles.remove).length > 5) {
            return constructResponse(
                request,
                null,
                400,
                "Bad request: transaction exceeds max 5 users per roles.remove; previous transactions may have succeeded"
            )
        }
        for (const [email, roles_remove] of Object.entries(payload.roles.remove)) {
            const id = await emailToId(email)
            if (id === null) {
                errors.push(`roles.remove: no contributor record found for ${email}`)
                continue
            }
            if (!Array.isArray(roles_remove) || !roles_remove.every((role: any) => role in roles)) {
                return constructResponse(
                    request,
                    null,
                    400,
                    `Bad request: roles to remove for ${email} must be valid roles; previous transactions may have succeeded`
                )
            }
            if (roles_remove.length > 5) {
                return constructResponse(
                    request,
                    null,
                    400,
                    `Bad request: transaction exceeds max 5 roles per user for roles.remove; previous transactions may have succeeded`
                )
            }
            for (const role of roles_remove) {
                await removeRole(context.locals.cfContext, id, role)
            }
        }
    }
    return errors
}

async function _parseIdEmail(
    context: APIContext,
    request: Request,
    payload: { identity_email: unknown }
): Promise<string[] | Response> {
    let errors: string[] = []
    if (typeof payload.identity_email !== "object" || payload.identity_email === null) {
        return constructResponse(
            request,
            null,
            400,
            "Bad request: identity_email field if specified must be an object; previous transactions may have succeeded"
        )
    }
    if (Object.keys(payload.identity_email).length > 5) {
        return constructResponse(
            request,
            null,
            400,
            "Bad request: transaction exceeds max 5 users per identity_email; previous transactions may have succeeded"
        )
    }
    for (const [old_email, new_email] of Object.entries(payload.identity_email)) {
        if (typeof new_email !== "string") {
            return constructResponse(
                request,
                null,
                400,
                `Bad request: new email for ${old_email} must be a string; previous transactions may have succeeded`
            )
        }
        // a reserved fallback address can never be enrolled in Access (see lib/api/fallback.ts); reject it
        // before _changeLoginEmail mutates the contributor record and then fails at enrollment
        if (isFallbackEmail(new_email)) {
            return constructResponse(
                request,
                null,
                400,
                `Bad request: cannot set ${old_email}'s identity email to a reserved fallback address; previous transactions may have succeeded`
            )
        }
        const id = await emailToId(old_email)
        if (id === null) {
            errors.push(`identity_email: no contributor record found for ${old_email}`)
            continue
        }
        await _changeLoginEmail(context.locals.cfContext, id, old_email, new_email)
    }
    return errors
}

/**
 * DELETE /api/v1/identity
 * Removes a user from Cloudflare Access for the provided email
 *
 * Permissions required: one of (*admin*, user_addition)
 *
 * Meta: optional
 * Meta fields:
 *  - autodeactivation: {boolean} Specifies whether to automatically deactivate the contributor record; defaults to true
 */
export const DELETE: APIRoute = async (context): Promise<Response> => {
    // accepts an API request payload as a list containing the one email to remove
    const { request, locals } = context
    const auth_response = auth_check(request, locals.identity, ["user_addition"])
    if (auth_response !== null) {
        return auth_response
    }
    const api_request = await parseAPIRequest(request, []) // autodeactivation is optional, defaults to true
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, `Bad request: ${api_request.message}`)
    }
    if (
        api_request.payload === null ||
        api_request.payload.length !== 1 ||
        typeof api_request.payload[0] !== "string"
    ) {
        return constructResponse(
            request,
            null,
            400,
            "Bad request: payload must be a list containing exactly one email string"
        )
    }
    const target_email = api_request.payload[0]
    try {
        // Removing a user rewrites the Access policy with their include rule deleted, so this endpoint —
        // delegated to user_addition, not admin — can revoke authentication for the whole application.
        // Two targets are therefore off limits to a non-administrator holding that permission:
        //
        //  - an administrator, who would otherwise be locked out of /admin, /api and /_emdash alike (all
        //    behind Access on the custom domain) with recovery only through the Cloudflare dashboard. This
        //    also realigns the route with DELETE /api/v1/identity/activation, which is deliberately
        //    admin-only ("deactivation revokes an active user's access; not delegated") yet reaches the
        //    same deactivation through removeUser's autodeactivation.
        //  - themselves, mirroring the self-deletion guard on DELETE /api/v1/contributors/[id].
        const [target] = await getUserInfo(target_email)
        if (target !== null && target.admin && locals.identity?.admin !== true) {
            return constructResponse(request, null, 403, "Only an administrator may remove another administrator")
        }
        if (target !== null && locals.identity?.id === target.id) {
            return constructResponse(request, null, 403, "Self-removal is not permitted")
        }
        if (api_request.meta?.autodeactivation === true || api_request.meta?.autodeactivation === undefined) {
            // from lib/public/usermgmt.ts, deactivates contributor record
            await removeUser(context.locals.cfContext, target_email)
        } else {
            // from lib/api/access_iam_mgmt.ts, removes user from Access policy without changing contributor record
            await remove_user(target_email)
        }
        return constructResponse(request, null, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Failed to remove user")
    }
}
