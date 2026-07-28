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
import {
    _constructHeaders,
    constructResponse,
    constructResponseErrorHook,
    handleBulkCreate,
    lastModifiedHeader,
    createdAtHeader
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
 * The redaction applied to a build token's read of this collection.
 *
 * A build token is a CI credential with no identity behind it, so it previously received the same
 * complete, unredacted set as an elevated administrator: `identity_email`, `roles` and `admin` for every
 * contributor — every enrolled user's sign-in address and the organisation's whole authorization map.
 * Redaction happened only in the build client (lib/build/d1-api.ts's fetchContributors), which is after
 * the data has crossed the wire, so a leaked build token was a full PII disclosure. Doing it here makes
 * the credential match its description; the client-side pass stays as defense in depth.
 *
 * `active` is deliberately KEPT: the build reads it to decide which contributors get a public page
 * (fetchContributors filters on it, and entity-records.ts resolves references through the all-contributors
 * list), so stripping it here would silently produce a site with no contributor pages at all. It is
 * derived from the schema so a protected column added later is redacted here without a second edit.
 */
const BUILD_TOKEN_SCHEMA = {
    ...CONTRIBUTOR,
    protected: (CONTRIBUTOR.protected ?? []).filter((column) => column !== "active")
}

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
    // build tokens (plan-prelaunch-features.md §2 D9) resolve no identity, so auth_check below would 401
    // them; middleware/identity.ts has already confined a build-token request to exactly this route with
    // GET, so here it only needs the "full" signal enforced before returning the inactive-included set
    // (the build selects which contributors get a public page itself — see BUILD_TOKEN_REDACTED)
    if (locals.buildTokenAuth) {
        const build_request = await parseAPIRequest(request, [])
        if (build_request instanceof Error) {
            return constructResponse(request, null, 400, build_request.message)
        }
        if (build_request.meta?.full !== true) {
            return constructResponse(request, null, 400, "Build token requests require meta 'full': true")
        }
        try {
            const data = await listContributors(context.locals.cfContext)
            if (data === null) {
                return constructResponse(request, null, 500, "Unknown state: list contributor operation returned null")
            }
            const timing_headers = { ...lastModifiedHeader(data), ...createdAtHeader(data) }
            const redacted = data.map((record) => redactProtected(BUILD_TOKEN_SCHEMA, record))
            return constructResponse(request, redacted, 200, undefined, timing_headers)
        } catch (error) {
            console.error(error)
            return constructResponseErrorHook(request, error, 500, "Unknown error")
        }
    }
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
        // the latest change_date/entry_date across the listed records set the collection's freshness
        // headers; redaction only strips protected properties (neither is one), so the values are unaffected
        const timing_headers = { ...lastModifiedHeader(data), ...createdAtHeader(data) }
        switch (api_request.meta?.full) {
            case true:
                if (!auth_enabled) {
                    return constructResponse(request, data, 200, undefined, timing_headers)
                }
                // any viewer may request full records; admins see every record unredacted, while other
                // users see their own record in full and every other record with its protected
                // properties stripped (the same row-level security as GET /contributors/[id])
                if (locals.identity!.admin) {
                    return constructResponse(request, data, 200, undefined, timing_headers)
                }
                const self_id = locals.identity?.id
                const redacted = data.map((record) =>
                    record.id === self_id ? record : redactProtected(CONTRIBUTOR, record)
                )
                return constructResponse(request, redacted, 200, undefined, timing_headers)
            case false:
            case undefined:
                // return contributor IDs only
                const ids = data.map((record) => record.id)
                return constructResponse(request, ids, 200, undefined, timing_headers)
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
