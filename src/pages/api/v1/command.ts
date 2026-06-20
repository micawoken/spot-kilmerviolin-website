/**
 * pages/api/v1/command.ts
 *
 * Provides administrators a direct connection to the sqlite database
 *
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
import { parseAPIRequest } from "../../../lib/api/common"
import { auth_check } from "../../../lib/public/authservice"
import { constructResponse, constructResponseErrorHook } from "../../../lib/api/http"
import { exec_string, exec_string_batch, exec_string_sequential } from "../../../lib/api/d1"

/**
 * POST /api/v1/command
 * Executes one or more SQL command strings on the D1 database and returns the result(s)
 *
 * Permissions required: *admin*
 *
 * Meta: optional; `batch` (boolean, default true). When more than one command is supplied they are run
 *   as a single atomic transaction so a failure rolls back the whole set. Setting `batch` to false runs
 *   the commands sequentially as independent statements (no rollback). The flag is irrelevant for a
 *   single command.
 * Body: required, JSON array of one or more SQL command strings
 *
 * @param context - the Astro API context
 * @returns a Response object whose payload is the single D1Result for one command, or an array of
 *   D1Results (one per command, in order) for multiple commands; or an error message if execution fails
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], true)
    if (auth_response !== null) {
        return auth_response
    }
    // parse request; an empty meta_expect_keys list parses the meta header when present without requiring it
    const api_request = await parseAPIRequest(request, [])
    if (api_request instanceof Error) {
        return constructResponse(request, { error: api_request.message }, 400)
    }
    if (
        api_request.payload === null ||
        api_request.payload.length < 1 ||
        !api_request.payload.every((command) => typeof command === "string")
    ) {
        return constructResponse(
            request,
            { error: "Bad request: payload must be a non-empty list of SQL command strings" },
            400
        )
    }
    const commands = api_request.payload as string[]
    // batch defaults to true; only an explicit false disables the atomic-transaction behavior
    const batch = api_request.meta?.batch !== false
    // execute command(s)
    try {
        if (commands.length === 1) {
            // a single command needs no batching; return the bare D1Result for backward compatibility
            const exec_result = await exec_string(commands[0])
            return constructResponse(request, exec_result, 200)
        }
        const exec_results = batch ? await exec_string_batch(commands) : await exec_string_sequential(commands)
        return constructResponse(request, exec_results, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 400, "Failed to execute SQL command")
    }
}
