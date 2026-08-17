/**
 * lib/api/database.ts
 *
 * Provides higher-level database services on top of D1, integrating KV caching and Cache API caching
 *
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
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

/*
 * WARNING
 * Security-relevant operations should not use the database access primitives provided by this module since cache data may
 * become out of sync. Instead, directly use the D1 primitives to directly query the database.
 */

import {
    formatContribToD1,
    formatContribToD1Partial,
    formatCompToD1,
    formatWorkToD1,
    formatWorkToD1Partial,
    formatCompToD1Partial,
    formatContribFromD1,
    formatCompFromD1,
    formatWorkFromD1,
    SQLCompareOp
} from "./common.ts"
import {
    CONTRIBUTOR,
    COMPOSER,
    COMPOSITION,
    exec_stmt,
    exec_stmt_batch,
    getRecord,
    getRecordSpecificProp,
    exec_string,
    recordTypeAssertComplete
} from "./d1.ts"
import { SQLStatement } from "./sql_statement.ts"
import { VirtualSQLTable } from "./sql_virtual_table.ts"
import { getKey, setKey, deleteKey, listKeys } from "./kv.ts"
import { getCache, putCache, deleteCacheKey } from "./caching.ts"
import { invalidateIdentityCache } from "./authorize.ts"

// in general, authorization is managed by the API endpoint, so no identity checks are made in this module

/**
 * Purges the KV caching layer
 *
 * @param fixed Whether to purge only known keys, or purge all enrolled keys
 */
async function purgeKV(fixed: boolean = true): Promise<void> {
    // purges KV entries; best-effort, since a KV usage limit hit mid-purge should not throw (stale
    // entries expire on their own via the KV TTL)
    const safeDelete = async (key: string): Promise<void> => {
        try {
            await deleteKey(key)
        } catch (error) {
            console.warn(`Failed to purge KV key '${key}'; it will expire via TTL`, error)
        }
    }
    if (fixed) {
        // purge only known keys
        const known_keys = ["composers", "contributors", "compositions"]
        await Promise.all(known_keys.map(safeDelete))
        return
    } else {
        try {
            const keys = (await listKeys(false)) as string[]
            await Promise.all(keys.map(safeDelete))
        } catch (error) {
            // a list is itself a metered KV operation; if it is unavailable, leave entries to expire
            console.warn("Failed to list KV keys during purge; entries will expire via TTL", error)
        }
        return
    }
}

/**
 * Purges the Cache API and KV cache
 *
 * @param kv_fixed Whether to purge only known keys from KV, or purge all enrolled keys in KV
 * @returns {boolean} Whether the Cache API purge succeeded
 */
export async function purgeCacheAll(kv_fixed: boolean = true): Promise<boolean> {
    // the Workers Cache API has no store-wide purge, so evict the known per-table entries directly
    const known_keys = ["composers", "contributors", "compositions"]
    await Promise.all(known_keys.map((key) => deleteCacheKey("db_cache", key)))
    await purgeKV(kv_fixed) // KV deletion succeeds whether the key exists or not
    // a thrown eviction would propagate; reaching here means the per-key purge + KV purge completed
    return true
}

/**
 * The storage tiers a read can be served from, ordered cheapest/fastest first and expensive/authoritative last
 */
type StorageTier = "cache-api" | "kv" | "d1"

/**
 * Classifies whether an error relates to storage capacity (which can be cured by deleting files)
 *
 * @param error the thrown value to classify
 * @returns whether the error should be treated as a recoverable capacity condition
 */
function isCapacityError(error: unknown): boolean {
    const markers = ["limit", "exceeded", "quota", "429", "too many", "rate limit", "throttl", "daily", "overloaded"]
    const flatten = (value: unknown, depth: number = 0): string => {
        if (!value || depth > 4) {
            return ""
        }
        if (typeof value === "string") {
            return value
        }
        if (value instanceof Error) {
            return `${value.message} ${flatten((value as { cause?: unknown }).cause, depth + 1)}`
        }
        try {
            return JSON.stringify(value)
        } catch {
            return String(value)
        }
    }
    return markers.some((marker) => flatten(error).toLowerCase().includes(marker))
}

/**
 * Schedules a best-effort cache write
 *
 * @param ctx the Worker ExecutionContext, used to keep the write alive past the response
 * @param operation the cache-population/invalidation operation to run
 */
function _backfill(ctx: ExecutionContext, operation: () => Promise<unknown>): void {
    ctx.waitUntil(
        operation().catch((error) => {
            console.warn("Best-effort cache operation failed; continuing without it", error)
        })
    )
}

/**
 * Coerces a value pulled from a cache tier into table rows, tolerating both the bare-array shape this
 * module writes and the legacy `{ results: [...] }` shape
 *
 * @param value the raw cached value
 * @returns the rows, or null if the value is empty or not row-shaped
 */
function _asRows(value: unknown): Record<string, string | number | null>[] | null {
    if (!value) {
        return null
    }
    if (Array.isArray(value)) {
        return value as Record<string, string | number | null>[]
    }
    if (typeof value === "object" && "results" in (value as Record<string, unknown>)) {
        const results = (value as { results?: unknown }).results
        if (Array.isArray(results)) {
            return results as Record<string, string | number | null>[]
        }
    }
    return null
}

/**
 * Resolves the full contents of a table for virtual execution, degrading gracefully across storage
 * tiers as usage limits are hit
 *
 * @param table the table name to resolve
 * @param long whether to cache the table under the long Cache API policy
 * @param ctx the Worker ExecutionContext
 * @returns the resolved rows and the tier that served them
 * @throws if every tier is exhausted (the authoritative D1 read fails)
 */
async function _resolveTable(
    table: string,
    long: boolean,
    ctx: ExecutionContext
): Promise<{ rows: Record<string, string | number | null>[]; origin: StorageTier }> {
    // Tier 1: Cache API (free, fastest)
    try {
        const rows = _asRows(await getCache("db_cache", table))
        if (rows) {
            return { rows, origin: "cache-api" }
        }
    } catch (error) {
        console.warn(`Cache API read failed for table '${table}'; degrading to KV`, error)
    }

    // Tier 2: KV (cheap, but capped at 100k reads/day on the free plan)
    try {
        const rows = _asRows(await getKey(table))
        if (rows) {
            // promote into the Cache API so subsequent reads can avoid KV entirely
            _backfill(ctx, () => putCache("db_cache", table, rows, new Date().toISOString(), long))
            return { rows, origin: "kv" }
        }
    } catch (error) {
        console.warn(`KV read failed for table '${table}'; degrading to D1`, error)
    }

    // Tier 3: D1 (authoritative source of truth) - a failure here is terminal
    const result = await exec_string(`SELECT * FROM ${table}`)
    const rows = result.results as Record<string, string | number | null>[]
    // repopulate both faster tiers best-effort so the next read does not have to reach D1
    _backfill(ctx, () => putCache("db_cache", table, rows, new Date().toISOString(), long))
    _backfill(ctx, () => setKey(table, rows, "json"))
    return { rows, origin: "d1" }
}

/**
 * Reads a query result cached under its statement identifier from the Cache API
 *
 * @param identifier the statement identifier (see SQLStatement.identifier)
 * @returns the cached rows, or null on a miss or read failure
 */
async function _cacheFetchIdentifier(identifier: string): Promise<Record<string, string | number | null>[] | null> {
    try {
        return _asRows(await getCache("db_cache", identifier))
    } catch (error) {
        console.warn(`Cache API read failed for query '${identifier}'; treating as a miss`, error)
        return null
    }
}

/**
 * Execute the provided SQLStatement with the caching system context in runtime
 *
 * @param stmt the SQLStatement to execute
 * @param ctx the Cloudflare Worker ExecutionContext
 * @returns the results of the SQLStatement execution as an array of records
 *
 */
async function _exec_wrap(stmt: SQLStatement, ctx: ExecutionContext): Promise<ExecResult> {
    // wraps exec_stmt commands to provide caching through KV and the Cache API
    // see lib/api/caching.ts for caching policy overview
    const identifier = stmt.identifier()
    if (identifier === null) {
        // SQLStatement.identifier() returns null if the verb is not "SELECT": these verbs mutate state, so
        // they can only be served by the authoritative D1 tier. There is no fallback for a write - a usage
        // limit here propagates because the change genuinely cannot be persisted anywhere else.
        const output = await exec_stmt(stmt)
        // the write succeeded, so the now-stale caches are invalidated best-effort (a failed eviction must
        // not fail the write; the entries will also expire on their own via TTL). The Workers Cache API has
        // no store-wide purge, so invalidation is per-key against the affected table.
        if (stmt.from) {
            _invalidateTableCaches(ctx, stmt.from)
        }
        return {
            data: output.results as Record<string, string | number | null>[],
            cached: false,
            query_scope: "local",
            meta: output.meta
        }
    }
    if (stmt.isSimple()) {
        // simple SELECTs run against the whole table on the virtual engine, so they can be satisfied from
        // whichever storage tier is still within its limits. _resolveTable walks Cache API -> KV -> D1 and
        // only throws once every tier is exhausted.
        const { rows, origin } = await _resolveTable(stmt.from!, true, ctx)
        const output = new VirtualSQLTable(stmt.schema, rows).execute(stmt)
        return {
            data: output as Record<string, string | number | null>[],
            cached: origin !== "d1",
            query_scope: "global"
        }
    }

    // non-simple SELECTs (those using ORDER BY / LIMIT) cannot be keyed by table name, so they are served
    // from the identifier-keyed Cache API entry, then D1.
    const cached = await _cacheFetchIdentifier(identifier)
    if (cached) {
        return { data: cached, cached: true, query_scope: "local" }
    }
    try {
        const output = await exec_stmt(stmt)
        _backfill(ctx, () =>
            putCache(
                "db_cache",
                identifier,
                output.results as Record<string, string | number | null>[],
                new Date().toISOString(),
                false
            )
        )
        return {
            data: output.results as Record<string, string | number | null>[],
            cached: false,
            query_scope: "local",
            meta: output.meta
        }
    } catch (error) {
        // D1 is the last dedicated tier for this query shape. Only attempt the degraded fallback below when
        // D1 is unavailable specifically because of a usage limit; a genuine query error propagates.
        if (!isCapacityError(error)) {
            throw error
        }
        console.warn(
            `D1 unavailable for query '${identifier}' due to a usage limit; attempting degraded whole-table execution`,
            error
        )
    }

    // Last resort: pull the whole table from whatever tier is still available and execute the statement on
    // the virtual engine (VirtualSQLTable.execute supports ORDER BY and LIMIT, so the output is correct).
    // This is gated behind D1 exhaustion only because it reads the entire table rather than letting D1 do a
    // targeted query. If no tier can supply the table either, _resolveTable throws and the request fails -
    // every option has then been exhausted.
    const { rows } = await _resolveTable(stmt.from!, true, ctx)
    const output = new VirtualSQLTable(stmt.schema, rows).execute(stmt)
    return {
        data: output as Record<string, string | number | null>[],
        cached: true,
        query_scope: "global"
    }
}

/**
 * Invalidate the caches backing a table after a successful write.
 *
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param tableName the name of the table that was written (a D1Schema.name)
 */
function _invalidateTableCaches(ctx: ExecutionContext, tableName: string): void {
    _backfill(ctx, () => deleteKey(tableName))
    _backfill(ctx, () => deleteCacheKey("db_cache", tableName))
    if (tableName === CONTRIBUTOR.name) {
        invalidateIdentityCache()
    }
}

/**
 * Exported interface to execute a SQLStatement with the caching context
 *
 * @see _exec_wrap for full details
 *
 * @param {SQLStatement} stmt the SQLStatement to execute
 * @param {ExecutionContext} ctx the Cloudflare Worker ExecutionContext
 * @return {Promise<ExecResult>} the output
 *
 */
export async function run_stmt(stmt: SQLStatement, ctx: ExecutionContext): Promise<ExecResult> {
    return await _exec_wrap(stmt, ctx)
}

/**
 * Internal function to add a new record to the database, with type assertion and cache management
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param schema the D1Schema of the record being added
 * @param record the record to add, as a Contributor, Composition, or Composer type
 * @returns the ID of the newly added record
 * @throws an error if the record is invalid or if the schema is invalid
 */
export async function _addPrimitive(
    ctx: ExecutionContext,
    schema: D1Schema,
    record: Contributor | Composition | Composer
): Promise<number> {
    const stmt = new SQLStatement(schema, "INSERT", schema.name) // new record insertion uses all columns since none are specified
    let entry
    switch (schema) {
        case CONTRIBUTOR:
            entry = formatContribToD1(record as Contributor)
            break
        case COMPOSER:
            entry = formatCompToD1(record as Composer)
            break
        case COMPOSITION:
            entry = formatWorkToD1(record as Composition)
            break
        default:
            throw new Error("Invalid schema")
    }
    stmt.addValueGroup(entry)
    stmt.voidValue(0, schema.primary_key)
    // entry_date (creation) and change_date (last-modified) are managed here, not from caller input;
    // on insert both are stamped with the same instant since creation is also the first modification
    const now = Date.now()
    stmt.editValue(0, "entry_date", now)
    stmt.editValue(0, "change_date", now)
    const output = await _exec_wrap(stmt, ctx)
    return output.meta!.last_row_id
}

/**
 * Internal function to add several records of one type to the database in a single atomic transaction
 *
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param schema the D1Schema of the records being added
 * @param records the records to add (must be non-empty), all of the schema's type
 * @returns the ids of the newly added records, in the same order as the input
 * @throws an error if the schema is invalid, or if the atomic batch fails (nothing is written)
 */
export async function _addPrimitiveBatch(
    ctx: ExecutionContext,
    schema: D1Schema,
    records: Array<Contributor | Composition | Composer>
): Promise<number[]> {
    if (records.length === 0) {
        throw new Error("No records supplied for batch insertion")
    }
    // a single timestamp for the whole batch: every record is created (and first modified) at the same instant
    const now = Date.now()
    const stmts = records.map((record) => {
        const stmt = new SQLStatement(schema, "INSERT", schema.name)
        let entry
        switch (schema) {
            case CONTRIBUTOR:
                entry = formatContribToD1(record as Contributor)
                break
            case COMPOSER:
                entry = formatCompToD1(record as Composer)
                break
            case COMPOSITION:
                entry = formatWorkToD1(record as Composition)
                break
            default:
                throw new Error("Invalid schema")
        }
        stmt.addValueGroup(entry)
        stmt.voidValue(0, schema.primary_key)
        stmt.editValue(0, "entry_date", now)
        stmt.editValue(0, "change_date", now)
        return stmt
    })
    const results = await exec_stmt_batch(stmts)
    // the write succeeded atomically; invalidate the table's stale caches once
    _invalidateTableCaches(ctx, schema.name)
    return results.map((result) => result.meta!.last_row_id)
}

/**
 * Exposed internal function to perform a cacheless read from D1
 *
 * @param schema the D1Schema of the record being queried
 * @param param the unique column being queried on
 * @param value the value of the unique column being queried
 * @returns the record matching the query as a primitive record type, or null if not found
 * @throws an error if the param is not a unique column
 */
export async function _getPrimitiveCacheless(
    schema: D1Schema,
    param: string,
    value: string
): Promise<Record<string, string | number | null> | null> {
    // the _getPrimitiveCacheless variant provides direct access to D1, bypassing the caching layers
    // this function may be used in lieu of D1 primitives for security-relevant operations
    if (!schema.index.includes(param)) {
        throw new Error("Param is not a unique column")
    }
    let response: D1Result
    if (param === schema.primary_key) {
        response = await getRecord(schema, parseInt(value))
    } else {
        response = await getRecordSpecificProp(schema, param, value)
    }
    if (response.results.length === 0) {
        return null
    }
    return response.results[0] as Record<string, string | number | null>
}

/**
 * Internal function to perform a read from D1, with type assertion and cache management
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param schema the D1Schema of the record being queried
 * @param param the unique column being queried on
 * @param value the value of the unique column being queried
 * @return the record matching the query as a primitive record type, or null if not found
 * @throws an error if the param is not a unique column
 */
export async function _getPrimitive(
    ctx: ExecutionContext,
    schema: D1Schema,
    param: string,
    value: string
): Promise<Record<string, string | number | null> | null> {
    if (!schema.index.includes(param)) {
        throw new Error("Param is not a unique column")
    }
    const stmt = new SQLStatement(schema, "SELECT", schema.name)
    stmt.addWhere(param, value, SQLCompareOp.EQ)
    const response: ExecResult = await _exec_wrap(stmt, ctx)
    if (response.data.length === 0) {
        return null
    }
    return response.data[0]
}

/**
 * Internal function to update a record in the database, with type assertion and cache management
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param schema the D1Schema of the record being updated
 * @param id the ID of the record being updated
 * @param record the updated record, as a Contributor, Composition, or Composer type
 * @returns null
 * @throws an error if the record is invalid or if the schema is invalid
 */
export async function _updatePrimitive(
    ctx: ExecutionContext,
    schema: D1Schema,
    id: number,
    record: Contributor | Composition | Composer
): Promise<null> {
    const stmt = new SQLStatement(schema, "UPDATE", schema.name)
    let entry
    switch (schema) {
        case CONTRIBUTOR:
            entry = formatContribToD1(record as Contributor)
            break
        case COMPOSER:
            entry = formatCompToD1(record as Composer)
            break
        case COMPOSITION:
            entry = formatWorkToD1(record as Composition)
            break
        default:
            throw new Error("Invalid schema")
    }
    stmt.addColumns(schema.columns.filter((col) => col !== schema.primary_key && !schema.repr_exclude.includes(col))) // exclude primary key and hidden meta columns (entry_date, change_date) from update
    stmt.addValueGroup(entry, [schema.primary_key, ...schema.repr_exclude]) // exclude primary key and hidden meta columns; change_date is restamped below, entry_date is preserved
    // change_date tracks the last modification, so it is stamped here on every update (entry_date is left untouched)
    stmt.editValue(0, "change_date", Date.now())
    stmt.addWhere(schema.primary_key, id.toString(), SQLCompareOp.EQ)
    await _exec_wrap(stmt, ctx)
    return null
}

/**
 * Internal function to perform a partial update on a record in the database, with type assertion and cache management
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param schema the D1Schema of the record being updated
 * @param id the ID of the record being updated
 * @param record the updated record, as a partial Contributor, Composition, or Composer type; only provided fields will be updated
 * @param allowProtected whether the caller has authorized writing schema.protected columns (e.g. roles/admin/
 *   identity_email); defaults to false so a caller that omits its own elevation check cannot mass-assign them
 * @returns null
 * @throws an error if the record is invalid, if the schema is invalid, or if it writes a protected column without authorization
 */
export async function _updatePrimitivePartial(
    ctx: ExecutionContext,
    schema: D1Schema,
    id: number,
    record: Partial<Contributor | Composition | Composer>,
    allowProtected: boolean = false
): Promise<null> {
    const stmt = new SQLStatement(schema, "UPDATE", schema.name)

    let entry
    switch (schema) {
        case CONTRIBUTOR:
            entry = formatContribToD1Partial(record as Partial<Contributor> & { id: number })
            break
        case COMPOSER:
            entry = formatCompToD1Partial(record as Partial<Composer> & { id: number })
            break
        case COMPOSITION:
            entry = formatWorkToD1Partial(record as Partial<Composition> & { id: number })
            break
        default:
            throw new Error("Invalid schema")
    }
    const cleanEntry = Object.fromEntries(Object.entries(entry).filter(([_, value]) => value !== undefined)) as Record<
        string,
        string | number | null
    >
    // defense in depth: protected columns carry authorization state (roles/admin/identity_email) and must
    // never be written through a generic partial update unless the caller explicitly authorized it after its
    // own permission/elevation check. A caller that forgets that check trips this guard (a loud failure)
    // rather than silently mass-assigning privileged fields.
    if (!allowProtected && schema.protected) {
        const blocked = schema.protected.filter((col) => col in cleanEntry)
        if (blocked.length > 0) {
            throw new Error(
                `Refusing to update protected column(s) [${blocked.join(", ")}] without explicit authorization`
            )
        }
    }
    const update_columns = Object.keys(cleanEntry).filter(
        (col) => col !== schema.primary_key && !schema.repr_exclude.includes(col)
    )
    if (update_columns.length === 0) {
        // nothing to update; running a SET-less UPDATE would be invalid SQL, so treat as a no-op
        return null
    }
    stmt.addColumns(update_columns) // exclude primary key and hidden meta columns (entry_date, change_date) from update
    stmt.addValueGroup(cleanEntry, [schema.primary_key, ...schema.repr_exclude]) // exclude primary key and hidden meta columns from update
    // a real column changed (guarded above), so stamp change_date as the last-modified time (entry_date is left untouched)
    stmt.editValue(0, "change_date", Date.now())
    stmt.addWhere(schema.primary_key, id.toString(), SQLCompareOp.EQ)
    await _exec_wrap(stmt, ctx)
    return null
}

/**
 * Internal function to delete a record from the database, with cache management
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param schema the D1Schema of the record being deleted
 * @param id the ID of the record being deleted
 * @returns null
 * @throws an error if the schema is invalid
 */
export async function _deletePrimitive(ctx: ExecutionContext, schema: D1Schema, id: number): Promise<null> {
    const stmt = new SQLStatement(schema, "DELETE", schema.name)
    stmt.addWhere(schema.primary_key, id.toString(), SQLCompareOp.EQ)
    await _exec_wrap(stmt, ctx)
    return null
}

/**
 * Internal function to list all records of a given schema from the database, with cache management
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param schema the D1Schema of the records being listed
 * @returns an array of records matching the schema, as primitive record types
 * @throws an error if the schema is invalid
 */
export async function _listPrimitive(
    ctx: ExecutionContext,
    schema: D1Schema
): Promise<Record<string, string | number | null>[]> {
    const stmt = new SQLStatement(schema, "SELECT", schema.name)
    const output = await _exec_wrap(stmt, ctx)
    return output.data
}

/**
 * Internal function to convert a primitive D1 record into the API record type
 *
 * @param schema the D1Schema of the record being converted
 * @param result the record to convert, as a primitive D1 record type
 * @returns the record as an API record type, or null if the input is null
 * @throws an error if the schema is invalid
 */
export async function _getWrapper(
    schema: D1Schema,
    result: Record<string, string | number | null> | null
): Promise<ContributorRecord | ComposerRecord | CompositionRecord | null> {
    // provides type conversion between the raw D1 output into the D1 type primitives, then converts to the API type primitives

    // the wrapper assumes that the result contains all columns in the same order; as such, it is an internal function
    // only used within the exported functions

    if (result === null) {
        return null
    }
    let output
    // type assertion validation is disabled since the get wrapper is used during full record queries
    switch (schema) {
        case CONTRIBUTOR:
            output = formatContribFromD1(
                recordTypeAssertComplete(schema, result, false) as D1Contributor
            ) as ContributorRecord
            break
        case COMPOSER:
            output = formatCompFromD1(recordTypeAssertComplete(schema, result, false) as D1Composer) as ComposerRecord
            break
        case COMPOSITION:
            output = formatWorkFromD1(
                recordTypeAssertComplete(schema, result, false) as D1Composition
            ) as CompositionRecord
            break
        default:
            throw new Error("Invalid schema")
    }
    return output
}

/**
 * Internal function to convert a list of primitive D1 records into the API record type
 *
 * @param schema the D1Schema of the records being converted
 * @param result the records to convert, as an array of primitive D1 record types
 * @returns the records as an array of API record types, or null if the input is null
 * @throws an error if the schema is invalid
 */
export async function _listWrapper(
    schema: D1Schema,
    result: Record<string, string | number | null>[] | null
): Promise<ContributorRecord[] | ComposerRecord[] | CompositionRecord[] | null> {
    // see _getWrapper for details; this function implements _getWrapper on a list of result rows
    if (result === null) {
        return null
    }
    let output
    switch (schema) {
        case CONTRIBUTOR:
            output = result.map(
                (row) =>
                    formatContribFromD1(
                        recordTypeAssertComplete(schema, row, false) as D1Contributor
                    ) as ContributorRecord
            )
            break
        case COMPOSER:
            output = result.map(
                (row) => formatCompFromD1(recordTypeAssertComplete(schema, row, false) as D1Composer) as ComposerRecord
            )
            break
        case COMPOSITION:
            output = result.map(
                (row) =>
                    formatWorkFromD1(recordTypeAssertComplete(schema, row, false) as D1Composition) as CompositionRecord
            )
            break
        default:
            throw new Error("Invalid schema")
    }
    return output
}

/** Normalizes a name (+ optional discriminator, e.g. a composer's role) for case-insensitive,
 *  whitespace-trimmed conflict comparison (mirrors the UNIQUE column/index). */
function nameConflictKey(name: string, discriminator?: string): string {
    const key = name.trim().toLowerCase()
    return discriminator === undefined ? key : `${key} ${discriminator.trim().toLowerCase()}`
}

/**
 * Finds names in `candidates` that collide with an existing record of the same entity (by case-insensitive,
 * trimmed name, plus `role` when the candidate has one) or that repeat an earlier candidate within the same
 * request
 *
 * @param existing the existing records of this entity, or null when the table is empty
 * @param candidates the records about to be written; a `role` makes the conflict check (name, role)-scoped,
 *   matching idx_composers_name_role - omit it for name-only entities (contributors)
 * @param label the entity noun used in the human-readable message (e.g. "composer", "contributor")
 * @returns per-candidate findings (by index) describing each within-request or existing-name collision
 */
export function findNameConflicts(
    existing: Array<{ name: string; role?: string }> | null,
    candidates: Array<{ name: string; role?: string }>,
    label: string
): Array<{ index: number; reason: "within-request" | "exists"; message: string }> {
    const findings: Array<{ index: number; reason: "within-request" | "exists"; message: string }> = []
    const existing_keys = new Set<string>()
    for (const record of existing ?? []) {
        existing_keys.add(nameConflictKey(record.name, record.role))
    }
    const seen = new Set<string>()
    for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index]
        const key = nameConflictKey(candidate.name, candidate.role)
        const roleSuffix = candidate.role !== undefined ? ` with role "${candidate.role.trim()}"` : ""
        if (seen.has(key)) {
            findings.push({
                index,
                reason: "within-request",
                message: `"${candidate.name.trim()}"${roleSuffix} appears more than once in this request`
            })
        } else if (existing_keys.has(key)) {
            findings.push({
                index,
                reason: "exists",
                message: `A ${label} named "${candidate.name.trim()}"${roleSuffix} already exists`
            })
        }
        seen.add(key)
    }
    return findings
}
