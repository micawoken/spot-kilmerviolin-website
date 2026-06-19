/**
 * lib/api/http.ts
 * 
 * Provides functions related to creating HTTP Response objects for the API
 * 
 */

import { createAPIPayload } from "./common"
import { COMPOSER, COMPOSITION, CONTRIBUTOR } from "./d1"
import { richErrors, isActiveRequestDev } from "./environment"
import { ALLOWED_ORIGINS } from "../../consts"

// the generic HTTP error page lives in its own file (error.html) and is inlined as a raw string at
// build time; the {errorCode}/{errorName}/{errorDescription} tokens are filled in middlewareErrorResponder
import error_http from "../templates/error.html?raw"

interface SQLiteErrorMsg extends SQLiteErrorMsgPrimitive {
    code: keyof typeof http_codes
}


// headers

// headers are added to static and dynamic pages through the Astro middleware at build time and at request

export const static_headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, maxage=86400, s-maxage=604800, stale-while-revalidate=604800, must-understand",
    "Allow": "GET, OPTIONS",
    "Vary": "Origin"
}

export const error_headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, must-understand",
    "Allow": "GET, OPTIONS",
    "Vary": "Origin"
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
    "Vary": "Origin"
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
    "Vary": "Origin"
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
    "Vary": "Origin"
}


/**
 * A fallback origin to use for CORS headers when a request does not include an allowed "Origin"
 */
export const cors_fallback_origin = "localhost" // temporary

/**
 * Resolves the value to send in Access-Control-Allow-Origin for a request.
 *
 * Because API responses set Access-Control-Allow-Credentials: true, the allowed origin must never be a
 * blanket reflection of the request's Origin header — doing so would let any site make credentialed
 * cross-origin calls and read the responses. Instead, the request Origin is echoed back only when the
 * full origin (scheme://host[:port], serialized via the URL parser to normalize away any trailing
 * slash or default port) exactly matches an entry on the ALLOWED_ORIGINS allowlist (see src/consts.ts);
 * matching the full origin rather than just the hostname keeps the scheme and port constrained. Any
 * other (or absent/malformed) Origin yields the non-matching fallback, which the browser will reject
 * for cross-origin use.
 *
 * @param {Request} request - the original Request object
 * @returns {string} the Origin to echo (when allowlisted) or the fallback origin
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
    return cors_fallback_origin
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
    "Allow": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Vary": "Origin"
}

/**
 * Content types that are safe to serve inline (rendered by the browser on direct navigation and embedded
 * via <img>). Restricted to raster image formats: these cannot carry executable script, so an attacker who
 * uploads one cannot achieve same-origin script execution against a viewer. Every other type — notably
 * image/svg+xml and text/html, which can carry <script> — is served as an attachment instead. The set
 * mirrors isOptimizableImage's re-encoded formats (images.ts); SVG is deliberately absent from both.
 */
export const INLINE_SAFE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]

/**
 * Header template for raw (non-JSON) body responses, such as a file served from the store.
 * Mirrors the credentialed CORS posture of API_headers but carries the body's own content type and a
 * cacheable directive; the undefined values are filled per-request by constructFileResponse.
 *
 * The fixed security headers below harden the store against a contributor uploading an active-content file
 * (SVG/HTML) that, served on the app origin, would execute script against a viewing admin:
 *  - X-Content-Type-Options: nosniff stops the browser from MIME-sniffing an upload into an executable type
 *  - Content-Security-Policy: sandbox neutralizes any script even if the body is rendered as a document
 *    (sandbox does not affect <img>-embedded raster images, so legitimate inline previews still render)
 * Content-Disposition is resolved per-request by constructFileResponse (inline only for raster images).
 */
export const file_headers = {
    "Content-Type": undefined,
    "Content-Disposition": undefined,
    "Cache-Control": undefined,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox",
    "Access-Control-Allow-Origin": undefined,
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin"
}

/**
 * HTTP status codes used in constructResponse()
 */
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
export function _constructHeaders(template: Record<string, string | undefined>, complete: Record<string, string>, additional: Record<string, string> = {}): Record<string, string> {
    // assert that each undefined key is mapped in complete
    Object.keys(template).filter(key => template[key] === undefined).forEach(key => {
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
    if (typeof record.change_date === "string") {
        const parsed = Date.parse(record.change_date)
        if (!isNaN(parsed)) {
            out.push(parsed)
        }
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
export function constructResponse(request: Request, payload: any, code: (keyof typeof http_codes), force_comment?: string | undefined, headers_addl?: Record<string, string>): Response {
    const { success, statusText, comment } = http_codes[code]
    const headers = _constructHeaders(API_headers, {
        "Access-Control-Allow-Origin": resolveAllowedOrigin(request)
        },
        headers_addl ? headers_addl : {}
    )
    let response_body: string | null
    try {
        response_body = http_codes[code].body ? JSON.stringify(createAPIPayload(success, payload, force_comment !== undefined ? force_comment : comment)) : null
    } catch (e) {
        throw new Error(`Failed to serialize response payload: ${e}`)
    }
    return new Response(
        response_body,
        {
            status: code,
            statusText: statusText,
            headers: headers
        }
    )
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
export function constructFileResponse(request: Request, body: BodyInit, content_type: string, cache_ttl: number, headers_addl?: Record<string, string>): Response {
    // serve inline only for raster image types (safe to render); anything else (SVG, HTML, octet-stream)
    // is forced to download so a viewer's browser never renders attacker-supplied active content on-origin
    const base_type = content_type.split(";")[0].trim().toLowerCase()
    const disposition = INLINE_SAFE_CONTENT_TYPES.includes(base_type) ? "inline" : "attachment"
    const headers = _constructHeaders(file_headers, {
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
export function constructResponseErrorHook(request: Request, error: any, code: keyof typeof http_codes, force_comment?: string | undefined): Response {
    if (checkSQLiteErrorHook(error)) {
        return hookSQLiteError(request, error)
    }
    return constructResponse(request, null, code, richErrors(request) && !force_comment ? `Error: ${error.message}` : force_comment)
}

/**
 * Check if an error can be processed by the SQLite error hook
 * 
 * @param {any} error - the error to check
 * @returns {boolean} if the error can be processed by the SQLite error hook
 */
export function checkSQLiteErrorHook(error: any): boolean {
    return (error instanceof Error && error.message.match(/SQLITE_/) !== null)
}

export function middlewareErrorResponder(_request: Request, code: keyof typeof http_codes, force_comment?: string): Response {
    const { statusText, comment } = http_codes[code]
    const data = error_http.replaceAll("{errorCode}", code.toString())
        .replaceAll("{errorName}", statusText)
        .replaceAll("{errorDescription}", force_comment ? force_comment : comment)
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
    const path_components = new URL(request.url).pathname.split("/").filter(component => component.length > 0)
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
 * The advertised Allow set is selected by route, mirroring constructPreflightResponse: API routes accept the
 * full method set, everything else is read-only. This stays a superset of any individual endpoint's verbs
 * (e.g. /api/v1/site is GET/POST/DELETE) rather than claiming GET-only for write-capable API routes.
 *
 * @param {Request} request - the original OPTIONS request, used to resolve the route
 * @returns {Response} a 204 No Content response advertising the allowed methods
 */
export function constructOptionsResponse(request: Request): Response {
    const path_components = new URL(request.url).pathname.split("/").filter(component => component.length > 0)
    const allow = path_components.length > 0 && path_components[0] === "api"
        ? "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        : "GET, OPTIONS"
    return new Response(null, {
        status: 204,
        statusText: "No Content",
        headers: {
            "Allow": allow
        }
    })
}

/**
 * List of SQLite extended error codes and their HTTP status codes for the error hook
 * Some errors may include a processor function to refine the error determination
 */
const sqlite_errors_extended: Record<string, SQLiteErrorMsg> = {
    // --- Primary result codes ---------------------------------------------------------------------
    // D1 frequently surfaces only the primary code (e.g. "no such table: …: SQLITE_ERROR"), so these are
    // matched alongside the extended codes below. SQLITE_ERROR carries a processor that picks apart the
    // common generic failures (missing table/column, malformed query); SQLITE_CONSTRAINT likewise
    // dispatches by the constraint named in the message when only the primary code is reported.
    "SQLITE_ERROR": { code: 500, processor: processGenericError },
    "SQLITE_INTERNAL": { code: 500 },
    "SQLITE_PERM": { code: 403 },
    "SQLITE_ABORT": { code: 500 },
    "SQLITE_BUSY": { code: 503 },
    "SQLITE_LOCKED": { code: 503 },
    "SQLITE_NOMEM": { code: 500 },
    "SQLITE_READONLY": { code: 403 },
    "SQLITE_INTERRUPT": { code: 503 },
    "SQLITE_IOERR": { code: 500 },
    "SQLITE_CORRUPT": { code: 500 },
    "SQLITE_NOTFOUND": { code: 500 },
    "SQLITE_FULL": { code: 507 },
    "SQLITE_CANTOPEN": { code: 500 },
    "SQLITE_PROTOCOL": { code: 500 },
    "SQLITE_SCHEMA": { code: 500 },
    "SQLITE_TOOBIG": { code: 400, message: "The request contains a value that is too large to store" },
    "SQLITE_CONSTRAINT": { code: 400, processor: processConstraintGeneric },
    "SQLITE_MISMATCH": { code: 400, message: "A value has an incompatible type for its column" },
    "SQLITE_MISUSE": { code: 500 },
    "SQLITE_AUTH": { code: 403 },
    "SQLITE_RANGE": { code: 400 },
    "SQLITE_NOTADB": { code: 500 },
    // --- Extended result codes --------------------------------------------------------------------
    "SQLITE_ABORT_ROLLBACK": { code: 500 },
    "SQLITE_AUTH_USER": { code: 403 },
    "SQLITE_BUSY_RECOVERY": { code: 503 },
    "SQLITE_BUSY_SNAPSHOT": { code: 503 },
    "SQLITE_BUSY_TIMEOUT": { code: 503 },
    "SQLITE_CANTOPEN_CONVPATH": { code: 500 },
    "SQLITE_CANTOPEN_DIRTYWAL": { code: 500 },
    "SQLITE_CANTOPEN_FULLPATH": { code: 500 },
    "SQLITE_CANTOPEN_ISDIR": { code: 500 },
    "SQLITE_CANTOPEN_NOTEMPDIR": { code: 500 },
    "SQLITE_CANTOPEN_SYMLINK": { code: 500 },
    "SQLITE_CONSTRAINT_CHECK": { code: 400, processor: processConstraintCheck },
    "SQLITE_CONSTRAINT_COMMITHOOK": { code: 400 },
    "SQLITE_CONSTRAINT_DATATYPE": { code: 400 },
    "SQLITE_CONSTRAINT_FOREIGNKEY": { code: 409, processor: processConstraintForeignKey },
    "SQLITE_CONSTRAINT_FUNCTION": { code: 400 },
    "SQLITE_CONSTRAINT_NOTNULL": { code: 400, processor: processConstraintNotNull },
    "SQLITE_CONSTRAINT_PINNED": { code: 400 },
    "SQLITE_CONSTRAINT_PRIMARYKEY": { code: 400 },
    "SQLITE_CONSTRAINT_ROWID": { code: 400 },
    "SQLITE_CONSTRAINT_TRIGGER": { code: 400 },
    "SQLITE_CONSTRAINT_UNIQUE": { code: 400, processor: processConstraintUnique },
    "SQLITE_CONSTRAINT_VTAB": { code: 400 },
    "SQLITE_CORRUPT_INDEX": { code: 500 },
    "SQLITE_CORRUPT_SEQUENCE": { code: 500 },
    "SQLITE_CORRUPT_VTAB": { code: 500 },
    "SQLITE_ERROR_MISSING_COLLSEQ": { code: 500 },
    "SQLITE_ERROR_RETRY": { code: 500 },
    "SQLITE_ERROR_SNAPSHOT": { code: 500 },
    "SQLITE_IOERR_ACCESS": { code: 500 },
    "SQLITE_IOERR_AUTH": { code: 500 },
    "SQLITE_IOERR_BEGIN_ATOMIC": { code: 500 },
    "SQLITE_IOERR_BLOCKED": { code: 500 },
    "SQLITE_IOERR_CHECKRESERVEDLOCK": { code: 500 },
    "SQLITE_IOERR_CLOSE": { code: 500 },
    "SQLITE_IOERR_COMMIT_ATOMIC": { code: 500 },
    "SQLITE_IOERR_CONVPATH": { code: 500 },
    "SQLITE_IOERR_CORRUPTFS": { code: 500 },
    "SQLITE_IOERR_DATA": { code: 500 },
    "SQLITE_IOERR_DELETE": { code: 500 },
    "SQLITE_IOERR_DELETE_NOENT": { code: 500 },
    "SQLITE_IOERR_DIR_CLOSE": { code: 500 },
    "SQLITE_IOERR_DIR_FSYNC": { code: 500 },
    "SQLITE_IOERR_FSTAT": { code: 500 },
    "SQLITE_IOERR_FSYNC": { code: 500 },
    "SQLITE_IOERR_GETTEMPPATH": { code: 500 },
    "SQLITE_IOERR_LOCK": { code: 500 },
    "SQLITE_IOERR_MMAP": { code: 500 },
    "SQLITE_IOERR_NOMEM": { code: 500 },
    "SQLITE_IOERR_RDLOCK": { code: 500 },
    "SQLITE_IOERR_READ": { code: 500 },
    "SQLITE_IOERR_ROLLBACK_ATOMIC": { code: 500 },
    "SQLITE_IOERR_SEEK": { code: 500 },
    "SQLITE_IOERR_SHMLOCK": { code: 500 },
    "SQLITE_IOERR_SHMMAP": { code: 500 },
    "SQLITE_IOERR_SHMOPEN": { code: 500 },
    "SQLITE_IOERR_SHMSIZE": { code: 500 },
    "SQLITE_IOERR_SHORT_READ": { code: 500 },
    "SQLITE_IOERR_TRUNCATE": { code: 500 },
    "SQLITE_IOERR_UNLOCK": { code: 500 },
    "SQLITE_IOERR_VNODE": { code: 500 },
    "SQLITE_IOERR_WRITE": { code: 500 },
    "SQLITE_LOCKED_SHAREDCACHE": { code: 500 },
    "SQLITE_LOCKED_VTAB": { code: 500 },
    "SQLITE_NOTICE_RECOVER_ROLLBACK": { code: 500 },
    "SQLITE_NOTICE_RECOVER_WAL": { code: 500 },
    "SQLITE_OK_LOAD_PERMANENTLY": { code: 200 },
    "SQLITE_READONLY_CANTINIT": { code: 403 },
    "SQLITE_READONLY_CANTLOCK": { code: 403 },
    "SQLITE_READONLY_DBMOVED": { code: 403 },
    "SQLITE_READONLY_DIRECTORY": { code: 403 },
    "SQLITE_READONLY_RECOVERY": { code: 403 },
    "SQLITE_READONLY_ROLLBACK": { code: 403 }
}


/**
 * Parser function for SQLITE_CONSTRAINT_UNIQUE errors
 * 
 * @param {string} error_message - the error message, from Error.message
 * @return {[boolean, number, string]} [whether the error was processed, the HTTP status code to return, the message to return]
 */
function processConstraintUnique(error_message: string): [boolean, number, string] {
    // pulls out the column name and compares it with the schema
    const regex = /UNIQUE constraint failed: (\w+)\.(\w+)/
    const match = error_message.match(regex)
    if (!match) {
        return [false, 400, ""] // null response, use default
    }
    const table = match[1]
    const column = match[2]
    
    let schema
    switch (table) {
        case "contributors":
            schema = CONTRIBUTOR
            break
        case "composers": 
            schema = COMPOSER
            break
        case "compositions":
            schema = COMPOSITION
            break
        default:
            return [false, 400, ""] // unrecognized table, use default
    }

    if (column === schema.primary_key) {
        // primary key already exists
        return [true, 409, `Invalid request: this primary key already exists`]
    } else if (schema.index.includes(column)) {
        // indexed column must be unique
        return [true, 409, `Invalid request body: property "${column}" must be unique, and such a value already exists`]
    } else {
        return [false, 400, ""]
    }
}

/**
 * Parser for SQLITE_CONSTRAINT_NOTNULL errors. A NOT NULL violation names the offending "table.column",
 * which is surfaced so the caller learns exactly which required field was missing.
 *
 * @param {string} error_message - the error message, from Error.message
 * @returns {[boolean, number, string]} [whether the error was processed, the HTTP status code, the message]
 */
function processConstraintNotNull(error_message: string): [boolean, number, string] {
    const match = error_message.match(/NOT NULL constraint failed: (\w+)\.(\w+)/)
    if (!match) {
        return [false, 400, ""]
    }
    return [true, 400, `Invalid request body: required field "${match[2]}" must be provided and cannot be empty`]
}

/**
 * Parser for SQLITE_CONSTRAINT_FOREIGNKEY errors. A foreign-key violation means a referenced record
 * (a composer or contributor id) does not exist, so the request conflicts with the database state.
 *
 * @param {string} _error_message - the error message, from Error.message (unused: SQLite does not name the column)
 * @returns {[boolean, number, string]} [whether the error was processed, the HTTP status code, the message]
 */
function processConstraintForeignKey(_error_message: string): [boolean, number, string] {
    // SQLite does not name the offending column for a foreign-key failure, so the message stays generic
    return [true, 409, "Invalid request body: a referenced record (composer or contributor) does not exist"]
}

/**
 * Parser for SQLITE_CONSTRAINT_CHECK errors. A CHECK violation names the failed constraint, which is
 * surfaced to point the caller at the value that did not satisfy a database-level rule.
 *
 * @param {string} error_message - the error message, from Error.message
 * @returns {[boolean, number, string]} [whether the error was processed, the HTTP status code, the message]
 */
function processConstraintCheck(error_message: string): [boolean, number, string] {
    const match = error_message.match(/CHECK constraint failed: (\w+)/)
    if (match) {
        return [true, 400, `Invalid request body: value failed the "${match[1]}" database validation check`]
    }
    return [true, 400, "Invalid request body: a value failed a database validation check"]
}

/**
 * Parser for the primary SQLITE_CONSTRAINT code, used when D1 reports only the primary code rather than a
 * specific extended one. It dispatches to the specialized parsers by the constraint named in the message.
 *
 * @param {string} error_message - the error message, from Error.message
 * @returns {[boolean, number, string]} [whether the error was processed, the HTTP status code, the message]
 */
function processConstraintGeneric(error_message: string): [boolean, number, string] {
    if (/UNIQUE constraint failed/i.test(error_message)) {
        return processConstraintUnique(error_message)
    }
    if (/NOT NULL constraint failed/i.test(error_message)) {
        return processConstraintNotNull(error_message)
    }
    if (/FOREIGN KEY constraint failed/i.test(error_message)) {
        return processConstraintForeignKey(error_message)
    }
    if (/CHECK constraint failed/i.test(error_message)) {
        return processConstraintCheck(error_message)
    }
    return [false, 400, ""]
}

/**
 * Parser for the primary SQLITE_ERROR code, which covers generic failures
 *
 * @param {string} error_message - the error message, from Error.message
 * @returns {[boolean, number, string]} [whether the error was processed, the HTTP status code, the message]
 */
function processGenericError(error_message: string): [boolean, number, string] {
    const table = parseMissingTable(error_message)
    if (table !== null) {
        // a table required for the operation does not exist (a missing migration, a misconfigured binding,
        // or a partially-provisioned database): the data layer cannot proceed, so report it as unavailable
        return [true, 503, `A database table required for this operation ("${table}") does not exist. The service may be misconfigured or undergoing maintenance; please contact an administrator.`]
    }
    const column = error_message.match(/no such column:?\s*([A-Za-z0-9_.]+)/i)
    if (column) {
        return [true, 500, `A database column required for this operation ("${column[1]}") does not exist. The database schema may be out of date.`]
    }
    if (/syntax error/i.test(error_message)) {
        return [true, 500, "The server generated an invalid database query. Please report this issue to an administrator."]
    }
    return [false, 500, ""]
}

/**
 * Extracts the table name from a SQLite "no such table" error message
 *
 * @param {string} message - the error message to inspect
 * @returns {string | null} the missing table name, or null
 */
function parseMissingTable(message: string): string | null {
    const match = message.match(/no such table:?\s*([A-Za-z_][A-Za-z0-9_]*)/i)
    return match ? match[1] : null
}

/**
 * Returns the missing table name when the given error is a SQLite "no such table" error
 *
 * @param {unknown} error - the thrown value to inspect
 * @returns {string | null} the missing table name, or null when the error is not a missing-table error
 */
export function missingTableName(error: unknown): string | null {
    if (!(error instanceof Error)) {
        return null
    }
    return parseMissingTable(error.message)
}

/**
 * Whether the given error indicates that a database table critical for the operation does not exist.
 *
 * @param {unknown} error - the thrown value to inspect
 * @returns {boolean} true when the error is a SQLite "no such table" error
 */
export function isMissingTableError(error: unknown): boolean {
    return missingTableName(error) !== null
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
    const data = error_http.replaceAll("{errorCode}", code.toString())
        .replaceAll("{errorName}", statusText)
        .replaceAll("{errorDescription}", force_comment ? force_comment : comment)
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
    return constructErrorPage(503, "Cloudflare database and storage bindings are not available in local development. Use \"npm run preview\" (via wrangler) to test pages that require live data.")
}

/**
 * Converts an error thrown by D1 into the appropriate HTTP status code
 *
 * @param {Error} error - the error thrown by D1
 * @returns {[keyof typeof http_codes, string | null]} [the HTTP status code, the message; if null, ignore code and use default]
 */
function convertSQLiteError(error: Error): [keyof typeof http_codes, string | null] {
    // search the error message for a known SQLite error code (extended codes match as a single greedy
    // token, so e.g. "SQLITE_CONSTRAINT_UNIQUE" is looked up whole rather than as the base "SQLITE_CONSTRAINT")
    const regex = /SQLITE_[A-Z_]+/g
    const matches = error.message.match(regex)
    if (!matches) {
        return [500, null]
    }
    for (const match of matches) {
        if (!(match in sqlite_errors_extended)) {
            continue
        }
        const error_info = sqlite_errors_extended[match]
        if (error_info.processor) {
            const [processed, code, message] = error_info.processor(error.message)
            if (processed) {
                return [code as keyof typeof http_codes, message]
            }
            // the processor could not refine this error; fall back to the entry's own code/message
            return [error_info.code, error_info.message || null]
        }
        return [error_info.code, error_info.message || null]
    }
    return [500, null]
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
 * Wraps a server-side database read performed directly by an admin page. When the read fails because a
 * table critical to the operation does not exist, it resolves to the missing-table fallback page instead
 * of letting the error bubble up as an unhandled 500; any other error propagates unchanged.
 *
 * The caller distinguishes the two outcomes with an `instanceof Response` check: a Response is a
 * ready-to-return fallback page, while anything else is the read's resolved value.
 *
 * This lives in http.ts (alongside the error-page constructors it returns) rather than page_auth.ts
 * because it concerns HTTP error handling for a read, not page authorization.
 *
 * Usage from an Astro page's frontmatter:
 *   const composers = await guardedRead(() => listComposers(Astro.locals.cfContext))
 *   if (composers instanceof Response) return composers
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