/**
 * pages/api/v1/composers.ts
 *
 * Returns a list of composer records
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
import { _stateTypeAssertCompleteComposer } from "../../../lib/api/d1"
import {
    addComposer,
    addComposersBatch,
    listComposers,
    findComposerNameConflicts
} from "../../../lib/api/database"
import { auth_check } from "../../../lib/public/authservice"
import { parseAPIRequest } from "../../../lib/api/common"
import { constructResponse, constructResponseErrorHook, handleBulkCreate, lastModifiedHeader } from "../../../lib/api/http"

/**
 * GET /api/v1/composers
 * Returns a list of composer IDs, or a list of composer records if the "full" query parameter is set to true
 *
 * Permissions required: none
 *
 * Meta: optional
 * Meta fields:
 * - full: {boolean} if true, returns full composer records; if false or not provided, returns only composer IDs
 *
 * Body: none
 *
 * @param context - the Astro API context
 * @return either a list of IDs or the full records
 *
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request
    const api_request = await parseAPIRequest(request, [])
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    try {
        const data = await listComposers(context.locals.cfContext)
        if (data === null) {
            return constructResponse(request, null, 500, "Unknown state: list composer operation returned null")
        }
        // the latest change_date across the listed records is the collection's last-modified time
        const last_modified = lastModifiedHeader(data)
        switch (api_request.meta?.full) {
            case true:
                // return full composer records
                return constructResponse(request, data, 200, undefined, last_modified)
            case false:
            case undefined:
                // return composer IDs only
                const ids = data.map((record) => record.id)
                return constructResponse(request, ids, 200, undefined, last_modified)
            default:
                return constructResponse(request, null, 400, "Invalid value for meta field 'full': must be a boolean")
        }
    } catch (error) {
        console.error("Error in GET /api/v1/composers:", error)
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}

/**
 * POST /api/v1/composers
 * Adds one or more composer records atomically, returning the new id(s)
 *
 * Permissions required: none
 *
 * Meta: optional
 * Meta fields:
 * - bulk: {boolean} required to be true when the body carries more than one item (a single item needs no signal)
 * - dry_run: {boolean} if true, validate every item and return a per-row report without writing anything
 *
 * Body: required, Composer[] (1..MAX_BULK_ITEMS items)
 * Response: a single item returns 201 + Location (unchanged); multiple items return 201 with the id array
 *
 * @param context - the Astro API context
 * @return a Response object with the ID(s) of the new record(s), or an error
 *
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request (meta parsed so the bulk/dry_run signals are honored)
    const api_request = await parseAPIRequest(request, [])
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    return handleBulkCreate<Composer>(request, api_request, {
        validate: (item) => _stateTypeAssertCompleteComposer(item, false),
        detectConflicts: (records) =>
            findComposerNameConflicts(
                context.locals.cfContext,
                records.map((record) => ({ name: record.name }))
            ),
        commitOne: (record) => addComposer(context.locals.cfContext, record),
        commitBatch: (records) => addComposersBatch(context.locals.cfContext, records),
        location: (id) => `/api/v1/composers/${id}`
    })
}
