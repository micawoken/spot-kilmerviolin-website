/**
 * lib/api/sqlite_error.ts
 *
 * SQLite error parser to emit detailed descriptions
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

import { COMPOSER, COMPOSITION, CONTRIBUTOR } from "./d1"
import type { HttpStatus } from "./http"

interface SQLiteErrorMsg extends SQLiteErrorMsgPrimitive {
    code: HttpStatus
}

/**
 * Check if an error can be processed by the SQLite error hook
 *
 * @param {any} error - the error to check
 * @returns {boolean} if the error can be processed by the SQLite error hook
 */
export function checkSQLiteErrorHook(error: any): boolean {
    return error instanceof Error && error.message.match(/SQLITE_/) !== null
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
    SQLITE_ERROR: { code: 500, processor: processGenericError },
    SQLITE_INTERNAL: { code: 500 },
    SQLITE_PERM: { code: 403 },
    SQLITE_ABORT: { code: 500 },
    SQLITE_BUSY: { code: 503 },
    SQLITE_LOCKED: { code: 503 },
    SQLITE_NOMEM: { code: 500 },
    SQLITE_READONLY: { code: 403 },
    SQLITE_INTERRUPT: { code: 503 },
    SQLITE_IOERR: { code: 500 },
    SQLITE_CORRUPT: { code: 500 },
    SQLITE_NOTFOUND: { code: 500 },
    SQLITE_FULL: { code: 507 },
    SQLITE_CANTOPEN: { code: 500 },
    SQLITE_PROTOCOL: { code: 500 },
    SQLITE_SCHEMA: { code: 500 },
    SQLITE_TOOBIG: { code: 400, message: "The request contains a value that is too large to store" },
    SQLITE_CONSTRAINT: { code: 400, processor: processConstraintGeneric },
    SQLITE_MISMATCH: { code: 400, message: "A value has an incompatible type for its column" },
    SQLITE_MISUSE: { code: 500 },
    SQLITE_AUTH: { code: 403 },
    SQLITE_RANGE: { code: 400 },
    SQLITE_NOTADB: { code: 500 },
    // --- Extended result codes --------------------------------------------------------------------
    SQLITE_ABORT_ROLLBACK: { code: 500 },
    SQLITE_AUTH_USER: { code: 403 },
    SQLITE_BUSY_RECOVERY: { code: 503 },
    SQLITE_BUSY_SNAPSHOT: { code: 503 },
    SQLITE_BUSY_TIMEOUT: { code: 503 },
    SQLITE_CANTOPEN_CONVPATH: { code: 500 },
    SQLITE_CANTOPEN_DIRTYWAL: { code: 500 },
    SQLITE_CANTOPEN_FULLPATH: { code: 500 },
    SQLITE_CANTOPEN_ISDIR: { code: 500 },
    SQLITE_CANTOPEN_NOTEMPDIR: { code: 500 },
    SQLITE_CANTOPEN_SYMLINK: { code: 500 },
    SQLITE_CONSTRAINT_CHECK: { code: 400, processor: processConstraintCheck },
    SQLITE_CONSTRAINT_COMMITHOOK: { code: 400 },
    SQLITE_CONSTRAINT_DATATYPE: { code: 400 },
    SQLITE_CONSTRAINT_FOREIGNKEY: { code: 409, processor: processConstraintForeignKey },
    SQLITE_CONSTRAINT_FUNCTION: { code: 400 },
    SQLITE_CONSTRAINT_NOTNULL: { code: 400, processor: processConstraintNotNull },
    SQLITE_CONSTRAINT_PINNED: { code: 400 },
    SQLITE_CONSTRAINT_PRIMARYKEY: { code: 400 },
    SQLITE_CONSTRAINT_ROWID: { code: 400 },
    SQLITE_CONSTRAINT_TRIGGER: { code: 400 },
    SQLITE_CONSTRAINT_UNIQUE: { code: 400, processor: processConstraintUnique },
    SQLITE_CONSTRAINT_VTAB: { code: 400 },
    SQLITE_CORRUPT_INDEX: { code: 500 },
    SQLITE_CORRUPT_SEQUENCE: { code: 500 },
    SQLITE_CORRUPT_VTAB: { code: 500 },
    SQLITE_ERROR_MISSING_COLLSEQ: { code: 500 },
    SQLITE_ERROR_RETRY: { code: 500 },
    SQLITE_ERROR_SNAPSHOT: { code: 500 },
    SQLITE_IOERR_ACCESS: { code: 500 },
    SQLITE_IOERR_AUTH: { code: 500 },
    SQLITE_IOERR_BEGIN_ATOMIC: { code: 500 },
    SQLITE_IOERR_BLOCKED: { code: 500 },
    SQLITE_IOERR_CHECKRESERVEDLOCK: { code: 500 },
    SQLITE_IOERR_CLOSE: { code: 500 },
    SQLITE_IOERR_COMMIT_ATOMIC: { code: 500 },
    SQLITE_IOERR_CONVPATH: { code: 500 },
    SQLITE_IOERR_CORRUPTFS: { code: 500 },
    SQLITE_IOERR_DATA: { code: 500 },
    SQLITE_IOERR_DELETE: { code: 500 },
    SQLITE_IOERR_DELETE_NOENT: { code: 500 },
    SQLITE_IOERR_DIR_CLOSE: { code: 500 },
    SQLITE_IOERR_DIR_FSYNC: { code: 500 },
    SQLITE_IOERR_FSTAT: { code: 500 },
    SQLITE_IOERR_FSYNC: { code: 500 },
    SQLITE_IOERR_GETTEMPPATH: { code: 500 },
    SQLITE_IOERR_LOCK: { code: 500 },
    SQLITE_IOERR_MMAP: { code: 500 },
    SQLITE_IOERR_NOMEM: { code: 500 },
    SQLITE_IOERR_RDLOCK: { code: 500 },
    SQLITE_IOERR_READ: { code: 500 },
    SQLITE_IOERR_ROLLBACK_ATOMIC: { code: 500 },
    SQLITE_IOERR_SEEK: { code: 500 },
    SQLITE_IOERR_SHMLOCK: { code: 500 },
    SQLITE_IOERR_SHMMAP: { code: 500 },
    SQLITE_IOERR_SHMOPEN: { code: 500 },
    SQLITE_IOERR_SHMSIZE: { code: 500 },
    SQLITE_IOERR_SHORT_READ: { code: 500 },
    SQLITE_IOERR_TRUNCATE: { code: 500 },
    SQLITE_IOERR_UNLOCK: { code: 500 },
    SQLITE_IOERR_VNODE: { code: 500 },
    SQLITE_IOERR_WRITE: { code: 500 },
    SQLITE_LOCKED_SHAREDCACHE: { code: 500 },
    SQLITE_LOCKED_VTAB: { code: 500 },
    SQLITE_NOTICE_RECOVER_ROLLBACK: { code: 500 },
    SQLITE_NOTICE_RECOVER_WAL: { code: 500 },
    SQLITE_OK_LOAD_PERMANENTLY: { code: 200 },
    SQLITE_READONLY_CANTINIT: { code: 403 },
    SQLITE_READONLY_CANTLOCK: { code: 403 },
    SQLITE_READONLY_DBMOVED: { code: 403 },
    SQLITE_READONLY_DIRECTORY: { code: 403 },
    SQLITE_READONLY_RECOVERY: { code: 403 },
    SQLITE_READONLY_ROLLBACK: { code: 403 }
}

/**
 * Parser function for SQLITE_CONSTRAINT_UNIQUE errors
 *
 * @param {string} error_message - the error message, from Error.message
 * @return {[boolean, number, string]} [whether the error was processed, the HTTP status code to return, the message to return]
 */
function processConstraintUnique(error_message: string): [boolean, number, string] {
    // the composite composition-identity index is an EXPRESSION index (composer_id, name, COALESCE(part,'')),
    // so SQLite reports the violation by index name - "UNIQUE constraint failed: index
    // 'idx_compositions_composer_name_part'" - rather than listing columns. Match that (and the older
    // column-listing form of the pre-part index, in case it lingers) so the (composer, name, part) violation
    // gets a clear message rather than falling through to the generic default. Mirrors
    // _assertNoCompositionDuplicates.
    if (
        /UNIQUE constraint failed: index 'idx_compositions_composer_name_part'/.test(error_message) ||
        /UNIQUE constraint failed: compositions\.composer_id,\s*compositions\.name/.test(error_message)
    ) {
        return [
            true,
            409,
            `Invalid request body: a composition with this name and part already exists for this composer`
        ]
    }
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
        return [
            true,
            503,
            `A database table required for this operation ("${table}") does not exist. The service may be misconfigured or undergoing maintenance; please contact an administrator.`
        ]
    }
    const column = error_message.match(/no such column:?\s*([A-Za-z0-9_.]+)/i)
    if (column) {
        return [
            true,
            500,
            `A database column required for this operation ("${column[1]}") does not exist. The database schema may be out of date.`
        ]
    }
    if (/syntax error/i.test(error_message)) {
        return [
            true,
            500,
            "The server generated an invalid database query. Please report this issue to an administrator."
        ]
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
 * Converts an error thrown by D1 into the appropriate HTTP status code
 *
 * @param {Error} error - the error thrown by D1
 * @returns {[HttpStatus, string | null]} [the HTTP status code, the message; if null, ignore code and use default]
 */
export function convertSQLiteError(error: Error): [HttpStatus, string | null] {
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
                return [code as HttpStatus, message]
            }
            // the processor could not refine this error; fall back to the entry's own code/message
            return [error_info.code, error_info.message || null]
        }
        return [error_info.code, error_info.message || null]
    }
    return [500, null]
}
