/**
 * pages/api/v1/contributors.ts
 *
 * Manages contributor records used for identifying project contributors and system authorization
 *
 * Note: this is not the intended endpoint for adding or removing contributors.
 *  - Add: POST /api/v1/identity with autoenrollment enabled
 *  - Remove: DELETE /api/v1/identity with autodeactivation enabled
 *
 * These two endpoints in this file provide full management of the contributor table by administrators.
 *
 * Since the contributors table is used for security-relevant operations,
 * most API endpoints default to least-privileged access and include a meta field
 * to request elevated access if authorized.
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
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
import {
    _constructHeaders,
    constructResponse,
    constructResponseErrorHook,
    handleBulkCreate,
    lastModifiedHeader
} from "../../../lib/api/http"
import { auth_check } from "../../../lib/public/authservice"
import {
    addContributor,
    addContributorsBatch,
    listContributors,
    findContributorNameConflicts
} from "../../../lib/api/database"
import { _stateTypeAssertCompleteContributor, CONTRIBUTOR, redactProtected } from "../../../lib/api/d1"
import { authEnabled } from "../../../lib/api/environment"
import { resolveIdentityEmail } from "../../../lib/api/fallback"

/**
 * GET /api/v1/contributors
 * Returns a list of contributor IDs, or the complete records if requested
 *
 * Permissions required: none. The full records are available to any viewer, but the same row-level
 * security as GET /api/v1/contributors/[id] applies: protected properties (CONTRIBUTOR.protected) are
 * redacted from every record that is not the requester's own, unless the requester is an admin.
 *
 * Meta: optional
 * Meta fields:
 *  - full: {boolean} if true, returns the full contributor records (subject to redaction) instead of just IDs
 *
 * Body: none
 *
 * @param context - the Astro API context
 * @returns a Response object with payload of string[] of contributor IDs or D1Contributor[] of complete contributor records
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    // returns JSON as an API response
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    // admin status will be re-checked once meta is processed
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request
    const api_request = await parseAPIRequest(request, [])
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    try {
        const data = await listContributors(context.locals.cfContext)
        if (data === null) {
            return constructResponse(request, null, 500, "Unknown state: list contributor operation returned null")
        }
        const auth_enabled: boolean = authEnabled(request)
        // the latest change_date across the listed records is the collection's last-modified time;
        // redaction only strips protected properties (change_date is not one), so the value is unaffected
        const last_modified = lastModifiedHeader(data)
        switch (api_request.meta?.full) {
            case true:
                if (!auth_enabled) {
                    return constructResponse(request, data, 200, undefined, last_modified)
                }
                // any viewer may request full records; admins see every record unredacted, while other
                // users see their own record in full and every other record with its protected
                // properties stripped (the same row-level security as GET /contributors/[id])
                if (locals.identity!.admin) {
                    return constructResponse(request, data, 200, undefined, last_modified)
                }
                const self_id = locals.identity?.id
                const redacted = data.map((record) =>
                    record.id === self_id ? record : redactProtected(CONTRIBUTOR, record)
                )
                return constructResponse(request, redacted, 200, undefined, last_modified)
            case false:
            case undefined:
                // return contributor IDs only
                const ids = data.map((record) => record.id)
                return constructResponse(request, ids, 200, undefined, last_modified)
            default:
                return constructResponse(request, null, 400, "Invalid value for meta field 'full': must be boolean")
        }
    } catch (error) {
        console.error(error)
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}

/**
 * POST /api/v1/contributors
 * Adds one or more contributor records atomically, used for the administrator pages and CSV import
 *
 * Permissions required: *admin*
 *
 * Meta: optional
 * Meta fields:
 * - bulk: {boolean} required to be true when the body carries more than one item
 * - dry_run: {boolean} if true, validate every item and return a per-row report without writing anything
 *
 * Body: required, Contributor[] (1..MAX_BULK_ITEMS items)
 * Response: a single item returns 201 + Location (unchanged); multiple items return 201 with the id array
 *
 * @param context - the Astro API context
 * @return a Response object with the ID(s) of the new record(s), or an error
 *
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity (admin only)
    const auth_response = auth_check(request, locals.identity, [], true)
    if (auth_response !== null) {
        return auth_response
    }
    // pull the payload (meta parsed so the bulk/dry_run signals are honored)
    const api_request = await parseAPIRequest(request, [])
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    return handleBulkCreate<Contributor>(request, api_request, {
        validate: (item) => {
            // a blank/omitted identity_email is replaced with a generated fallback address (see
            // lib/api/fallback.ts) so a contributor with no real sign-in email still satisfies the
            // identity_email NOT NULL UNIQUE constraint; an invalid name is left to fail the assertion
            if (item !== null && typeof item === "object" && typeof (item as any).name === "string") {
                ;(item as any).identity_email = resolveIdentityEmail((item as any).identity_email, (item as any).name)
            }
            return _stateTypeAssertCompleteContributor(item, false)
        },
        detectConflicts: (records) =>
            findContributorNameConflicts(
                context.locals.cfContext,
                records.map((record) => ({ name: record.name }))
            ),
        commitOne: (record) => addContributor(context.locals.cfContext, record),
        commitBatch: (records) => addContributorsBatch(context.locals.cfContext, records),
        location: (id) => `/api/v1/contributors/${id}`
    })
}
