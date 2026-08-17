/**
 * lib/api/http.ts
 *
 * Provides functions related to creating HTTP Response objects for the API
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

import { env } from "cloudflare:workers"
import { createAPIPayload, sanitizeInputStrings } from "./common"
import { richErrors, isActiveRequestDev } from "./environment"
import { ALLOWED_ORIGINS } from "../../consts"
import { checkSQLiteErrorHook, convertSQLiteError, isMissingTableError, missingTableName } from "./sqlite_error"

// generic error HTTP
import error_http from "../templates/error.html?raw"

// headers

// headers are added to static and dynamic pages through the Astro middleware at build time and at request

export const static_headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, maxage=86400, s-maxage=604800, stale-while-revalidate=604800, must-understand",
    Allow: "GET, OPTIONS",
    Vary: "Origin"
}

/**
 * Header template for raw (non-JSON) body responses, intended for file delivery
 */
export const file_headers = {
    "Content-Type": undefined,
    "Content-Disposition": undefined,
    "Cache-Control": undefined,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Access-Control-Allow-Origin": undefined,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin"
}

export const error_headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, must-understand",
    Allow: "GET, OPTIONS",
    Vary: "Origin"
}

/**
 * Applied to pages that do not need CORS requests
 *
 */
export const preflight_closed_headers = {
    "Access-Control-Allow-Origin": undefined,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Credentials": "false",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin"
}

/**
 * Used on non-API authenticated routes to allow credential access but not full CORS access
 * (intended for admin pages)
 */
export const preflight_limited_headers = {
    "Access-Control-Allow-Origin": undefined,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    Vary: "Origin"
}

/**
 * Used on API routes to grant clients greater access to the HTTP API
 *
 */
export const preflight_headers = {
    "Access-Control-Allow-Origin": undefined, // also must be generated
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-MWMSC-Request-Meta",
    Vary: "Origin"
}

/**
 * Resolves the value to send in Access-Control-Allow-Origin for a request.
 *
 * @param {Request} request - the original Request object
 * @returns {string} the Origin to echo (when allowlisted) or the fallback origin (WORKER_ORIGIN, this
 *   worker's own origin - see wrangler.jsonc)
 */
export function resolveAllowedOrigin(request: Request): string {
    const origin = request.headers.get("Origin")
    if (origin) {
        try {
            if (ALLOWED_ORIGINS.includes(new URL(origin).origin)) {
                return origin
            }
        } catch {
            // malformed Origin header; fall through to the fallback
        }
    }
    return env.WORKER_ORIGIN
}

/**
 * Safe HTTP methods (cannot modify server state, do not need CSRF protection)
 */
const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Whether a state-changing request fails the same-origin (CSRF) check
 *
 * Runs whenever a cookie (specifically, the CF_Authorization cookie) is used to authenticate with the system
 *
 * Checks the fetch metadata to see if the request's initiator is cross-site or if the Origin header is not allowlisted
 *
 * NOTE: CSRF protection is origin-wide (not site-wide); mixing www and non-www versions will cause this check to fail
 *
 * @param {Request} request - the original Request object
 * @returns {boolean} true if the request should be rejected as a cross-site (CSRF) attempt
 */
export function failsCsrfOriginCheck(request: Request): boolean {
    if (CSRF_SAFE_METHODS.has(request.method)) {
        return false
    }
    const fetch_site = request.headers.get("Sec-Fetch-Site")
    // an explicit cross-site (or same-site-but-cross-origin) initiator is rejected outright
    if (fetch_site === "cross-site" || fetch_site === "same-site") {
        return true
    }
    const origin = request.headers.get("Origin")
    if (origin === null) {
        // no Origin on a state-changing request: accept only when Fetch Metadata attests same-origin,
        // otherwise treat the absence as suspect (a same-origin browser write always sends an Origin)
        return fetch_site !== "same-origin"
    }
    try {
        return !ALLOWED_ORIGINS.includes(new URL(origin).origin)
    } catch {
        // malformed Origin header
        return true
    }
}

/**
 * The default headers applied to API responses, with some undefined values that must be generated per-request
 */
export const API_headers = {
    "Content-Type": "application/json",
    "Cache-Control": "private, no-store, must-understand",
    "Access-Control-Allow-Origin": undefined,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    // Last-Modified is CORS-safelisted and needs no entry here; X-Created-At is a custom header and is
    // invisible to cross-origin fetch() callers unless explicitly exposed
    "Access-Control-Expose-Headers": "X-Created-At",
    Allow: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    Vary: "Origin"
}

/**
 * Content types that are safe to serve inline (everything else is downloaded)
 */
export const INLINE_SAFE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]

/**
 * Maximum number of items a single bulk create request may carry. Bounds the size of an atomic D1 batch
 * (and the work done validating/committing it) while comfortably covering a realistic CSV upload.
 */
export const MAX_BULK_ITEMS = 999

/**
 * HTTP status codes used in constructResponse()
 */
/**
 * The status codes `constructResponse`/`constructErrorPage` accept. Exported so sqlite_error.ts can name
 * the code it resolves to without redeclaring the table - a type-only dependency, so the runtime import
 * edge between the two modules stays one-way (http.ts -> sqlite_error.ts).
 */
export type HttpStatus = keyof typeof http_codes

const http_codes = {
    200: {
        success: true,
        statusText: "OK",
        comment: "",
        body: true
    },
    201: {
        success: true,
        statusText: "Created",
        comment: "",
        body: true
    },
    204: {
        success: true,
        statusText: "No Content",
        comment: "",
        body: false
    },
    400: {
        success: false,
        statusText: "Bad Request",
        comment: "The request was malformed or invalid",
        body: true
    },
    401: {
        success: false,
        statusText: "Unauthorized",
        comment: "The request did not include valid authentication credentials",
        body: true
    },
    403: {
        success: false,
        statusText: "Forbidden",
        comment: "The authenticated user does not have permission to access this resource",
        body: true
    },
    404: {
        success: false,
        statusText: "Not Found",
        comment: "The requested resource does not exist",
        body: true
    },
    405: {
        success: false,
        statusText: "Method Not Allowed",
        comment: "The requested HTTP method is not supported by this endpoint",
        body: true
    },
    409: {
        success: false,
        statusText: "Conflict",
        comment: "The request could not be completed due to a conflict with the current state of the resource",
        body: true
    },
    413: {
        success: false,
        statusText: "Content Too Large",
        comment: "The uploaded file exceeds the maximum permitted size",
        body: true
    },
    415: {
        success: false,
        statusText: "Unsupported Media Type",
        comment: "The uploaded file's content type is not accepted",
        body: true
    },
    429: {
        success: false,
        statusText: "Too Many Requests",
        comment: "Too many requests have been sent to the server. Please try again in a minute.",
        body: true
    },
    500: {
        success: false,
        statusText: "Internal Server Error",
        comment: "An unexpected error occurred on the server",
        body: true
    },
    501: {
        success: false,
        statusText: "Not Implemented",
        comment: "The requested HTTP method is not supported by this endpoint",
        body: true
    },
    503: {
        success: false,
        statusText: "Service Unavailable",
        comment: "The service is temporarily unavailable, please try again later.",
        body: true
    },
    507: {
        success: false,
        statusText: "Insufficient Storage",
        comment: "The file store is full and cannot accept the upload. Remove existing files and try again.",
        body: true
    }
}

/**
 * Constructs a HeaderInit object based on the template, a completion object, and an additional headers object
 *
 * @param {Record<string, string | undefined>} template - the template to use
 * @param {Record<string, string>} complete - an object containing the missing values from the template
 * @param {Record<string, string>} additional - an object containing additional headers to add to the result
 * @returns {Record<string, string>} a complete set of headers based on the template and additional headers
 * @throws {Error} if the complete object does not contain values for all undefined keys in the template
 */
export function _constructHeaders(
    template: Record<string, string | undefined>,
    complete: Record<string, string>,
    additional: Record<string, string> = {}
): Record<string, string> {
    // assert that each undefined key is mapped in complete
    Object.keys(template)
        .filter((key) => template[key] === undefined)
        .forEach((key) => {
            if (!(key in complete)) {
                throw new Error(`Missing value for header key: ${key}`)
            }
        })
    return { ...template, ...complete, ...additional } as Record<string, string>
}

/**
 * Recursively collects the change_date timestamps (as epoch milliseconds) carried by an API payload.
 *
 * @param {unknown} value - the payload (or a nested fragment of it) to scan
 * @param {number[]} out - accumulator of parsed epoch-millisecond timestamps
 */
function collectChangeDates(value: unknown, out: number[]): void {
    if (value === null || typeof value !== "object") {
        return
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectChangeDates(item, out)
        }
        return
    }
    const record = value as Record<string, unknown>
    // a CompositionWithNames wrapper keeps the entity record (which carries change_date) under "object"
    if (record.object !== undefined && record.object !== null && typeof record.object === "object") {
        collectChangeDates(record.object, out)
    }
    if (typeof record.change_date === "number") {
        out.push(record.change_date)
    }
}

/**
 * Builds a Last-Modified header from the entity record(s) in an API payload using the change_date
 *
 * @param {unknown} payload - the API payload being returned (a record, array of records, or names wrapper)
 * @returns {Record<string, string>} a { "Last-Modified": <HTTP-date> } header, or {} when none applies
 */
export function lastModifiedHeader(payload: unknown): Record<string, string> {
    const timestamps: number[] = []
    collectChangeDates(payload, timestamps)
    if (timestamps.length === 0) {
        return {}
    }
    // Last-Modified must be an RFC 7231 HTTP-date; toUTCString() produces the required IMF-fixdate form
    return { "Last-Modified": new Date(Math.max(...timestamps)).toUTCString() }
}

/**
 * Recursively collects the entry_date timestamps (as epoch milliseconds) carried by an API payload.
 *
 * @param {unknown} value - the payload (or a nested fragment of it) to scan
 * @param {number[]} out - accumulator of parsed epoch-millisecond timestamps
 */
function collectEntryDates(value: unknown, out: number[]): void {
    if (value === null || typeof value !== "object") {
        return
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectEntryDates(item, out)
        }
        return
    }
    const record = value as Record<string, unknown>
    // a CompositionWithNames wrapper keeps the entity record (which carries entry_date) under "object"
    if (record.object !== undefined && record.object !== null && typeof record.object === "object") {
        collectEntryDates(record.object, out)
    }
    if (typeof record.entry_date === "number") {
        out.push(record.entry_date)
    }
}

/**
 * Builds an X-Created-At header from the entity record(s) in an API payload using the entry_date. For a
 * collection, the most recently created record's entry_date is used, mirroring lastModifiedHeader's use
 * of the most recent change_date.
 *
 * @param {unknown} payload - the API payload being returned (a record, array of records, or names wrapper)
 * @returns {Record<string, string>} a { "X-Created-At": <HTTP-date> } header, or {} when none applies
 */
export function createdAtHeader(payload: unknown): Record<string, string> {
    const timestamps: number[] = []
    collectEntryDates(payload, timestamps)
    if (timestamps.length === 0) {
        return {}
    }
    return { "X-Created-At": new Date(Math.max(...timestamps)).toUTCString() }
}

/**
 * Constructs a Response object for the API
 *
 * @param {Request} request - the original Request object, used to generate CORS headers
 * @param {any} payload - the payload to include in the response body;
 * @param {keyof typeof http_codes} code - the HTTP status code to use for the response
 * @param {string} [force_comment] - if provided, this string will be used as the comment in the response body instead of the default comment for the status code
 * @param {Record<string, string>} [headers_addl] - additional headers to include in the response, merged with the default API headers;
 * @returns {Response} a Response object
 * @throws {Error} if payload serialization fails or if required headers are missing
 */
export function constructResponse(
    request: Request,
    payload: any,
    code: keyof typeof http_codes,
    force_comment?: string | undefined,
    headers_addl?: Record<string, string>
): Response {
    const { success, statusText, comment } = http_codes[code]
    const headers = _constructHeaders(
        API_headers,
        {
            "Access-Control-Allow-Origin": resolveAllowedOrigin(request)
        },
        headers_addl ? headers_addl : {}
    )
    let response_body: string | null
    try {
        response_body = http_codes[code].body
            ? JSON.stringify(createAPIPayload(success, payload, force_comment !== undefined ? force_comment : comment))
            : null
    } catch (e) {
        throw new Error(`Failed to serialize response payload: ${e}`)
    }
    return new Response(response_body, {
        status: code,
        statusText: statusText,
        headers: headers
    })
}

/**
 * Constructs a 200 Response carrying a raw (non-JSON) body, such as a file's bytes served from the store
 *
 * @param {Request} request - the original Request object, used to generate CORS headers
 * @param {BodyInit} body - the raw response body (e.g. the file bytes)
 * @param {string} content_type - the Content-Type to advertise for the body
 * @param {number} cache_ttl - the max-age, in seconds, applied to the private Cache-Control directive
 * @param {Record<string, string>} [headers_addl] - additional headers merged over the defaults
 * @returns {Response} a 200 Response carrying the raw body
 */
export function constructFileResponse(
    request: Request,
    body: BodyInit,
    content_type: string,
    cache_ttl: number,
    headers_addl?: Record<string, string>
): Response {
    // serve inline only for raster image types (safe to render); anything else (SVG, HTML, octet-stream)
    // is forced to download so a viewer's browser never renders attacker-supplied active content on-origin
    const base_type = content_type.split(";")[0].trim().toLowerCase()
    const disposition = INLINE_SAFE_CONTENT_TYPES.includes(base_type) ? "inline" : "attachment"
    const headers = _constructHeaders(
        file_headers,
        {
            "Content-Type": content_type,
            "Content-Disposition": disposition,
            "Cache-Control": `private, max-age=${cache_ttl}, must-understand`,
            "Access-Control-Allow-Origin": resolveAllowedOrigin(request)
        },
        headers_addl ? headers_addl : {}
    )
    return new Response(body, {
        status: 200,
        statusText: "OK",
        headers: headers
    })
}

/**
 * End-to-end response constructor with the error hook
 *
 * @param {Request} request - the original Request object, used to generate CORS headers and for error processing
 * @param {any} error - the error to process
 * @param {keyof typeof http_codes} code - the default HTTP status code
 * @param {string} [force_comment] - if provided, this string will be used as the comment in the response body instead of the default comment for the status code
 * @returns {Response} a Response object
 */
export function constructResponseErrorHook(
    request: Request,
    error: any,
    code: keyof typeof http_codes,
    force_comment?: string | undefined
): Response {
    if (checkSQLiteErrorHook(error)) {
        return hookSQLiteError(request, error)
    }
    return constructResponse(
        request,
        null,
        code,
        richErrors(request) && !force_comment ? `Error: ${error.message}` : force_comment
    )
}

/**
 * Per-entity behavior injected into {@link handleBulkCreate}. Keeping the create contract (envelope
 * checks, the bulk signal gate, per-item validation, the dry-run report, and the single-vs-many response
 * shape) in one place means the composers/contributors/works endpoints cannot drift apart; only the parts
 * that genuinely differ (which validator, which authorization rule, which conflict check, how to commit,
 * and the Location path) are supplied per endpoint.
 */
export interface BulkCreateHandlers<T> {
    /** Validate/type-assert one raw item; return the typed record, or an error string. */
    validate: (item: unknown) => T | string
    /** Optional per-record authorization (e.g. works' canCreate); return an error message (->403) or null. */
    authorize?: (record: T, index: number) => string | null
    /**
     * Optional conflict detection across the whole valid set (e.g. composition (composer, name) duplicates).
     * Receives the valid records in payload order and returns issues indexed into that same array.
     */
    detectConflicts?: (records: T[]) => Promise<Array<{ index: number; message: string }>>
    /** Commit exactly one record, returning its new id (used for the single-item, backward-compatible path). */
    commitOne: (record: T) => Promise<number>
    /** Commit many records in one atomic transaction, returning their new ids in order. */
    commitBatch: (records: T[]) => Promise<number[]>
    /** Build the Location header path for a newly created id (single-item responses only). */
    location: (id: number) => string
}

/**
 * Shared implementation of the bulk-capable create endpoints (POST composers/contributors/works).
 *
 * Contract:
 * - The body must be a non-empty array of at most {@link MAX_BULK_ITEMS} items.
 * - A request carrying more than one item must set the `bulk` meta signal (`meta.bulk = true`); a single
 *   item needs no signal and keeps the original response shape (201 + Location header), so existing
 *   single-record callers are unaffected.
 * - The `dry_run` meta flag (`meta.dry_run = true`) validates, authorizes, and conflict-checks every row
 *   and returns a per-row report **without writing anything** - this backs the import preview.
 * - On commit, every item is validated (400 with per-index errors on any failure), authorized (403), and
 *   conflict-checked (409) before a single atomic batch write; a single item returns its Location, many
 *   items return the id array.
 *
 * @param request the inbound request (for response construction)
 * @param api_request the parsed request (payload array + optional meta); parse with `parseAPIRequest(request, [])`
 * @param handlers the per-entity behavior (see {@link BulkCreateHandlers})
 * @returns the Response to return from the endpoint
 */
export async function handleBulkCreate<T>(
    request: Request,
    api_request: { payload: unknown; meta?: Record<string, string | boolean | number | null> },
    handlers: BulkCreateHandlers<T>
): Promise<Response> {
    const payload = api_request.payload
    if (payload === null || !Array.isArray(payload) || payload.length === 0) {
        return constructResponse(request, null, 400, "Invalid request body: must be a non-empty array")
    }
    if (payload.length > MAX_BULK_ITEMS) {
        return constructResponse(
            request,
            null,
            400,
            `Invalid request body: too many items (maximum ${MAX_BULK_ITEMS} per request)`
        )
    }
    // multi-item writes must be explicit: this prevents a client that expects single-item semantics from
    // accidentally committing several records, and makes the bulk contract opt-in
    if (payload.length > 1 && api_request.meta?.bulk !== true) {
        return constructResponse(
            request,
            null,
            400,
            "Invalid request body: multiple items require the 'bulk' meta signal (set meta.bulk = true)"
        )
    }
    const dry_run = api_request.meta?.dry_run === true

    // clean up every item up front (trim whitespace, straighten curly quotes) so the sanitized data is what
    // gets validated, conflict-checked, and committed. This is the single data-write choke point, so it
    // covers both the single-item and bulk paths for composers/contributors/works.
    for (let i = 0; i < payload.length; i++) {
        payload[i] = sanitizeInputStrings(payload[i])
    }

    // per-item validation, preserving original indices for reporting
    const valid: Array<{ index: number; record: T }> = []
    const validation_errors: Array<{ index: number; error: string }> = []
    for (let i = 0; i < payload.length; i++) {
        const result = handlers.validate(payload[i])
        if (typeof result === "string") {
            validation_errors.push({ index: i, error: result })
        } else {
            valid.push({ index: i, record: result })
        }
    }

    // per-record authorization (only meaningful for records that passed validation)
    const forbidden: Array<{ index: number; error: string }> = []
    if (handlers.authorize) {
        for (const { index, record } of valid) {
            const message = handlers.authorize(record, index)
            if (message) {
                forbidden.push({ index, error: message })
            }
        }
    }

    // conflict detection across the valid set, remapped back to original payload indices
    const conflicts: Array<{ index: number; error: string }> = []
    if (handlers.detectConflicts && valid.length > 0) {
        const raw = await handlers.detectConflicts(valid.map((v) => v.record))
        for (const issue of raw) {
            conflicts.push({ index: valid[issue.index].index, error: issue.message })
        }
    }

    if (dry_run) {
        // return a full per-row report; write nothing. Each row lists every issue found for it.
        const rows = []
        for (let i = 0; i < payload.length; i++) {
            const issues: string[] = []
            for (const list of [validation_errors, forbidden, conflicts]) {
                for (const entry of list) {
                    if (entry.index === i) {
                        issues.push(entry.error)
                    }
                }
            }
            rows.push({ index: i, ok: issues.length === 0, issues })
        }
        const ok = rows.every((row) => row.ok)
        return constructResponse(request, { dry_run: true, ok, count: payload.length, rows }, 200)
    }

    // commit path: fail with the specific reason before writing anything
    if (validation_errors.length > 0) {
        return constructResponse(
            request,
            { errors: validation_errors },
            400,
            "Invalid request body: one or more items are invalid"
        )
    }
    if (forbidden.length > 0) {
        return constructResponse(request, { errors: forbidden }, 403, "Forbidden: one or more items are not permitted")
    }
    if (conflicts.length > 0) {
        return constructResponse(request, { errors: conflicts }, 409, "Conflict: one or more items already exist")
    }

    const records = valid.map((v) => v.record)
    try {
        if (records.length === 1) {
            // single-item requests keep the original 201 + Location response for backward compatibility
            const id = await handlers.commitOne(records[0])
            return constructResponse(request, null, 201, undefined, { Location: handlers.location(id) })
        }
        const ids = await handlers.commitBatch(records)
        return constructResponse(request, ids, 201)
    } catch (error) {
        // the atomic batch (or single insert) failed; the SQLite hook maps constraint violations (incl. the
        // composite composition uniqueness index) to their proper 4xx codes, else this is an unexpected 500
        return constructResponseErrorHook(request, error, 500, "Error adding records")
    }
}

/**
 * Minimal HTML-escaping for text interpolated into the error page's footer (e.g. a signed-in email).
 *
 * @param {string} value - the raw text to escape
 * @returns {string} the text with HTML-significant characters entity-encoded
 */
function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;")
}

/**
 * Computes the dynamic footer tokens for the error fallback page so its footer mirrors the AdminFooter's
 * live "accessing this service … / The time is …" block. The signed-in email is shown only when the
 * caller could supply one (most error paths fire before an identity exists), matching the AdminFooter
 * wording; the clock uses the visitor's Cloudflare-reported timezone when a request is available, else UTC.
 *
 * @param {Request} [request] - the originating request, read for its cf timezone (absent for page fallbacks)
 * @param {string | null} [identity_email] - the signed-in email when known; null/undefined yields generic wording
 * @returns {Record<string, string>} the {footerAccess}/{footerTime}/{footerTz}/{footerYear} token values
 */
function errorFooterTokens(request?: Request, identity_email?: string | null): Record<string, string> {
    const now = new Date()
    const tz: string | undefined = request
        ? ((request as any).cf as { timezone?: string } | undefined)?.timezone
        : undefined
    let time_display: string
    try {
        time_display = now.toLocaleString("en-US", {
            timeZone: tz || "UTC",
            weekday: "long",
            day: "2-digit",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZoneName: "short"
        })
    } catch {
        time_display = now.toLocaleString("en-US", { timeZone: "UTC" })
    }
    const access = identity_email
        ? `You are accessing this service under email <a href="mailto:${escapeHtml(identity_email)}">${escapeHtml(identity_email)}</a>.`
        : "You are accessing this service as an unauthenticated user."
    return {
        footerAccess: access,
        footerTime: time_display,
        footerTz: tz || "UTC",
        footerYear: now.getFullYear().toString()
    }
}

/**
 * Fills the error fallback template's tokens with a status code, description, and footer values.
 *
 * @param {keyof typeof http_codes} code - the HTTP status code
 * @param {string} statusText - the status code's reason phrase
 * @param {string} description - the human-readable error description
 * @param {Record<string, string>} footer - the footer tokens from errorFooterTokens
 * @returns {string} the fully substituted HTML document
 */
function fillErrorTemplate(
    code: keyof typeof http_codes,
    statusText: string,
    description: string,
    footer: Record<string, string>
): string {
    return error_http
        .replaceAll("{errorCode}", code.toString())
        .replaceAll("{errorName}", statusText)
        .replaceAll("{errorDescription}", description)
        .replaceAll("{footerAccess}", footer.footerAccess)
        .replaceAll("{footerTime}", footer.footerTime)
        .replaceAll("{footerTz}", footer.footerTz)
        .replaceAll("{footerYear}", footer.footerYear)
}

export function middlewareErrorResponder(
    request: Request,
    code: keyof typeof http_codes,
    force_comment?: string,
    identity_email?: string | null
): Response {
    // API routes expect the standard JSON envelope every other API response uses. Returning the HTML
    // error page for a middleware rejection (e.g. the CSRF origin check, a 401/403, or the staging 404)
    // makes the failure opaque to the connector's JSON parser, which surfaces only a parse error rather
    // than the actual cause. Page navigations still receive the human-readable HTML fallback below.
    const path_components = new URL(request.url).pathname.split("/").filter((component) => component.length > 0)
    if (path_components[0] === "api") {
        return constructResponse(request, null, code, force_comment)
    }
    const { statusText, comment } = http_codes[code]
    const data = fillErrorTemplate(
        code,
        statusText,
        force_comment ? force_comment : comment,
        errorFooterTokens(request, identity_email)
    )
    return new Response(data, {
        status: code,
        statusText: statusText,
        headers: _constructHeaders(error_headers, {})
    })
}

/**
 * Constructs the 204 CORS preflight response for an OPTIONS request, selecting the policy by route
 *
 * The full CORS policy (all methods + custom headers) is released on API routes, the limited
 * credentialed policy applies to admin routes, and everything else defaults closed
 *
 * @param {Request} request - the original OPTIONS request, used to resolve the allowed origin
 * @returns {Response} a 204 No Content response carrying the appropriate CORS headers
 */
export function constructPreflightResponse(request: Request): Response {
    const path_components = new URL(request.url).pathname.split("/").filter((component) => component.length > 0)
    let template: Record<string, string | undefined>
    if (path_components.length > 0 && path_components[0] === "api") {
        // API routes necessitate the additional request methods/headers
        template = preflight_headers
    } else if (path_components.length > 0 && path_components[0] === "admin") {
        // admin pages don't need the full API method/header set, but they do need credential transmission
        template = preflight_limited_headers
    } else {
        // non-API and non-admin routes default closed
        template = preflight_closed_headers
    }
    return new Response(null, {
        status: 204,
        statusText: "No Content",
        headers: _constructHeaders(template, {
            "Access-Control-Allow-Origin": resolveAllowedOrigin(request)
        })
    })
}

/**
 * Constructs the 204 response for a bare OPTIONS request that is not a CORS preflight
 *
 *
 * @param {Request} request - the original OPTIONS request, used to resolve the route
 * @returns {Response} a 204 No Content response advertising the allowed methods
 */
export function constructOptionsResponse(request: Request): Response {
    const path_components = new URL(request.url).pathname.split("/").filter((component) => component.length > 0)
    const allow =
        path_components.length > 0 && path_components[0] === "api"
            ? "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            : "GET, OPTIONS"
    return new Response(null, {
        status: 204,
        statusText: "No Content",
        headers: {
            Allow: allow
        }
    })
}

/**
 * Builds the HTML error fallback page with an HTTP status code
 *
 * @param {keyof typeof http_codes} code - the HTTP status code for the page
 * @param {string} [force_comment] - a description to show instead of the code's default comment
 * @returns {Response} an HTML Response carrying the error page
 */
export function constructErrorPage(code: keyof typeof http_codes, force_comment?: string): Response {
    const { statusText, comment } = http_codes[code]
    // no request reaches this page-fallback path, so the footer renders the generic (unauthenticated,
    // UTC) variant - see the "inject when available, else generic" footer contract in errorFooterTokens
    const data = fillErrorTemplate(code, statusText, force_comment ? force_comment : comment, errorFooterTokens())
    return new Response(data, {
        status: code,
        statusText: statusText,
        headers: _constructHeaders(error_headers, {})
    })
}

/**
 * Builds a simple fallback page in case a critical database table is missing.
 *
 * @param {unknown} error - the missing-table error (used to name the table when available)
 * @returns {Response} an HTML 503 Response describing the missing table
 */
export function missingTableErrorPage(error: unknown): Response {
    const table = missingTableName(error)
    const description = table
        ? `A database table required for this page ("${table}") does not exist. The service may be misconfigured or undergoing maintenance. Please try again later or contact an administrator.`
        : "A database table required for this page does not exist. The service may be misconfigured or undergoing maintenance. Please try again later or contact an administrator."
    return constructErrorPage(503, description)
}

/**
 * Builds the HTML fallback page shown when a page attempts to read live data (database, R2, KV)
 * in local development
 *
 * @returns {Response} an HTML 503 Response with a dev-mode-specific explanation
 */
export function devModeUnavailablePage(): Response {
    return constructErrorPage(
        503,
        'Cloudflare database and storage bindings are not available in local development. Use "pnpm preview" (via wrangler) to test pages that require live data.'
    )
}

export function hookSQLiteError(request: Request, error: Error): Response {
    const [code, message] = convertSQLiteError(error)
    const forward_message = richErrors(request) ? `Database error: ${error.message}` : undefined
    if (message === null) {
        return constructResponse(request, null, code, forward_message)
    } else {
        return constructResponse(request, null, code, message)
    }
}

/**
 * Wraps a server-side database read performed directly by an admin page
 *
 * @param {() => Promise<T>} read - the database read to perform
 * @returns {Promise<T | Response>} the read's value, or the missing-table fallback page
 */
export async function guardedRead<T>(read: () => Promise<T>): Promise<T | Response> {
    try {
        return await read()
    } catch (error) {
        if (isMissingTableError(error)) {
            return missingTableErrorPage(error)
        }
        if (isActiveRequestDev()) {
            return devModeUnavailablePage()
        }
        console.log(error)
        throw error
    }
}
