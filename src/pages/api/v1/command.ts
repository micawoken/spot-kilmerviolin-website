/**
 * pages/api/v1/command.ts
 * 
 * Provides administrators a direct connection to the sqlite database
 * 
 * 
 */

import type { APIRoute } from "astro"
import { parseAPIRequest } from "../../../lib/api/common"
import { auth_check } from "../../../lib/public/authservice"
import { constructResponse, constructResponseErrorHook } from "../../../lib/api/http"
import { exec_string } from "../../../lib/api/d1.ts"


/**
 * POST /api/v1/command
 * Executes a string SQL command on the D1 database and returns the result
 * 
 * Permissions required: *admin*
 * 
 * Meta: none
 * Body: required, JSON array of [command: string]
 * 
 * @param {APIContext} context - the Astro API context
 * @returns {Response} a Response object with payload of the result of the SQL command, or an error message if execution fails
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], true)
    if (auth_response !== null) {
        return auth_response
    }
    // parse request
    const api_request = await parseAPIRequest(request)
    if (api_request instanceof Error) {
        return constructResponse(request, { error: api_request.message }, 400)
    }
    if (api_request.payload === null || api_request.payload.length !== 1 || typeof api_request.payload[0] !== "string") {
        return constructResponse(request, { error: "Bad request: payload must be a list containing exactly one SQL command string" }, 400)
    }
    const command = api_request.payload[0]
    // execute command
    try {
        const exec_result = await exec_string(command)
        return constructResponse(request, exec_result, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 400, "Failed to execute SQL command")
    }
}