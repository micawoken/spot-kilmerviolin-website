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
 */

import type { APIRoute } from "astro"
import { parseAPIRequest } from "../../../lib/api/common"
import { _constructHeaders, constructResponse, constructResponseErrorHook, lastModifiedHeader } from "../../../lib/api/http"
import { auth_check } from "../../../lib/public/authservice"
import { addContributor, listContributors } from "../../../lib/api/database"
import { _stateTypeAssertCompleteContributor, CONTRIBUTOR } from "../../../lib/api/d1"
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
                const redacted = data.map(record =>
                    record.id === self_id
                        ? record
                        : Object.fromEntries(Object.entries(record).filter(([key]) => !CONTRIBUTOR.protected!.includes(key)))
                )
                return constructResponse(request, redacted, 200, undefined, last_modified)
            case false:
            case undefined:
                // return contributor IDs only
                const ids = data.map(record => record.id)
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
 * Adds a contributor record by API request, used for the administrator pages
 * 
 * Permissions required: *admin*
 * 
 * Meta: none
 * Body: required, Contributor object
 * 
 * @param context - the Astro API context
 * @return a Response object with the ID of the new record, or an error
 * 
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], true)
    if (auth_response !== null) {
        return auth_response
    }
    // pull the payload
    const api_request = await parseAPIRequest(request)
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    // check if the payload is not null and has a length of 1
    if (api_request.payload === null || !Array.isArray(api_request.payload) || api_request.payload.length !== 1) {
        return constructResponse(request, null, 400, "Invalid request body: must be an array with a single item")
    }
    // a blank/omitted identity_email is replaced with a generated fallback address (see lib/api/fallback.ts)
    // so a contributor with no real sign-in email still satisfies the identity_email NOT NULL UNIQUE
    // constraint; an invalid name is left to fail the type assertion below
    const raw = api_request.payload[0]
    if (raw !== null && typeof raw === "object" && typeof raw.name === "string") {
        raw.identity_email = resolveIdentityEmail(raw.identity_email, raw.name)
    }
    // validate the payload as a complete contributor record
    const record: Contributor | string = _stateTypeAssertCompleteContributor(raw, false)
    if (typeof record === "string") {
        return constructResponse(request, null, 400, `Invalid request body: ${record}`)
    }
    // create the contributor record and return the new ID
    try {
        const id = await addContributor(context.locals.cfContext, record)
        return constructResponse(request, null, 201, undefined, {
                "Location": `/api/v1/contributors/${id}`
            }
        )
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}