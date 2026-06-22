/**
 * pages/api/v1/identity/github.ts
 *
 * Administrator management of another user's GitHub username link, keyed by identity email. This is the
 * by-email counterpart to the self-service /api/v1/identity/self/github: every operation here is admin-only,
 * so the handler carries no permission/elevate branching (the self endpoint absorbs the permissioned,
 * self-targeting flow).
 *
 *  - GET    reads a user's linkage state (username, id, whether authorized for repo access)
 *  - POST   sets or changes a user's username (resolves the account, enforces id uniqueness)
 *  - DELETE clears a user's username and cascades: any granted repository access is revoked first
 *
 * Granting/revoking repository write access (collaborator) lives in the authorization sub-resource,
 * /api/v1/identity/github/authorization.
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
import { constructResponse, constructResponseErrorHook } from "../../../../lib/api/http"
import { auth_check } from "../../../../lib/public/authservice"
import { emailToId, getGithubLink, adminSetGithubUsername, deleteGithubLink } from "../../../../lib/public/usermgmt"
import { isValidEmail } from "../../../../lib/api/validation"

/** Reads and validates the single-item payload object; returns it or a 400 Response. */
async function readObjectPayload(request: Request): Promise<Record<string, unknown> | Response> {
    const api_request = await parseAPIRequest(request)
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, `Bad request: ${api_request.message}`)
    }
    if (!Array.isArray(api_request.payload) || api_request.payload.length !== 1) {
        return constructResponse(request, null, 400, "Bad request: payload must be an array with a single item")
    }
    if (typeof api_request.payload[0] !== "object" || api_request.payload[0] === null) {
        return constructResponse(request, null, 400, "Bad request: payload item must be a JSON object")
    }
    return api_request.payload[0] as Record<string, unknown>
}

/**
 * GET /api/v1/identity/github?identity_email=...
 * Returns the linkage state for the user with the given identity email
 *
 * Permissions required: *admin*
 *
 * @param context - the Astro API context
 * @returns a Response object
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { request, locals, url } = context
    const auth_response = auth_check(request, locals.identity, [], true)
    if (auth_response !== null) {
        return auth_response
    }
    const email = (url.searchParams.get("identity_email") ?? "").trim()
    if (!isValidEmail(email)) {
        return constructResponse(request, null, 400, "Bad request: a valid identity_email query parameter is required")
    }
    try {
        const id = await emailToId(email)
        if (id === null) {
            return constructResponse(request, null, 404, `No contributor record found for ${email}`)
        }
        return constructResponse(request, await getGithubLink(id), 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Failed to read GitHub linkage")
    }
}

/**
 * POST /api/v1/identity/github
 * Sets or changes the GitHub username for the user with the given identity email
 *
 * Permissions required: *admin*
 *
 * Meta: none
 * Body: required, JSON array containing one object of the shape { identity_email: string, username: string }
 *
 * @param context - the Astro API context
 * @returns a Response object
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    const auth_response = auth_check(request, locals.identity, [], true)
    if (auth_response !== null) {
        return auth_response
    }
    const item = await readObjectPayload(request)
    if (item instanceof Response) {
        return item
    }
    const email = typeof item.identity_email === "string" ? item.identity_email.trim() : ""
    if (!isValidEmail(email) || typeof item.username !== "string") {
        return constructResponse(
            request,
            null,
            400,
            "Bad request: payload must contain a valid identity_email and a username string"
        )
    }
    try {
        const id = await emailToId(email)
        if (id === null) {
            return constructResponse(request, null, 404, `No contributor record found for ${email}`)
        }
        // admin operation: allow replacing an existing link (the "change" semantics)
        await adminSetGithubUsername(locals.cfContext, id, item.username, true)
        return constructResponse(request, null, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 400, "Failed to set GitHub username")
    }
}

/**
 * DELETE /api/v1/identity/github
 * Clears the GitHub username for the user with the given identity email, revoking repository access first
 *
 * Permissions required: *admin*
 *
 * Meta: none
 * Body: required, JSON array containing one object of the shape { identity_email: string }
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
    const item = await readObjectPayload(request)
    if (item instanceof Response) {
        return item
    }
    const email = typeof item.identity_email === "string" ? item.identity_email.trim() : ""
    if (!isValidEmail(email)) {
        return constructResponse(request, null, 400, "Bad request: payload must contain a valid identity_email")
    }
    try {
        const id = await emailToId(email)
        if (id === null) {
            return constructResponse(request, null, 404, `No contributor record found for ${email}`)
        }
        await deleteGithubLink(locals.cfContext, id)
        return constructResponse(request, null, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Failed to clear GitHub username")
    }
}
