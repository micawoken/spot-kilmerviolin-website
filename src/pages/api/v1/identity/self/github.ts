/**
 * pages/api/v1/identity/self/github.ts
 *
 * Self-service management of the authenticated user's own GitHub username link. Kept separate from the
 * admin-facing /api/v1/identity/github so the self flow carries no by-email targeting or admin/elevate
 * branching: the target is always the caller's own contributor record, derived from the authenticated
 * identity. Setting/clearing the username requires the github_link permission (admins always pass); the
 * username is write-once until the linked account is authorized for repository access — while unauthorized
 * the user may freely change or clear it, but once authorized only an administrator may change or remove it.
 *
 * Granting the actual repository write access (collaborator) is never done here — that is admin-only, via
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
import { parseAPIRequest } from "../../../../../lib/api/common"
import { constructResponse, constructResponseErrorHook } from "../../../../../lib/api/http"
import { auth_check } from "../../../../../lib/public/authservice"
import { getGithubLink, setOwnGithubUsername, clearOwnGithubUsername } from "../../../../../lib/public/usermgmt"

/** Resolves the caller's own contributor id, or a 403 Response when no record backs the login. */
function ownId(request: Request, identity: Identity | undefined): number | Response {
    if (identity === undefined || identity.id === undefined || identity.id === null || identity.id === -1) {
        return constructResponse(request, null, 403, "No contributor record is associated with your login")
    }
    return identity.id
}

/**
 * GET /api/v1/identity/self/github
 * Returns the caller's own GitHub linkage state: { github_username, github_user_id, authorized }
 *
 * Permissions required: github_link (admins always pass)
 *
 * @param context - the Astro API context
 * @returns a Response object
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    const auth_response = auth_check(request, locals.identity, ["github_link"], false)
    if (auth_response !== null) {
        return auth_response
    }
    const id = ownId(request, locals.identity)
    if (id instanceof Response) {
        return id
    }
    try {
        const state = await getGithubLink(id)
        return constructResponse(request, state, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Failed to read your GitHub linkage")
    }
}

/**
 * POST /api/v1/identity/self/github
 * Sets or changes the caller's own GitHub username (write-once until authorized)
 *
 * Permissions required: github_link (admins always pass)
 *
 * Meta: none
 * Body: required, JSON array containing one object of the shape { username: string }
 *
 * @param context - the Astro API context
 * @returns a Response object
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    const auth_response = auth_check(request, locals.identity, ["github_link"], false)
    if (auth_response !== null) {
        return auth_response
    }
    const id = ownId(request, locals.identity)
    if (id instanceof Response) {
        return id
    }
    const api_request = await parseAPIRequest(request)
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, `Bad request: ${api_request.message}`)
    }
    if (!Array.isArray(api_request.payload) || api_request.payload.length !== 1) {
        return constructResponse(request, null, 400, "Bad request: payload must be an array with a single item")
    }
    const item = api_request.payload[0]
    if (typeof item !== "object" || item === null || typeof (item as { username?: unknown }).username !== "string") {
        return constructResponse(request, null, 400, "Bad request: payload item must contain a username string")
    }
    try {
        await setOwnGithubUsername(locals.cfContext, id, (item as { username: string }).username)
        return constructResponse(request, null, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 400, "Failed to set your GitHub username")
    }
}

/**
 * DELETE /api/v1/identity/self/github
 * Clears the caller's own GitHub username (only while the link is not authorized for repository access)
 *
 * Permissions required: github_link (admins always pass)
 *
 * Meta: none
 * Body: none
 *
 * @param context - the Astro API context
 * @returns a Response object
 */
export const DELETE: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    const auth_response = auth_check(request, locals.identity, ["github_link"], false)
    if (auth_response !== null) {
        return auth_response
    }
    const id = ownId(request, locals.identity)
    if (id instanceof Response) {
        return id
    }
    try {
        await clearOwnGithubUsername(locals.cfContext, id)
        return constructResponse(request, null, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 400, "Failed to clear your GitHub username")
    }
}
