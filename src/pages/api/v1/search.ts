/**
 * /pages/api/v1/search.ts
 *
 * Keyword search across the composer, composition, and contributor tables.
 *
 */

import type { APIRoute } from "astro"
import { listComposers, listCompositions, listContributors } from "../../../lib/api/database"
import { searchComposers, searchCompositions, searchContributors, VALID_DATABASES } from "../../../lib/api/search"
import { auth_check } from "../../../lib/public/authservice"
import { parseAPIRequest } from "../../../lib/api/common"
import { constructResponse, constructResponseErrorHook } from "../../../lib/api/http"

/**
 * POST /api/v1/search
 * Runs a ranked keyword search and returns matching records as { database, id, name } hits.
 *
 * Permissions required: none beyond a valid identity (results are only id + name over non-protected
 * columns, so nothing sensitive is exposed)
 *
 * Meta: none
 * Body: required; an array with a single item of the shape
 *   { keyword: string, database?: "composers" | "compositions" | "contributors" | null }
 * When database is null or omitted, all three tables are searched.
 *
 * @param context - the Astro API context
 * @returns the ranked list of hits, or an error message
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity (fail-open, matching the list endpoints)
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request
    const api_request = await parseAPIRequest(request)
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    // the search parameters travel in a single-item payload array
    if (api_request.payload === null || !Array.isArray(api_request.payload) || api_request.payload.length !== 1) {
        return constructResponse(request, null, 400, "Invalid request body: must be an array with a single item")
    }
    const item = api_request.payload[0]
    if (typeof item !== "object" || item === null) {
        return constructResponse(request, null, 400, "Invalid request body: the search item must be an object")
    }
    const keyword = (item as Record<string, unknown>).keyword
    if (typeof keyword !== "string" || keyword.trim() === "") {
        return constructResponse(request, null, 400, "Invalid request body: 'keyword' must be a non-empty string")
    }
    const database_raw = (item as Record<string, unknown>).database
    if (
        database_raw !== undefined &&
        database_raw !== null &&
        !(VALID_DATABASES as string[]).includes(database_raw as string)
    ) {
        return constructResponse(
            request,
            null,
            400,
            `Invalid request body: 'database' must be one of ${VALID_DATABASES.join(", ")} or null`
        )
    }
    const database: SearchDatabase | null =
        database_raw === undefined || database_raw === null ? null : (database_raw as SearchDatabase)
    const query = keyword.trim()
    const want_composers = database === null || database === "composers"
    const want_compositions = database === null || database === "compositions"
    const want_contributors = database === null || database === "contributors"
    try {
        const ctx = context.locals.cfContext
        const results: SearchResult[] = []
        // composer records are needed both for the composers search and to resolve composer names on
        // compositions, so load them once when either is in scope
        let composer_records: ComposerRecord[] | null = null
        if (want_composers || want_compositions) {
            composer_records = await listComposers(ctx)
        }
        if (want_composers && composer_records !== null) {
            results.push(...searchComposers(composer_records, query))
        }
        if (want_compositions) {
            const composition_records = await listCompositions(ctx)
            if (composition_records !== null) {
                const composer_names = new Map<number, string>(
                    (composer_records ?? []).map((record) => [record.id, record.name])
                )
                results.push(...searchCompositions(composition_records, composer_names, query))
            }
        }
        if (want_contributors) {
            const contributor_records = await listContributors(ctx)
            if (contributor_records !== null) {
                results.push(...searchContributors(contributor_records, query))
            }
        }
        return constructResponse(request, results, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}
