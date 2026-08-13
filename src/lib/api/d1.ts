/**
 * lib/api/d1.ts
 *
 * Provides primitives to access Cloudflare D1, including adding records, searching records, and deleting records
 *
 *
 * The D1 primitives provided by this library, except the command primitive, deliberately exclude complex SQL features since (1) they aren't necessary and (2) they provide protection against injection.
 *
 * Record *shape* validation is not here: the shared spec engine lives in record_spec.ts and the
 * per-entity sanitizers, specs, and assert wrappers in composer.ts / composition.ts / contributor.ts.
 * What remains below is schema-level only — the three D1Schema constants and the `recordTypeAssert*`
 * functions, which merely narrow a row's TS type by schema identity and check column membership.
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
import { SQLStatement } from "./sql_statement.ts"
import { dbWriteEnabled } from "./environment.ts"
import { CONTRIBUTOR_TABLE, COMPOSER_TABLE, COMPOSITION_TABLE } from "./tables.ts"

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
 * Verbs that modify the database, matched at the start of a statement after any leading whitespace or
 * comments. `WITH` is included because a CTE can front an INSERT/UPDATE/DELETE.
 */
const WRITE_VERB_PATTERN = /^(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|WITH|VACUUM|ATTACH)\b/i

/**
 * Applies the staging write gate to a raw SQL string.
 *
 * `exec_stmt`/`exec_stmt_batch` get this for free — a SQLStatement carries its verb — but the raw-string
 * paths (the admin SQL terminal via POST /api/v1/command, and tokens.ts's INSERT/UPDATE) went straight to
 * _exec with no check, so the environment's write gate simply did not cover them. Not currently
 * exploitable, because identity.ts 404s all of /api on staging before a handler runs; this closes the gap
 * so that remains a second line of defence rather than the only one.
 *
 * The verb match is a heuristic over opaque SQL, deliberately erring toward refusal: `WITH` is treated as
 * a write even though `WITH … SELECT` is a read, since the only cost is that a read-only CTE cannot be run
 * from the terminal on staging — where the terminal is unreachable anyway.
 *
 * @param command the raw SQL string about to be executed
 * @throws an error when the statement writes and writes are disabled in this environment
 */
function _assertRawWriteAllowed(command: string): void {
    // strip leading whitespace and SQL comments so a comment cannot hide the verb
    const stripped = command.replace(/^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, "")
    if (WRITE_VERB_PATTERN.test(stripped) && !dbWriteEnabled()) {
        throw new Error("Database writes are disabled in this environment")
    }
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
    _assertRawWriteAllowed(command)
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
    commands.forEach(_assertRawWriteAllowed)
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
    // checked up front rather than per statement: this path is not transactional, so refusing halfway
    // would leave the earlier statements applied
    commands.forEach(_assertRawWriteAllowed)
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
