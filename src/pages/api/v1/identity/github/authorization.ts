/**
 * pages/api/v1/identity/github/authorization.ts
 *
 * Administrator control of a contributor's GitHub repository write access — the authorization sub-resource
 * of the GitHub username link. Granting access adds the linked account as a repository collaborator;
 * revoking removes it. Both are admin-only and keyed by identity email, and both are ID-primary: the stored
 * immutable GitHub id is resolved to the account's current login before access is changed, so a reassigned
 * username is denied and a legitimate rename is followed (see lib/api/github_repo_mgmt.ts).
 *
 *  - POST   authorizes (adds the linked account as a collaborator with push access)
 *  - DELETE deauthorizes (removes the collaborator); the repository owner is protected from revocation
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
import { parseAPIRequest } from "../../../../../lib/api/common"
import { constructResponse, constructResponseErrorHook } from "../../../../../lib/api/http"
import { auth_check } from "../../../../../lib/public/authservice"
import { emailToId, authorizeGithub, deauthorizeGithub } from "../../../../../lib/public/usermgmt"
import { isValidEmail } from "../../../../../lib/api/validation"

/** Reads the single-item payload and extracts a valid identity_email, or returns a 400 Response. */
async function readEmail(request: Request): Promise<string | Response> {
    const api_request = await parseAPIRequest(request)
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, `Bad request: ${api_request.message}`)
    }
    if (!Array.isArray(api_request.payload) || api_request.payload.length !== 1) {
        return constructResponse(request, null, 400, "Bad request: payload must be an array with a single item")
    }
    const item = api_request.payload[0]
    const email = typeof (item as { identity_email?: unknown })?.identity_email === "string"
        ? (item as { identity_email: string }).identity_email.trim()
        : ""
    if (!isValidEmail(email)) {
        return constructResponse(request, null, 400, "Bad request: payload must contain a valid identity_email")
    }
    return email
}

/**
 * POST /api/v1/identity/github/authorization
 * Grants repository write access to the linked GitHub account of the user with the given identity email
 *
 * Permissions required: *admin*
 *
 * Meta: none
 * Body: required, JSON array containing one object of the shape { identity_email: string }
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
    const email = await readEmail(request)
    if (email instanceof Response) {
        return email
    }
    try {
        const id = await emailToId(email)
        if (id === null) {
            return constructResponse(request, null, 404, `No contributor record found for ${email}`)
        }
        await authorizeGithub(locals.cfContext, id)
        return constructResponse(request, null, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 400, "Failed to authorize GitHub repository access")
    }
}

/**
 * DELETE /api/v1/identity/github/authorization
 * Revokes repository write access from the linked GitHub account of the user with the given identity email
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
    const email = await readEmail(request)
    if (email instanceof Response) {
        return email
    }
    try {
        const id = await emailToId(email)
        if (id === null) {
            return constructResponse(request, null, 404, `No contributor record found for ${email}`)
        }
        await deauthorizeGithub(locals.cfContext, id)
        return constructResponse(request, null, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 400, "Failed to revoke GitHub repository access")
    }
}
