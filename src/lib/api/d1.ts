/**
 * lib/api/d1.ts
 *
 * Provides primitives to access Cloudflare D1, including adding records, searching records, and deleting records
 *
 *
 * The D1 primitives provided by this library, except the command primitive, deliberately exclude complex SQL features since (1) they aren't necessary and (2) they provide protection against injection.
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
import { Key, WorkType } from "./common.ts"
import { SQLStatement } from "./sql.ts"
import { dbWriteEnabled } from "./environment.ts"
import { CONTRIBUTOR_TABLE, COMPOSER_TABLE, COMPOSITION_TABLE } from "./tables.ts"
import {
    isDeathYearConsistent,
    isValidCountryCode,
    isValidEmail,
    isValidImageUrl,
    isValidPitchRange,
    isValidPosition,
    isValidYear,
    SUPPORTED_URI_TYPES,
    validateCitations,
    validateURIForType
} from "./validation.ts"

/**
 * Schema for contributors table
 */
export const CONTRIBUTOR: D1Schema = { db: env.DB_MAIN, ...CONTRIBUTOR_TABLE }

/**
 * Schema for composers table
 */
export const COMPOSER: D1Schema = { db: env.DB_MAIN, ...COMPOSER_TABLE }

/**
 * Schema for compositions table
 */
export const COMPOSITION: D1Schema = { db: env.DB_MAIN, ...COMPOSITION_TABLE }

/**
 * Strips a schema's protected properties (schema.protected) from a record before it leaves the server
 *
 * Read wrappers (getContributor/listContributors) intentionally return full records for server-side use;
 * client-facing read endpoints must redact protected columns from records the requester is not entitled
 * to see in full. Centralizing that here gives one tested chokepoint instead of an ad-hoc inline filter
 * duplicated per endpoint, so a future endpoint is less likely to forget to redact.
 *
 * @param schema - the D1Schema whose `protected` list names the columns to remove (no-op when absent)
 * @param record - the record to redact
 * @returns a shallow copy of the record with protected properties removed
 */
export function redactProtected(schema: D1Schema, record: object): Record<string, unknown> {
    const protectedKeys = schema.protected
    if (!protectedKeys || protectedKeys.length === 0) {
        return { ...record }
    }
    return Object.fromEntries(Object.entries(record).filter(([key]) => !protectedKeys.includes(key)))
}

/**
 * Internal function to prepare and execute a SQL command with supplied parameters
 *
 * @param command the SQL command to execute, with parameter placeholders
 * @param params the parameters to bind to the command, in order
 * @returns a D1Result object containing the results of the command execution
 * @throws an error if preparation or execution fails, or if execution does not succeed
 */
async function _exec(command: string, params: unknown[]): Promise<D1Result> {
    let prepared: D1PreparedStatement
    try {
        prepared = env.DB_MAIN.prepare(command)
    } catch (error) {
        // identify the failing stage (preparation) and the offending statement; the original message is
        // appended verbatim so any embedded SQLITE_ code is preserved for the error hook and cause chain
        throw new Error(
            `Failed to prepare SQL statement [${command}]: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
        )
    }

    let exec_result
    try {
        exec_result = await prepared.bind(...params).run()
    } catch (error) {
        throw new Error(
            `Failed to execute SQL statement [${command}]: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
        )
    }

    if (!exec_result.success) {
        throw new Error(`SQL execution did not succeed for statement [${command}]`)
    }

    return exec_result // will format later
}

/**
 * Execute a SQLStatement object using _exec()
 *
 * @param stmt the SQLStatement object to execute
 * @returns a D1Result object containing the results of the command execution
 * @throws an error if preparation or execution fails, or if execution does not succeed
 */
export async function exec_stmt(stmt: SQLStatement): Promise<D1Result> {
    // dbWriteEnabled gates all writes issued through the statement abstraction; it resolves the runtime
    // environment from the request URL recorded by the requestContext middleware (writes are disabled on
    // staging, where the API and admin are unavailable)
    if (stmt.verb !== "SELECT" && !dbWriteEnabled()) {
        throw new Error("Database writes are disabled in this environment")
    }
    let finished
    try {
        finished = stmt.finish()
    } catch (error) {
        // name the operation (verb + table) that failed to finalize so the cause is identifiable upstream
        throw new Error(
            `Failed to finalize ${stmt.verb} statement on table '${stmt.from}': ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
        )
    }
    const [command, params] = finished
    const result = await _exec(command, params)
    if (!result) {
        throw new Error(`Failed to execute ${stmt.verb} statement on table '${stmt.from}'`)
    }
    return result
}

/**
 * Execute a raw SQL command string with parameters using _exec()
 *
 * @param command the SQL command to execute
 * @param params the parameters to bind to the command, in order
 * @returns a D1Result object containing the results of the command execution
 * @throws an error if preparation or execution fails, or if execution does not succeed
 */
export async function exec_string(command: string, params: unknown[] = []): Promise<D1Result> {
    const result = await _exec(command, params)
    if (!result) {
        throw new Error("Failed to execute SQL statement")
    }
    return result
}

/**
 * Execute several raw SQL command strings in a single atomic batch.
 *
 * The statements are prepared and handed to D1's batch() API, which wraps them in an implicit
 * transaction: they run sequentially in the order supplied, and if any statement fails the entire
 * batch is rolled back (no partial application). Parameter binding is not exposed here since these
 * commands originate from the admin terminal as complete literal SQL.
 *
 * @param commands the SQL command strings to execute, in order (must be non-empty)
 * @returns an array of D1Result objects, one per command, in the same order
 * @throws an error if any statement fails to prepare or execute, or if the batch does not succeed
 */
export async function exec_string_batch(commands: string[]): Promise<D1Result[]> {
    if (commands.length === 0) {
        throw new Error("No SQL commands supplied for batch execution")
    }
    const prepared: D1PreparedStatement[] = []
    for (const command of commands) {
        try {
            prepared.push(env.DB_MAIN.prepare(command))
        } catch (error) {
            // mirror _exec's preparation error so the offending statement and any SQLITE_ code survive
            throw new Error(
                `Failed to prepare SQL statement [${command}]: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error }
            )
        }
    }

    let results: D1Result[]
    try {
        results = await env.DB_MAIN.batch(prepared)
    } catch (error) {
        // a batch failure rolls back every statement; surface the original message for the error hook
        throw new Error(`Failed to execute SQL batch: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error
        })
    }

    // batch() resolves only when the transaction commits, but guard against a result flagged unsuccessful
    if (results.some((result) => !result.success)) {
        throw new Error("SQL execution did not succeed for one or more statements in the batch")
    }
    return results
}

/**
 * Execute several SQLStatement objects in a single atomic batch.
 *
 * Each statement is finalized ({@link SQLStatement.finish}), prepared, and bound with its own
 * parameters, then handed to D1's batch() API, which wraps the prepared statements in an implicit
 * transaction: they run sequentially in the supplied order, and if any statement fails the entire
 * batch is rolled back (no partial application). Unlike {@link exec_string_batch}, this preserves
 * parameter binding, so it is the primitive used for atomic bulk inserts of validated records.
 *
 * Each returned D1Result carries its own meta (including last_row_id), so a batch of single-row
 * INSERTs yields one id per record — the reason callers build one INSERT per record rather than a
 * single multi-row VALUES statement (which would report only a single last_row_id).
 *
 * @param stmts the SQLStatement objects to execute, in order (must be non-empty)
 * @returns an array of D1Result objects, one per statement, in the same order
 * @throws an error if writes are disabled, or if any statement fails to finalize, prepare, or execute
 */
export async function exec_stmt_batch(stmts: SQLStatement[]): Promise<D1Result[]> {
    if (stmts.length === 0) {
        throw new Error("No SQL statements supplied for batch execution")
    }
    // mirror exec_stmt's write gate: a single non-SELECT verb disables the whole batch off-write
    // environments (e.g. staging), since a batch is committed atomically as one unit
    if (stmts.some((stmt) => stmt.verb !== "SELECT") && !dbWriteEnabled()) {
        throw new Error("Database writes are disabled in this environment")
    }
    const prepared: D1PreparedStatement[] = []
    for (const stmt of stmts) {
        let finished: [string, Array<string | number | null>]
        try {
            finished = stmt.finish()
        } catch (error) {
            // name the operation (verb + table) that failed to finalize so the cause is identifiable
            throw new Error(
                `Failed to finalize ${stmt.verb} statement on table '${stmt.from}': ${error instanceof Error ? error.message : String(error)}`,
                { cause: error }
            )
        }
        const [command, params] = finished
        try {
            prepared.push(env.DB_MAIN.prepare(command).bind(...params))
        } catch (error) {
            // mirror _exec's preparation error so the offending statement and any SQLITE_ code survive
            throw new Error(
                `Failed to prepare SQL statement [${command}]: ${error instanceof Error ? error.message : String(error)}`,
                { cause: error }
            )
        }
    }

    let results: D1Result[]
    try {
        results = await env.DB_MAIN.batch(prepared)
    } catch (error) {
        // a batch failure rolls back every statement; surface the original message for the error hook
        throw new Error(`Failed to execute SQL batch: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error
        })
    }

    // batch() resolves only when the transaction commits, but guard against a result flagged unsuccessful
    if (results.some((result) => !result.success)) {
        throw new Error("SQL execution did not succeed for one or more statements in the batch")
    }
    return results
}

/**
 * Execute several raw SQL command strings sequentially, each as its own statement.
 *
 * Unlike {@link exec_string_batch}, the statements are NOT wrapped in a transaction: each runs and
 * commits independently, so a failure leaves the already-executed statements applied. Execution stops
 * at the first failure (the error from _exec propagates), and only the results up to that point are lost.
 *
 * @param commands the SQL command strings to execute, in order (must be non-empty)
 * @returns an array of D1Result objects, one per command, in the same order
 * @throws an error if any statement fails to prepare or execute
 */
export async function exec_string_sequential(commands: string[]): Promise<D1Result[]> {
    if (commands.length === 0) {
        throw new Error("No SQL commands supplied for execution")
    }
    const results: D1Result[] = []
    for (const command of commands) {
        results.push(await _exec(command, []))
    }
    return results
}

/**
 * Perform a simple lookup by primary key (without caching or SQLStatement abstraction)
 * @param schema the D1Schema of the record being queried
 * @param id the primary key value of the record being queried
 * @returns a D1Result object containing the results of the lookup
 * @throws an error if the lookup fails
 */
export async function getRecord(schema: D1Schema, id: number): Promise<D1Result> {
    // Select the schema's known columns explicitly rather than `*`. A table that carries a column not in
    // the schema (e.g. one removed from the schema but not yet migrated out of the DB) would otherwise flow
    // through recordTypeAssertComplete as an "extraneous parameter" and throw; on the authorization path
    // that throw is swallowed and reads back as an unenrolled identity, locking every caller out. Selecting
    // by column keeps code and DB decoupled. Column names are trusted schema constants, not user input.
    const statement = `SELECT ${schema.columns.join(", ")} FROM ${schema.name} WHERE ${schema.primary_key} = ?;`
    return _exec(statement, [id.toString()])
}

/**
 * Perform a simple lookup by a specific indexed parameter (without caching or SQLStatement abstraction)
 * @param schema the D1Schema of the record being queried
 * @param param the parameter to query by
 * @param value the value to match against the parameter
 * @returns a D1Result object containing the results of the lookup
 * @throws an error if the lookup fails
 */
export async function getRecordSpecificProp(schema: D1Schema, param: string, value: string): Promise<D1Result> {
    // mainly used in authorization mechanism to query
    // the value is bound, but `param` is interpolated into the column position, so it must be constrained
    // to a known schema column (mirrors SQLStatement.finish()'s allow-list); a caller that ever forwards a
    // user-supplied column name therefore cannot inject SQL through the identifier position
    if (!schema.columns.includes(param)) {
        throw new Error(`Invalid column '${param}' for table '${schema.name}'`)
    }
    // explicit columns, not `*` — see getRecord: selecting only schema columns tolerates a DB that still
    // carries a since-removed column, so a schema/DB drift cannot throw in recordTypeAssertComplete and
    // silently lock out authorization (the identity_email lookup that backs every request runs through here)
    const statement = `SELECT ${schema.columns.join(", ")} FROM ${schema.name} WHERE ${param} = ?;`
    return _exec(statement, [value])
}

/**
 * Delete a record by primary key (without caching or SQLStatement abstraction)
 * @param schema the D1Schema of the record being deleted
 * @param id the primary key value of the record being deleted
 * @returns a D1Result object containing the results of the deletion operation
 * @throws an error if the deletion fails
 */
export async function deleteRecord(schema: D1Schema, id: number): Promise<D1Result> {
    const statement = `DELETE FROM ${schema.name} WHERE ${schema.primary_key} = ?;`
    return _exec(statement, [id.toString()])
}

// complex operations, i.e. insertion, updates, and complex selects, can only be performed using exec_stmt

/**
 * Provides a type assertion and key validation for a record not originating from D1 directly
 *
 * @param schema the D1Schema of the record being asserted
 * @param record the record for which type assertion is requested
 * @param validate whether to perform key validation, default true
 * @returns the record with a TS type assertion
 *
 */
export function recordTypeAssertComplete(
    schema: D1Schema,
    record: Record<string, string | number | null>,
    validate: boolean = true
): D1Contributor | D1Composer | D1Composition {
    if (validate) {
        const params = new Set(schema.columns.concat(schema.repr_exclude))
        if (Object.keys(record).some((key) => !params.has(key))) {
            throw new Error("Record is missing required parameters or has extraneous parameters")
        }
    }
    switch (schema) {
        case CONTRIBUTOR:
            return record as D1Contributor
        case COMPOSER:
            return record as D1Composer
        case COMPOSITION:
            return record as D1Composition
        default:
            throw new Error("Invalid schema provided for type assertion")
    }
}

/**
 * Provides a type assertion and key validation for a record that may be partial
 *
 * @param schema the D1Schema of the record being asserted
 * @param record the record for which type assertion is requested
 * @param validate whether to perform key validation, default true
 * @return the record with a TS type assertion, along with a boolean indicating whether the record is complete
 */
export function recordTypeAssertPartial(
    schema: D1Schema,
    record: Record<string, string | number | null>,
    validate: boolean = true
): Partial<D1Contributor> | Partial<D1Composer> | Partial<D1Composition> {
    if (validate) {
        const params = new Set(schema.columns.concat(schema.repr_exclude))
        if (Object.keys(record).some((key) => !params.has(key))) {
            throw new Error("Record has extraneous parameters")
        }
    }
    switch (schema) {
        case CONTRIBUTOR:
            return record as Partial<D1Contributor>
        case COMPOSER:
            return record as Partial<D1Composer>
        case COMPOSITION:
            return record as Partial<D1Composition>
        default:
            throw new Error("Invalid schema provided for type assertion")
    }
}

/**
 * Provide a general type assertion for a record that may be complete or partial, with optional key validation
 *
 * @param schema the D1Schema of the record being asserted
 * @param record the record for which type assertion is requested
 * @param validate whether to perform key validation, default true
 * @returns the record with a TS type assertion, along with a boolean indicating whether the record is complete
 */
export function recordTypeAssert(
    schema: D1Schema,
    record: Record<string, string | number | null>,
    validate: boolean = true
): [
    D1Contributor | D1Composer | D1Composition | Partial<D1Contributor> | Partial<D1Composer> | Partial<D1Composition>,
    boolean
] {
    const params = schema.columns.concat(schema.repr_exclude)
    const args = Object.keys(record)
    if (validate) {
        if (args.some((key) => !params.includes(key))) {
            throw new Error("Record has extraneous parameters")
        }
    }
    const is_complete = params.every((column) => column in record)
    switch (schema) {
        case CONTRIBUTOR:
            return [record as D1Contributor | Partial<D1Contributor>, is_complete]
        case COMPOSER:
            return [record as D1Composer | Partial<D1Composer>, is_complete]
        case COMPOSITION:
            return [record as D1Composition | Partial<D1Composition>, is_complete]
        default:
            throw new Error("Invalid schema provided for type assertion")
    }
}

/**
 * A per-field validation rule consumed by {@link assertRecordBySpec}.
 *   - `invalid` returns true when a present (non-undefined) value is invalid for the field; it
 *     receives the `partial` flag for the few fields whose rule depends on it (rating/pub info).
 *   - `elementCheck` performs a secondary array-element validation, returning a field-specific
 *     error message or null. It only runs after every base check has passed.
 */
type FieldRule = {
    invalid: (value: any, partial: boolean) => boolean
    elementCheck?: (value: any, partial: boolean) => string | null
}

type RecordSpec = { [field: string]: FieldRule }

/**
 * Shared, declarative implementation of the per-type record validators below. It reproduces the
 * checks the hand-written validators previously inlined, in the same order and with identical error
 * strings:
 *   - the id column keeps its special rule (a number, or absent/undefined when expect_id is false)
 *   - in partial mode an undefined field is skipped; in complete mode an absent field fails its own
 *     base check (typeof undefined never matches a base type), so presence is enforced implicitly
 *   - base type checks run first (any failure yields the generic message); array-element checks run
 *     afterwards in spec order so their field-specific messages are preserved
 *
 * @returns true if the record satisfies the spec, otherwise a string error message
 */
function assertRecordBySpec(record: unknown, spec: RecordSpec, partial: boolean, expect_id: boolean): true | string {
    // type guard
    if (typeof record !== "object" || record === null) {
        return "Record is not an object"
    }
    const r = record as { [key: string]: any }
    // collect every field that fails its base check so the caller can report exactly what is invalid,
    // rather than a single generic message. In complete mode an absent field fails its own base check
    // (typeof undefined never matches a base type), so a missing required field is named here too.
    const invalid_fields: string[] = []
    // id is nullable on inbound records: it must be a number, or absent (undefined) when not expected
    if (typeof r.id !== "number" && (typeof r.id !== "undefined" || expect_id)) {
        invalid_fields.push("id")
    }
    for (const field in spec) {
        const value = r[field]
        if (partial && value === undefined) {
            continue
        }
        if (spec[field].invalid(value, partial)) {
            invalid_fields.push(field)
        }
    }
    if (invalid_fields.length > 0) {
        return `Record has invalid or missing values for parameter(s): ${invalid_fields.join(", ")}`
    }
    // validate arrays are of correct type, once all base checks have passed; these carry their own
    // field-specific messages describing the expected element type
    for (const field in spec) {
        const elementCheck = spec[field].elementCheck
        if (!elementCheck) {
            continue
        }
        const value = r[field]
        if (partial && value === undefined) {
            continue
        }
        const error = elementCheck(value, partial)
        if (error) {
            return error
        }
    }
    return true
}

// shared field predicates: each returns true when the value is invalid for that field
const _invalidString = (v: any) => typeof v !== "string"
const _invalidBoolean = (v: any) => typeof v !== "boolean"
// nullable variants accept null alongside the base type
const _invalidNullableString = (v: any) => typeof v !== "string" && v !== null
// a nullable image field: null, or a string that (when non-blank) is a valid image URL or internal path
const _invalidNullableImage = (v: any) =>
    v !== null && (typeof v !== "string" || (v.trim() !== "" && !isValidImageUrl(v)))
// a nullable email field: null, or a string that (when non-blank) is a valid email address
const _invalidNullableEmail = (v: any) => v !== null && (typeof v !== "string" || (v.trim() !== "" && !isValidEmail(v)))
// an optional key-value object field (citations): undefined/null is valid (the field is optional); a
// present value must be a non-array object, with per-entry format errors surfaced via elementCheck
const _invalidOptionalObject = (v: any) => v !== undefined && v !== null && (typeof v !== "object" || Array.isArray(v))
// every element of an array is a positive integer (used for id and phase-number lists)
const _allPositiveIntegers = (v: any[]) =>
    v.every((item: any) => typeof item === "number" && Number.isInteger(item) && item >= 1)
// membership in a string enum's VALUES (string enums have no reverse key mapping, so `v in Enum` would
// wrongly test the enum's keys); used to enforce the closed option sets for a composition's type and key
const _isEnumValue = (v: any, members: Record<string, string>) =>
    typeof v === "string" && (Object.values(members) as string[]).includes(v)

/** Field spec for Contributor records. */
const CONTRIBUTOR_SPEC: RecordSpec = {
    name: { invalid: _invalidString },
    // class_year, major, and phases are nullable columns, so null is accepted alongside their base types
    // class_year, when present, is a positive (4-digit) year
    class_year: { invalid: (v) => v !== null && (typeof v !== "number" || !isValidYear(v)) },
    major: { invalid: _invalidNullableString },
    phases: {
        invalid: (v) => !(v instanceof Array) && v !== null,
        // phase numbers must be positive integers
        elementCheck: (v) =>
            v !== null && v.length > 0 && !_allPositiveIntegers(v)
                ? "Record has invalid value for phases parameter (expected positive integers)"
                : null
    },
    bio: { invalid: _invalidNullableString },
    public_email: { invalid: _invalidNullableEmail },
    // identity_email is filled with a generated fallback address before validation when blank, so by the
    // time it reaches here it is always a present, non-blank string and must be a valid email
    identity_email: { invalid: (v) => typeof v !== "string" || !isValidEmail(v) },
    active: { invalid: _invalidBoolean },
    roles: {
        invalid: (v) => !(v instanceof Array),
        elementCheck: (v) =>
            !v.every((role: any) => typeof role === "string") && v.length > 0
                ? "Record has invalid type for roles parameter"
                : null
    },
    admin: { invalid: _invalidBoolean },
    image: { invalid: _invalidNullableImage }
}

/** Field spec for Composer records. */
const COMPOSER_SPEC: RecordSpec = {
    name: { invalid: _invalidString },
    role: { invalid: _invalidString },
    // birth_year is a positive (4-digit) year; death_year additionally permits the -1 "living" sentinel
    birth_year: { invalid: (v) => typeof v !== "number" || !isValidYear(v) },
    death_year: { invalid: (v) => typeof v !== "number" || !isValidYear(v, true) },
    // country is standardized to an ISO 3166-1 alpha-2 code (mirrors the client-side argParse check)
    country: { invalid: (v) => typeof v !== "string" || !isValidCountryCode(v) },
    image: { invalid: _invalidNullableImage },
    bio: { invalid: _invalidNullableString },
    // citations is optional (docs/dev/miscellaneous.txt); when present, every entry must be a non-blank
    // source name mapped to an https link, DOI, or ISBN (validateCitations)
    citations: {
        invalid: _invalidOptionalObject,
        elementCheck: (v) => (v === undefined || v === null ? null : validateCitations(v))
    }
}

/**
 * Given an unknown object from JSON, determine if it is a complete Contributor record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a Contributor type if valid, or a string error message if invalid
 */
export function _stateTypeAssertCompleteContributor(record: unknown, expect_id: boolean = true): Contributor | string {
    const result = assertRecordBySpec(record, CONTRIBUTOR_SPEC, false, expect_id)
    return result === true ? (record as Contributor) : result
}

/**
 * Given an unknown object from JSON, determine if it is a valid partial Contributor record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a partial Contributor type if valid, or a string error message if invalid
 */
export function _stateTypeAssertPartialContributor(
    record: unknown,
    expect_id: boolean = true
): Partial<Contributor> | string {
    const result = assertRecordBySpec(record, CONTRIBUTOR_SPEC, true, expect_id)
    return result === true ? (record as Partial<Contributor>) : result
}

/**
 * Cross-field consistency check for composer years: a composer's death_year must fall on or after their
 * birth_year, unless it is the -1 "still living" sentinel. Only enforced when both years are present as
 * numbers (so a partial update touching only one year is not rejected against an absent counterpart);
 * the per-field shape of each year is already validated by COMPOSER_SPEC before this runs.
 *
 * @param record the (already per-field validated) composer record or partial record
 * @returns true if the years are consistent, otherwise a string error message
 */
function composerYearsConsistent(record: { [key: string]: any }): true | string {
    const birth = record.birth_year
    const death = record.death_year
    if (typeof birth === "number" && typeof death === "number" && !isDeathYearConsistent(birth, death)) {
        return "Record has invalid death_year (must be greater than or equal to birth_year, or -1 if living)"
    }
    return true
}

/**
 * Given an unknown object from JSON, determine if it is a complete Composer record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a Composer type if valid, or a string error message if invalid
 */
export function _stateTypeAssertCompleteComposer(record: unknown, expect_id: boolean = true): Composer | string {
    const result = assertRecordBySpec(record, COMPOSER_SPEC, false, expect_id)
    if (result !== true) {
        return result
    }
    const consistency = composerYearsConsistent(record as { [key: string]: any })
    return consistency === true ? (record as Composer) : consistency
}

/**
 * Given an unknown object from JSON, determine if it is a valid partial Composer record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a partial Composer type if valid, or a string error message if invalid
 */
export function _stateTypeAssertPartialComposer(
    record: unknown,
    expect_id: boolean = true
): Partial<Composer> | string {
    const result = assertRecordBySpec(record, COMPOSER_SPEC, true, expect_id)
    if (result !== true) {
        return result
    }
    const consistency = composerYearsConsistent(record as { [key: string]: any })
    return consistency === true ? (record as Partial<Composer>) : consistency
}

/**
 * Validates a single rating member (Suzuki or NYSSMA level). Each member is independently nullable: a
 * null is accepted (an unrated level), otherwise the value must be an integer within the member's range.
 *
 * @param value the rating member value
 * @param min the inclusive lower bound for a present (non-null) level
 * @param max the inclusive upper bound for a present (non-null) level
 * @returns true if the member is null or an in-range integer
 */
function validateRatingMember(value: any, min: number, max: number): boolean {
    if (value === null) {
        return true
    }
    return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
}

/**
 * Given an unknown object from JSON, determine if it is a valid CompositionRating. The suzuki and nyssma
 * members are independently nullable; when present, suzuki must be an integer in 1–10 and nyssma in 1–6
 * (mirrors the client-side constructRating bounds). In complete mode both members must be present and
 * valid; in partial mode at least one must be present and valid.
 *
 * @param record the record to check
 * @param partial whether a partial rating (a single member) is acceptable
 * @returns true if the record is a valid rating
 */
function validateCompRating(record: unknown, partial: boolean = false): boolean {
    if (typeof record !== "object" || record === null) {
        return false
    }
    const r = record as { [key: string]: any }

    const tests: boolean[] = [
        "suzuki" in r ? validateRatingMember(r.suzuki, 1, 10) : false,
        "nyssma" in r ? validateRatingMember(r.nyssma, 1, 6) : false
    ]
    return partial ? tests.some((test) => test) : tests.every((test) => test)
}

/** * Given an unknown object from JSON, determine if it is a complete PublicationInfo record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a PublicationInfo type if valid, or a string error message if invalid
 */
function validatePubInfo(record: unknown, partial: boolean = false): boolean {
    if (typeof record !== "object" || record === null) {
        return false
    }
    const r = record as { [key: string]: any }
    const tests: boolean[] = [
        "location" in r ? typeof r.location === "string" : false,
        "name" in r ? typeof r.name === "string" : false,
        // the publication year must be a positive integer (a 4-digit year is the expected form)
        "year" in r ? isValidYear(r.year) : false,
        "uri_type" in r ? typeof r.uri_type === "string" : false,
        "uri" in r ? typeof r.uri === "string" : false
    ]
    // The uri_type is authoritative: when present it must be a supported type, and a non-empty uri must
    // match that type's shape. This is enforced regardless of partial/complete so an inconsistent
    // type/URI pairing is always rejected (a blank uri carries nothing to validate against and is allowed,
    // since the uri column is nullable). A missing uri_type defers to the type checks above.
    if ("uri_type" in r && typeof r.uri_type === "string") {
        if (!SUPPORTED_URI_TYPES.includes(r.uri_type)) {
            return false
        }
        if ("uri" in r && typeof r.uri === "string" && r.uri.trim() !== "" && !validateURIForType(r.uri_type, r.uri)) {
            return false
        }
    }
    return partial ? tests.some((test) => test) : tests.every((test) => test)
}

/**
 * Produces a granular error message for an invalid publication_info, naming the exact offending subproperty
 * using its D1 column name (publish_location / publish_name / publish_year / uri_type / uri) so the import
 * preview can highlight the specific input. This never changes the accept/reject decision — it defers to
 * {@link validatePubInfo} for that and only computes a message when the value is already known to be invalid.
 *
 * @param record the publication_info value (already established to be an object by the field's base check)
 * @param partial whether a partial publication_info (at least one field) is acceptable
 * @returns a specific error message, or null when the value is valid
 */
function validatePubInfoDetail(record: unknown, partial: boolean): string | null {
    if (validatePubInfo(record, partial)) {
        return null
    }
    if (typeof record !== "object" || record === null) {
        return "Record has invalid value for publication_info (expected an object)"
    }
    const r = record as { [key: string]: any }
    // present-but-malformed subproperty (including the uri_type authority checks); report the first one
    if ("location" in r && typeof r.location !== "string") {
        return "Record has invalid value for publish_location (expected text)"
    }
    if ("name" in r && typeof r.name !== "string") {
        return "Record has invalid value for publish_name (expected text)"
    }
    if ("year" in r && !isValidYear(r.year)) {
        return "Record has invalid value for publish_year (expected a valid year)"
    }
    if ("uri_type" in r) {
        if (typeof r.uri_type !== "string" || !SUPPORTED_URI_TYPES.includes(r.uri_type)) {
            return `Record has invalid value for uri_type (expected one of: ${SUPPORTED_URI_TYPES.join(", ")})`
        }
        if ("uri" in r && typeof r.uri === "string" && r.uri.trim() !== "" && !validateURIForType(r.uri_type, r.uri)) {
            return "Record has invalid value for uri (does not match the selected uri_type)"
        }
    }
    if ("uri" in r && typeof r.uri !== "string") {
        return "Record has invalid value for uri (expected text)"
    }
    // otherwise the failure is a missing required subproperty (complete mode)
    const required: Array<[string, boolean]> = [
        ["publish_location", "location" in r],
        ["publish_name", "name" in r],
        ["publish_year", "year" in r],
        ["uri_type", "uri_type" in r],
        ["uri", "uri" in r]
    ]
    const missing = required.filter(([, present]) => !present).map(([column]) => column)
    if (missing.length > 0) {
        return `Record is missing required publication_info field(s): ${missing.join(", ")}`
    }
    return "Record has invalid value for publication_info"
}

/**
 * Produces a granular error message for an invalid rating, naming the offending member using its D1 column
 * name (rating_suzuki / rating_nyssma). Like {@link validatePubInfoDetail}, it defers the accept/reject
 * decision to {@link validateCompRating} and only computes a message for an already-invalid value.
 *
 * @param record the rating value (already established to be a non-null object by the field's base check)
 * @param partial whether a partial rating (a single member) is acceptable
 * @returns a specific error message, or null when the value is valid
 */
function validateCompRatingDetail(record: unknown, partial: boolean): string | null {
    if (validateCompRating(record, partial)) {
        return null
    }
    if (typeof record !== "object" || record === null) {
        return "Record has invalid value for rating (expected an object)"
    }
    const r = record as { [key: string]: any }
    if ("suzuki" in r && !validateRatingMember(r.suzuki, 1, 10)) {
        return "Record has invalid value for rating_suzuki (expected an integer 1–10, or null)"
    }
    if ("nyssma" in r && !validateRatingMember(r.nyssma, 1, 6)) {
        return "Record has invalid value for rating_nyssma (expected an integer 1–6, or null)"
    }
    return "Record has invalid value for rating"
}

/** Field spec for Composition records. */
const COMPOSITION_SPEC: RecordSpec = {
    name: { invalid: _invalidString },
    // id references must be positive integers (1-based record ids)
    composer_id: { invalid: (v) => typeof v !== "number" || !Number.isInteger(v) || v < 1 },
    contrib_primary_1: { invalid: (v) => typeof v !== "number" || !Number.isInteger(v) || v < 1 },
    contrib_primary_2: { invalid: (v) => v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 1) },
    contrib_addl: {
        invalid: (v) => !(v instanceof Array),
        elementCheck: (v) =>
            v.length > 0 && !_allPositiveIntegers(v)
                ? "Record has invalid value for contrib_addl parameter (expected positive integer ids)"
                : null
    },
    author_secondary: {
        invalid: (v) => !(v instanceof Array),
        elementCheck: (v) =>
            v.length > 0 && !_allPositiveIntegers(v)
                ? "Record has invalid value for author_secondary parameter (expected positive integer ids)"
                : null
    },
    phases: {
        invalid: (v) => !(v instanceof Array),
        elementCheck: (v) =>
            v.length > 0 && !_allPositiveIntegers(v)
                ? "Record has invalid value for phases parameter (expected positive integers)"
                : null
    },
    // type is a required, closed option set: the value must be one of the WorkType enum values
    type: { invalid: (v) => !_isEnumValue(v, WorkType) },
    part: { invalid: _invalidNullableString },
    // key is nullable and a blank string is tolerated (mapped to a cleared value); a non-blank value must
    // be one of the Key enum values
    key: { invalid: (v) => v !== null && (typeof v !== "string" || (v.trim() !== "" && !_isEnumValue(v, Key))) },
    // range: a two-note pitch range (e.g. G3-A5); position_highest: a Roman numeral or integer. Both are
    // nullable, and a blank string is tolerated (mapped to a cleared value); a non-blank value must match.
    range: { invalid: (v) => v !== null && (typeof v !== "string" || (v.trim() !== "" && !isValidPitchRange(v))) },
    position_highest: {
        invalid: (v) => v !== null && (typeof v !== "string" || (v.trim() !== "" && !isValidPosition(v)))
    },
    notes_pedagogical: { invalid: _invalidNullableString },
    notes_historical: { invalid: _invalidNullableString },
    notes_other: { invalid: _invalidNullableString },
    image: { invalid: _invalidNullableImage },
    // rating is nullable only in complete mode; in partial mode a present rating must validate. The base
    // check only rejects the hard cases (a non-object, or a null where null is not allowed); the granular
    // per-member validation runs in elementCheck so the offending member (rating_suzuki / rating_nyssma) can
    // be named. The union of the two reproduces the original accept/reject exactly.
    rating: {
        invalid: (v, partial) => (partial ? typeof v !== "object" || v === null : v !== null && typeof v !== "object"),
        elementCheck: (v, partial) => (v === null ? null : validateCompRatingDetail(v, partial))
    },
    // publication_info is required and non-null; the base check only rejects a non-object, and the granular
    // per-subproperty validation (naming publish_name/publish_year/uri_type/uri) runs in elementCheck.
    publication_info: {
        invalid: (v) => typeof v !== "object" || v === null,
        elementCheck: (v, partial) => validatePubInfoDetail(v, partial)
    },
    // citations is optional (docs/dev/miscellaneous.txt); when present, every entry must be a non-blank
    // source name mapped to an https link, DOI, or ISBN (validateCitations)
    citations: {
        invalid: _invalidOptionalObject,
        elementCheck: (v) => (v === undefined || v === null ? null : validateCitations(v))
    }
}

/**
 * Given an unknown object from JSON, determine if it is a complete Composition record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a Composition type if valid, or a string error message if invalid
 */
export function _stateTypeAssertCompleteComposition(record: unknown, expect_id: boolean = true): Composition | string {
    const result = assertRecordBySpec(record, COMPOSITION_SPEC, false, expect_id)
    return result === true ? (record as Composition) : result
}

/**
 * Given an unknown object from JSON, determine if it is a valid partial Composition record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a partial Composition type if valid, or a string error message if invalid
 */
export function _stateTypeAssertPartialComposition(
    record: unknown,
    expect_id: boolean = true
): Partial<Composition> | string {
    const result = assertRecordBySpec(record, COMPOSITION_SPEC, true, expect_id)
    return result === true ? (record as Partial<Composition>) : result
}
