/**
 * /pages/api/v1/works.ts
 *
 * List and create work entries
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
import { _stateTypeAssertCompleteComposition } from "../../../lib/api/composition"
import {
    addComposition,
    addCompositionsBatch,
    attachCompositionNames,
    findCompositionDuplicates,
    listCompositions
} from "../../../lib/api/db_composition"
import { auth_check } from "../../../lib/public/authservice"
import { parseAPIRequest } from "../../../lib/api/common"
import {
    constructResponse,
    constructResponseErrorHook,
    handleBulkCreate,
    lastModifiedHeader,
    createdAtHeader
} from "../../../lib/api/http"
import { canCreate } from "../../../lib/api/authorize"
import { authEnabled } from "../../../lib/api/environment"

/**
 * GET /api/v1/works
 * Returns a list of work IDs, or a list of work records if the "full" query parameter is set to true
 *
 * Permissions required: none
 *
 * Query parameters: optional
 * - full: {boolean} if true, returns full work records; if false or not provided, returns only work IDs
 * - names: {boolean} if true (and full is true), each record is returned as a CompositionWithNames object
 *   ({ object, names }) with the referenced composer and contributor names resolved; off by default
 *
 * Body: none
 *
 * @param context - the Astro API context
 * @returns either a list of IDs or the full records
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    if (locals.buildTokenAuth) {
        const build_request = await parseAPIRequest(request, ["full"])
        if (build_request instanceof Error) {
            return constructResponse(request, null, 400, build_request.message)
        }
        if (build_request.meta?.full !== true) {
            return constructResponse(request, null, 400, "Build token requests require query parameter full=true")
        }
        try {
            const data = await listCompositions(context.locals.cfContext)
            if (data === null) {
                return constructResponse(request, null, 500, "Unknown state: list composition operation returned null")
            }
            return constructResponse(request, data, 200, undefined, {
                ...lastModifiedHeader(data),
                ...createdAtHeader(data)
            })
        } catch (error) {
            return constructResponseErrorHook(request, error, 500, "Unknown error")
        }
    }
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request
    const api_request = await parseAPIRequest(request, ["full", "names"])
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    try {
        const data = await listCompositions(context.locals.cfContext)
        if (data === null) {
            return constructResponse(request, null, 500, "Unknown state: list composition operation returned null")
        }
        // the latest change_date/entry_date across the listed records set the collection's freshness
        // headers (Last-Modified, X-Created-At), sent on every shape (full records, names-enriched, or
        // the ID-only list)
        const timing_headers = { ...lastModifiedHeader(data), ...createdAtHeader(data) }
        if (api_request.meta?.full === true) {
            // full composition records, optionally paired with resolved names
            if (api_request.meta.names === true) {
                return constructResponse(
                    request,
                    await attachCompositionNames(context.locals.cfContext, data),
                    200,
                    undefined,
                    timing_headers
                )
            }
            return constructResponse(request, data, 200, undefined, timing_headers)
        }
        const ids = data.map((record) => record.id)
        return constructResponse(request, ids, 200, undefined, timing_headers)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}

/**
 * POST /api/v1/works
 * Creates one or more work records atomically with the provided data
 *
 * Permissions required: none (but a non-admin may only create compositions on which they are a primary
 * contributor; the CSV import that drives multi-item requests is admin-gated at the page level)
 *
 * Query parameters: optional
 * - bulk: {boolean} required to be true when the body carries more than one item
 * - dry_run: {boolean} if true, validate/authorize/conflict-check every item and return a per-row report
 *   without writing anything (backs the import preview)
 *
 * Body: required, Composition[] (1..MAX_BULK_ITEMS items)
 * Response: a single item returns 201 + Location (unchanged); multiple items return 201 with the id array
 *
 * @param context - the Astro API context
 * @returns the created record id(s), a per-row dry-run report, or an error
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    const api_request = await parseAPIRequest(request, ["bulk", "dry_run"])
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    // a non-admin may only create compositions on which they are themselves a primary contributor; admins
    // may name any registered users as primaries. Skipped where auth is disabled (e.g. development).
    const enforce_ownership = authEnabled(request)
    return handleBulkCreate<Composition>(request, api_request, {
        validate: (item) => _stateTypeAssertCompleteComposition(item, false),
        authorize: (record) =>
            enforce_ownership && !canCreate(record, locals.identity!)
                ? "Forbidden: you must be a primary contributor on compositions you create"
                : null,
        detectConflicts: (records) =>
            findCompositionDuplicates(
                context.locals.cfContext,
                records.map((record) => ({ composer_id: record.composer_id, name: record.name, part: record.part }))
            ),
        commitOne: (record) => addComposition(context.locals.cfContext, record),
        commitBatch: (records) => addCompositionsBatch(context.locals.cfContext, records),
        location: (id) => `/api/v1/works/${id}`
    })
}
