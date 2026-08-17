/**
 * /api/v1/tokens/[id]
 *
 * Revokes a specific user-scoped API token
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
import { constructResponse, constructResponseErrorHook } from "../../../../lib/api/http"
import { auth_check } from "../../../../lib/public/authservice"
import { getApiTokenOwner, revokeApiToken } from "../../../../lib/api/tokens"

/**
 * DELETE /api/v1/tokens/[id]
 * Revokes a token
 *
 * Permissions required: none (self); *admin* to revoke another contributor's token
 *
 * Meta: none
 * Body: none
 *
 * @param context - the Astro API context
 * @returns a Response object
 */
export const DELETE: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    if (locals.tokenAuth) {
        return constructResponse(request, null, 403, "Forbidden: token-authenticated requests cannot manage tokens")
    }
    const state_id = Number(params.id)
    if (isNaN(state_id)) {
        return constructResponse(request, null, 400, "Invalid token ID: must be a number")
    }
    try {
        const owner_id = await getApiTokenOwner(state_id)
        if (owner_id === null) {
            return constructResponse(request, null, 404)
        }
        if (owner_id !== locals.identity!.id && !locals.identity!.admin) {
            return constructResponse(request, null, 403, "Forbidden: you may only revoke your own tokens")
        }
        await revokeApiToken(state_id, Date.now())
        return constructResponse(request, null, 204)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Failed to revoke API token")
    }
}
