/**
 * lib/api/http.ts
 * 
 * Provides functions related to creating HTTP Response objects for the API
 * 
 */

import { createAPIPayload } from "./common"
import { COMPOSER, COMPOSITION, CONTRIBUTOR } from "./d1"
import { richErrors } from "./environment"

interface SQLiteErrorMsg extends SQLiteErrorMsgPrimitive {
    code: keyof typeof http_codes
}


// headers

// headers are added to static and dynamic pages through the Astro middleware at build time and at request

export const static_headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, maxage=86400, s-maxage=604800, stale-while-revalidate=604800, must-understand",
    "Allow": "GET, OPTIONS",
    "Vary": "Origin",
    "Origin": undefined
}

export const error_headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, must-understand",
    "Allow": "GET, OPTIONS",
    "Vary": "Origin",
    "Origin": undefined
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
    "Vary": "Origin",
    "Origin": undefined
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
    "Vary": "Origin",
    "Origin": undefined
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
    "Vary": "Origin",
    "Origin": undefined // must be generated
    /**
     * CORS preflight is implemented in middleware/preflight.ts and activates on calls to 
     * 
     * 
     */
}


/**
 * A fallback origin to use for CORS headers when a request does not include "Origin"
 */
export const cors_fallback_origin = "localhost" // temporary

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
    "Vary": "Origin",
    "Origin": undefined
}

/**
 * Generic HTTP error page template used in middleware
 */
export const error_http = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <link rel="icon" href="/favicon.ico" type="image/x-icon">
    <link rel="stylesheet" href="/style.css">
    <title>{errorCode} {errorName}</title>
</head>
<body>
    <div class="global">
        <h1 class="title">{errorCode} {errorName}</h1>
    </div>
    <div class="global body">
        <p>{errorDescription}</p>
        <p>Please do not repeat this request.</p>
    </div>
    <div class="global body">
        <p><a href="javascript:history.back()">Back</a> | <a href="/">Home</a></p>
    </div>
    <div class="global body">
        <p>Need to report a security concern? Contact the webmaster at <a href="mailto:contact@michaelwongmusic.com">contact@michaelwongmusic.com</a>.</p>
    </div>
</body>
</html>`

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
        "Access-Control-Allow-Origin": request.headers.get("Origin") || cors_fallback_origin,
        "Origin": request.headers.get("Origin") || cors_fallback_origin
        },
        headers_addl ? headers_addl : {}
    )
    let response_body: string | null
    try {
        response_body = http_codes[code].body ? JSON.stringify(createAPIPayload(success, payload, force_comment !== undefined ? force_comment : comment)) : null
    } catch (e) {
        throw new Error(`Failed to serialize response payload: ${e}`)
    }
    console.log("Response body constructed: ", response_body)
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

export function middlewareErrorResponder(request: Request, code: keyof typeof http_codes, force_comment?: string): Response {
    const { statusText, comment } = http_codes[code]
    const data = error_http.replaceAll("{errorCode}", code.toString())
        .replaceAll("{errorName}", statusText)
        .replaceAll("{errorDescription}", force_comment ? force_comment : comment)
    return new Response(data, {
        status: code,
        statusText: statusText,
        headers: _constructHeaders(error_headers, {
            "Origin": request.headers.get("Origin") || cors_fallback_origin
        })
    })
}

/**
 * List of SQLite extended error codes and their HTTP status codes for the error hook
 * Some errors may include a processor function to refine the error determination
 */
const sqlite_errors_extended: Record<string, SQLiteErrorMsg> = {
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
    "SQLITE_CONSTRAINT_CHECK": { code: 400 },
    "SQLITE_CONSTRAINT_COMMITHOOK": { code: 400 },
    "SQLITE_CONSTRAINT_DATATYPE": { code: 400 },
    "SQLITE_CONSTRAINT_FOREIGNKEY": { code: 400 },
    "SQLITE_CONSTRAINT_FUNCTION": { code: 400 },
    "SQLITE_CONSTRAINT_NOTNULL": { code: 400 },
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
 * Converts an error thrown by D1 into the appropriate HTTP status code
 * 
 * @param {Error} error - the error thrown by D1
 * @returns {[keyof typeof http_codes, string | null]} [the HTTP status code, the message; if null, ignore code and use default]
 */
function convertSQLiteError(error: Error): [keyof typeof http_codes, string | null] {
    // search the error message for a known SQLite error code
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
        } else {
            return [error_info.code, error_info.message || null]
        }
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