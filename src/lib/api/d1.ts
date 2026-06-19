/**
 * lib/api/d1.ts
 * 
 * Provides primitives to access Cloudflare D1, including adding records, searching records, and deleting records
 * 
 * 
 * The D1 primitives provided by this library, except the command primitive, deliberately exclude complex SQL features since (1) they aren't necessary and (2) they provide protection against injection.
 * 
 */

import { env } from "cloudflare:workers"
import { Key, WorkType } from "./common.ts"
import { SQLStatement } from "./sql.ts"
import { dbWriteEnabled } from "./environment.ts"
import {
    isDeathYearConsistent,
    isValidCountryCode,
    isValidEmail,
    isValidImageUrl,
    isValidPitchRange,
    isValidPosition,
    isValidYear,
    SUPPORTED_URI_TYPES,
    validateURIForType
} from "./validation.ts"


/*
 * D1 table spec info
 *
 * CREATE TABLE contributors (
 *   contributor_id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   name TEXT UNIQUE NOT NULL,
 *   class_year INTEGER,
 *   major TEXT,
 *   phases TEXT,
 *   bio TEXT,
 *   public_email TEXT,
 *   identity_email TEXT UNIQUE NOT NULL,
 *   active INTEGER NOT NULL,
 *   roles TEXT NOT NULL,
 *   admin INTEGER NOT NULL,
 *   image TEXT,
 *   tags TEXT,
 *   entry_date TEXT NOT NULL,
 *   change_date TEXT
 * );
 *
 * CREATE TABLE composers (
 *   composer_id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   name TEXT UNIQUE NOT NULL,
 *   role TEXT NOT NULL,
 *   birth_year INTEGER NOT NULL,
 *   death_year INTEGER NOT NULL,
 *   country TEXT NOT NULL,
 *   bio TEXT,
 *   image TEXT,
 *   tags TEXT,
 *   entry_date TEXT NOT NULL,
 *   change_date TEXT
 * );
 *
 * CREATE TABLE compositions (
 *   composition_id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   name TEXT NOT NULL,
 *   composer_id INTEGER NOT NULL,
 *   contrib_primary_1 INTEGER NOT NULL,
 *   contrib_primary_2 INTEGER,
 *   contrib_addl TEXT,
 *   author_secondary TEXT,
 *   type TEXT NOT NULL,
 *   part TEXT,
 *   rating_suzuki INTEGER,
 *   rating_nyssma INTEGER,
 *   publish_location TEXT NOT NULL,
 *   publish_name TEXT NOT NULL,
 *   publish_year INTEGER NOT NULL,
 *   uri_type TEXT NOT NULL,
 *   uri TEXT,
 *   key TEXT,
 *   range TEXT,
 *   position_highest TEXT,
 *   notes_pedagogical TEXT,
 *   notes_historical TEXT,
 *   notes_other TEXT,
 *   image TEXT,
 *   phases TEXT NOT NULL,
 *   entry_date TEXT NOT NULL,
 *   tags TEXT,
 *   change_date TEXT,
 *   FOREIGN KEY (composer_id) REFERENCES composers(composer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
 *   FOREIGN KEY (contrib_primary_1) REFERENCES contributors(contributor_id) ON UPDATE CASCADE ON DELETE RESTRICT,
 *   FOREIGN KEY (contrib_primary_2) REFERENCES contributors(contributor_id) ON UPDATE CASCADE ON DELETE RESTRICT
 * );
 */



/**
 * Schema for contributors table
 */
export const CONTRIBUTOR: D1Schema = {
    db: env.DB_MAIN,
    name: "contributors",
    columns: ["contributor_id", "name", "class_year", "major", "phases", "bio", "public_email", "identity_email", "active", "roles", "admin", "image", "tags", "entry_date", "change_date"],
    index: ["contributor_id", "identity_email", "public_email"],
    repr_exclude: ["entry_date", "change_date"],
    primary_key: "contributor_id",
    type_hint: {
        contributor_id: "number",
        name: "string",
        class_year: "number",
        major: "string",
        phases: "string", // comma-separated phase numbers, which are converted to a number array later
        bio: "string",
        public_email: "string",
        identity_email: "string",
        active: "number",
        roles: "string", // also a comma-separated string array
        admin: "number",
        image: "string",
        tags: "string",
        entry_date: "string",
        change_date: "string"
    },
    protected: ["roles", "admin", "identity_email"]
}

/**
 * Schema for composers table
 */
export const COMPOSER: D1Schema = {
    db: env.DB_MAIN,
    name: "composers",
    columns: ["composer_id", "name", "role", "birth_year", "death_year", "country", "bio", "image", "tags", "entry_date", "change_date"],
    index: ["composer_id", "name"],
    repr_exclude: ["entry_date", "change_date"],
    primary_key: "composer_id",
    type_hint: {
        composer_id: "number",
        name: "string",
        role: "string",
        birth_year: "number",
        death_year: "number",
        country: "string",
        bio: "string",
        image: "string",
        tags: "string",
        entry_date: "string",
        change_date: "string"
    }
}

/**
 * Schema for compositions table
 */
export const COMPOSITION: D1Schema = {
    db: env.DB_MAIN,
    name: "compositions",
    // columns use shape of Composition interface
    columns: ["composition_id", "name", "composer_id", "contrib_primary_1", "contrib_primary_2",
        "contrib_addl", "author_secondary", "type", "part", "rating_suzuki", "rating_nyssma", "publish_location",
        "publish_name", "publish_year", "uri_type", "uri", "key", "range", "position_highest", "notes_pedagogical",
        "notes_historical", "notes_other", "image", "phases", "entry_date", "tags", "change_date"],
    index: ["composition_id"],
    repr_exclude: ["entry_date", "change_date"],
    primary_key: "composition_id",
    type_hint: {
        composition_id: "number",
        name: "string",
        composer_id: "number",
        contrib_primary_1: "number", // contributor ID
        contrib_primary_2: "number",
        contrib_addl: "string", // comma-separated contributor IDs
        author_secondary: "string", // comma-separated secondary composer IDs
        type: "string",
        part: "string",
        rating_suzuki: "number",
        rating_nyssma: "number",
        publish_location: "string",
        publish_name: "string",
        publish_year: "number",
        uri_type: "string",
        uri: "string",
        key: "string",
        range: "string",
        position_highest: "string",
        notes_pedagogical: "string",
        notes_historical: "string",
        notes_other: "string",
        image: "string",
        phases: "string", // comma-separated phase numbers, which are converted to a number array later
        entry_date: "string",
        tags: "string",
        change_date: "string"
    }
}

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
    return Object.fromEntries(
        Object.entries(record).filter(([key]) => !protectedKeys.includes(key))
    )
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
        throw new Error(`Failed to prepare SQL statement [${command}]: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }

    let exec_result
    try {
        exec_result = await prepared.bind(...params).run()
    } catch (error) {
        throw new Error(`Failed to execute SQL statement [${command}]: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
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
        throw new Error(`Failed to finalize ${stmt.verb} statement on table '${stmt.from}': ${error instanceof Error ? error.message : String(error)}`, { cause: error })
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
            throw new Error(`Failed to prepare SQL statement [${command}]: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
        }
    }

    let results: D1Result[]
    try {
        results = await env.DB_MAIN.batch(prepared)
    } catch (error) {
        // a batch failure rolls back every statement; surface the original message for the error hook
        throw new Error(`Failed to execute SQL batch: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }

    // batch() resolves only when the transaction commits, but guard against a result flagged unsuccessful
    if (results.some(result => !result.success)) {
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
    const statement = `SELECT * FROM ${schema.name} WHERE ${schema.primary_key} = ?;`
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
    const statement = `SELECT * FROM ${schema.name} WHERE ${param} = ?;`
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
export function recordTypeAssertComplete(schema: D1Schema, record: Record<string, string | number | null>, validate: boolean = true): D1Contributor | D1Composer | D1Composition {
    if (validate) {
        const params = new Set(schema.columns.concat(schema.repr_exclude))
        if (Object.keys(record).some(key => !params.has(key))) {
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
export function recordTypeAssertPartial(schema: D1Schema, record: Record<string, string | number | null>, validate: boolean = true): Partial<D1Contributor> | Partial<D1Composer> | Partial<D1Composition> {
    if (validate) {
        const params = new Set(schema.columns.concat(schema.repr_exclude))
        if (Object.keys(record).some(key => !params.has(key))) {
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
export function recordTypeAssert(schema: D1Schema, record: Record<string, string | number | null>, validate: boolean = true): [D1Contributor | D1Composer | D1Composition | Partial<D1Contributor> | Partial<D1Composer> | Partial<D1Composition>, boolean] {
    const params = schema.columns.concat(schema.repr_exclude)
    const args = Object.keys(record)
    if (validate) {
        if (args.some(key => !params.includes(key))) {
            throw new Error("Record has extraneous parameters")
        }
    }
    const is_complete = params.every(column => column in record)
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
    elementCheck?: (value: any) => string | null
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
    // id is nullable on inbound records: it must be a number, or absent (undefined) when not expected
    if ((typeof r.id !== "number") && (typeof r.id !== "undefined" || expect_id)) {
        return "Record has invalid types for one or more parameters"
    }
    for (const field in spec) {
        const value = r[field]
        if (partial && value === undefined) {
            continue
        }
        if (spec[field].invalid(value, partial)) {
            return "Record has invalid types for one or more parameters"
        }
    }
    // validate arrays are of correct type, once all base checks have passed
    for (const field in spec) {
        const elementCheck = spec[field].elementCheck
        if (!elementCheck) {
            continue
        }
        const value = r[field]
        if (partial && value === undefined) {
            continue
        }
        const error = elementCheck(value)
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
const _invalidNullableImage = (v: any) => v !== null && (typeof v !== "string" || (v.trim() !== "" && !isValidImageUrl(v)))
// a nullable email field: null, or a string that (when non-blank) is a valid email address
const _invalidNullableEmail = (v: any) => v !== null && (typeof v !== "string" || (v.trim() !== "" && !isValidEmail(v)))
// every element of an array is a positive integer (used for id and phase-number lists)
const _allPositiveIntegers = (v: any[]) => v.every((item: any) => typeof item === "number" && Number.isInteger(item) && item >= 1)

/** Field spec for Contributor records. */
const CONTRIBUTOR_SPEC: RecordSpec = {
    name: { invalid: _invalidString },
    // class_year, major, and phases are nullable columns, so null is accepted alongside their base types
    // class_year, when present, is a positive (4-digit) year
    class_year: { invalid: v => v !== null && (typeof v !== "number" || !isValidYear(v)) },
    major: { invalid: _invalidNullableString },
    phases: {
        invalid: v => !(v instanceof Array) && v !== null,
        // phase numbers must be positive integers
        elementCheck: v => (v !== null && v.length > 0 && !_allPositiveIntegers(v))
            ? "Record has invalid value for phases parameter (expected positive integers)" : null
    },
    bio: { invalid: _invalidNullableString },
    public_email: { invalid: _invalidNullableEmail },
    // identity_email is filled with a generated fallback address before validation when blank, so by the
    // time it reaches here it is always a present, non-blank string and must be a valid email
    identity_email: { invalid: v => typeof v !== "string" || !isValidEmail(v) },
    active: { invalid: _invalidBoolean },
    roles: {
        invalid: v => !(v instanceof Array),
        elementCheck: v => (!v.every((role: any) => typeof role === "string") && v.length > 0)
            ? "Record has invalid type for roles parameter" : null
    },
    admin: { invalid: _invalidBoolean },
    image: { invalid: _invalidNullableImage }
}

/** Field spec for Composer records. */
const COMPOSER_SPEC: RecordSpec = {
    name: { invalid: _invalidString },
    role: { invalid: _invalidString },
    // birth_year is a positive (4-digit) year; death_year additionally permits the -1 "living" sentinel
    birth_year: { invalid: v => typeof v !== "number" || !isValidYear(v) },
    death_year: { invalid: v => typeof v !== "number" || !isValidYear(v, true) },
    // country is standardized to an ISO 3166-1 alpha-2 code (mirrors the client-side argParse check)
    country: { invalid: v => typeof v !== "string" || !isValidCountryCode(v) },
    image: { invalid: _invalidNullableImage },
    bio: { invalid: _invalidNullableString }
}

/**
 * Given an unknown object from JSON, determine if it is a complete Contributor record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a Contributor type if valid, or a string error message if invalid
 */
export function _stateTypeAssertCompleteContributor(record: unknown, expect_id: boolean = true): Contributor | string {
    const result = assertRecordBySpec(record, CONTRIBUTOR_SPEC, false, expect_id)
    return result === true ? record as Contributor : result
}

/**
 * Given an unknown object from JSON, determine if it is a valid partial Contributor record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a partial Contributor type if valid, or a string error message if invalid
 */
export function _stateTypeAssertPartialContributor(record: unknown, expect_id: boolean = true): Partial<Contributor> | string {
    const result = assertRecordBySpec(record, CONTRIBUTOR_SPEC, true, expect_id)
    return result === true ? record as Partial<Contributor> : result
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
    return consistency === true ? record as Composer : consistency
}

/**
 * Given an unknown object from JSON, determine if it is a valid partial Composer record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a partial Composer type if valid, or a string error message if invalid
 */
export function _stateTypeAssertPartialComposer(record: unknown, expect_id: boolean = true): Partial<Composer> | string {
    const result = assertRecordBySpec(record, COMPOSER_SPEC, true, expect_id)
    if (result !== true) {
        return result
    }
    const consistency = composerYearsConsistent(record as { [key: string]: any })
    return consistency === true ? record as Partial<Composer> : consistency
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
    return partial ? tests.some(test => test) : tests.every(test => test)
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
    return partial ? tests.some(test => test) : tests.every(test => test)
}
/** Field spec for Composition records. */
const COMPOSITION_SPEC: RecordSpec = {
    name: { invalid: _invalidString },
    // id references must be positive integers (1-based record ids)
    composer_id: { invalid: v => typeof v !== "number" || !Number.isInteger(v) || v < 1 },
    contrib_primary_1: { invalid: v => typeof v !== "number" || !Number.isInteger(v) || v < 1 },
    contrib_primary_2: { invalid: v => v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 1) },
    contrib_addl: {
        invalid: v => !(v instanceof Array),
        elementCheck: v => (v.length > 0 && !_allPositiveIntegers(v))
            ? "Record has invalid value for contrib_addl parameter (expected positive integer ids)" : null
    },
    author_secondary: {
        invalid: v => !(v instanceof Array),
        elementCheck: v => (v.length > 0 && !_allPositiveIntegers(v))
            ? "Record has invalid value for author_secondary parameter (expected positive integer ids)" : null
    },
    phases: {
        invalid: v => !(v instanceof Array),
        elementCheck: v => (v.length > 0 && !_allPositiveIntegers(v))
            ? "Record has invalid value for phases parameter (expected positive integers)" : null
    },
    type: { invalid: v => typeof v !== "string" && !(v in WorkType) },
    part: { invalid: _invalidNullableString },
    key: { invalid: v => (typeof v !== "string" && !(v in Key)) && v !== null },
    // range: a two-note pitch range (e.g. G3-A5); position_highest: a Roman numeral or integer. Both are
    // nullable, and a blank string is tolerated (mapped to a cleared value); a non-blank value must match.
    range: { invalid: v => v !== null && (typeof v !== "string" || (v.trim() !== "" && !isValidPitchRange(v))) },
    position_highest: { invalid: v => v !== null && (typeof v !== "string" || (v.trim() !== "" && !isValidPosition(v))) },
    notes_pedagogical: { invalid: _invalidNullableString },
    notes_historical: { invalid: _invalidNullableString },
    notes_other: { invalid: _invalidNullableString },
    image: { invalid: _invalidNullableImage },
    // rating is nullable only in complete mode; in partial mode a present rating must validate
    // (mirrors the original, which dropped the !== null guard and passed partial=true to validateCompRating)
    rating: { invalid: (v, partial) => partial ? !validateCompRating(v, true) : (v !== null && !validateCompRating(v, false)) },
    publication_info: { invalid: (v, partial) => !validatePubInfo(v, partial) }
}

/**
 * Given an unknown object from JSON, determine if it is a complete Composition record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a Composition type if valid, or a string error message if invalid
 */
export function _stateTypeAssertCompleteComposition(record: unknown, expect_id: boolean = true): Composition | string {
    const result = assertRecordBySpec(record, COMPOSITION_SPEC, false, expect_id)
    return result === true ? record as Composition : result
}

/**
 * Given an unknown object from JSON, determine if it is a valid partial Composition record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a partial Composition type if valid, or a string error message if invalid
 */
export function _stateTypeAssertPartialComposition(record: unknown, expect_id: boolean = true): Partial<Composition> | string {
    const result = assertRecordBySpec(record, COMPOSITION_SPEC, true, expect_id)
    return result === true ? record as Partial<Composition> : result
}