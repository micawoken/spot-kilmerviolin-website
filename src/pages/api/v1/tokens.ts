/**
 * /pages/api/v1/tokens.ts
 *
 * Issues and lists user-scoped API tokens
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
import { parseAPIRequest } from "../../../lib/api/common"
import { constructResponse, constructResponseErrorHook } from "../../../lib/api/http"
import { auth_check } from "../../../lib/public/authservice"
import {
    EXPIRY_WINDOWS_DAYS,
    isValidExpiryWindow,
    expiryWindowMs,
    generateApiTokenSecret,
    hashToken,
    insertApiToken,
    listAllApiTokens,
    listApiTokensForContributor
} from "../../../lib/api/tokens"

/**
 * GET /api/v1/tokens
 * Lists the caller's own API tokens, or every token issued to any contributor when meta.all is true
 *
 * Permissions required: none (self); *admin* for meta.all
 *
 * Meta: optional
 * Meta fields:
 *  - all: {boolean} if true, list every issued token instead of only the caller's own; admin only
 *
 * Body: none
 * Response: an array of token metadata (id, contributor_id, label, token_prefix, entry_date, expires_date,
 * revoked_date) - the token_hash and plaintext secret are never included
 *
 * @param context - the Astro API context
 * @returns a Response object
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    if (locals.tokenAuth) {
        return constructResponse(request, null, 403, "Forbidden: token-authenticated requests cannot manage tokens")
    }
    const api_request = await parseAPIRequest(request, [])
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    const all_flag = api_request.meta?.all
    if (all_flag !== undefined && typeof all_flag !== "boolean") {
        return constructResponse(request, null, 400, "Invalid value for meta field 'all': must be a boolean")
    }
    try {
        if (all_flag === true) {
            if (!locals.identity!.admin) {
                return constructResponse(request, null, 403, "Forbidden: meta field 'all' requires admin")
            }
            return constructResponse(request, await listAllApiTokens(), 200)
        }
        return constructResponse(request, await listApiTokensForContributor(locals.identity!.id), 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}

/**
 * POST /api/v1/tokens
 * Issues a new API token to the caller
 *
 * Permissions required: none
 *
 * Meta: none
 * Body: required, JSON array containing one object of the shape
 *  { label: string, expiry_days: 7 | 30 | 180 | 365 }
 * Response: 201 with { id, secret, label, token_prefix, entry_date, expires_date } - secret is the
 * plaintext token, shown exactly this once; it is never recoverable afterward
 *
 * @param context - the Astro API context
 * @returns a Response object
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    if (locals.tokenAuth) {
        return constructResponse(request, null, 403, "Forbidden: token-authenticated requests cannot manage tokens")
    }
    const api_request = await parseAPIRequest(request)
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, `Bad request: ${api_request.message}`)
    }
    if (!Array.isArray(api_request.payload) || api_request.payload.length !== 1) {
        return constructResponse(request, null, 400, "Bad request: payload must be an array with a single item")
    }
    const item = api_request.payload[0]
    if (typeof item !== "object" || item === null) {
        return constructResponse(request, null, 400, "Bad request: payload must be a JSON object")
    }
    const { label, expiry_days } = item as { label?: unknown; expiry_days?: unknown }
    if (typeof label !== "string" || label.trim().length === 0) {
        return constructResponse(request, null, 400, "Bad request: label must be a non-empty string")
    }
    if (!isValidExpiryWindow(expiry_days)) {
        return constructResponse(
            request,
            null,
            400,
            `Bad request: expiry_days must be one of ${EXPIRY_WINDOWS_DAYS.join(", ")}`
        )
    }
    try {
        const { secret, prefix } = generateApiTokenSecret()
        const token_hash = await hashToken(secret)
        const entry_date = Date.now()
        const expires_date = entry_date + expiryWindowMs(expiry_days)
        const id = await insertApiToken({
            contributor_id: locals.identity!.id,
            label,
            token_hash,
            token_prefix: prefix,
            entry_date,
            expires_date
        })
        return constructResponse(request, { id, secret, label, token_prefix: prefix, entry_date, expires_date }, 201)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Failed to issue API token")
    }
}
