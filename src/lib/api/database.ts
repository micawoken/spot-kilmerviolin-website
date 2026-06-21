/**
 * lib/api/database.ts
 *
 * Provides higher-level database services on top of D1, integrating KV caching and Cache API caching
 *
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
 *
 * This license is also subject to additional terms as specified in the README.md.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
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
    getRecord,
    getRecordSpecificProp,
    exec_string,
    recordTypeAssertComplete
} from "./d1.ts"
import { SQLStatement, VirtualSQLTable } from "./sql.ts"
import { getKey, setKey, deleteKey, listKeys } from "./kv.ts"
import { getCache, putCache, deleteCacheKey } from "./caching.ts"
import { invalidateIdentityCache } from "./authorize.ts"

// in general, authorization is managed by the API endpoint, so no identity checks are made in this module

/*
 * SQLITE TABLE SPEC
 *
 * CONTRIBUTORS:
 * contributor_id INTEGER PRIMARY KEY AUTOINCREMENT,
 * name TEXT UNIQUE NOT NULL,
 * class_year INTEGER, // nullable
 * major TEXT, // nullable
 * phases TEXT // comma-separated list of phase numbers; nullable
 * bio TEXT,
 * public_email TEXT,
 * identity_email TEXT UNIQUE NOT NULL,
 * active INTEGER NOT NULL, // 0 or 1
 * roles TEXT NOT NULL, // comma-separated list of role names
 * admin INTEGER NOT NULL, // 0 or 1
 * image TEXT // URL to contributor image
 * tags TEXT, // comma-separated list of tags for filtering and search
 * entry_date TEXT NOT NULL, // ISO 8601 format; creation date, hidden from users and managed by business logic
 * change_date TEXT // ISO 8601 format; last-modified date, hidden from users and managed by business logic
 *
 * COMPOSERS:
 * composer_id INTEGER PRIMARY KEY AUTOINCREMENT,
 * name TEXT UNIQUE NOT NULL,
 * role TEXT NOT NULL,
 * birth_year INTEGER NOT NULL,
 * death_year INTEGER NOT NULL, // -1 is defined as not dead
 * country TEXT NOT NULL, // ISO 3166-1 alpha-2 country code, validated on the client and server (see lib/api/validation.ts)
 * bio TEXT,
 * image TEXT, // refers to a file in assets, or an external URL
 * tags TEXT, // comma-separated list of tags for filtering and search
 * entry_date TEXT NOT NULL, // ISO 8601 format; creation date, hidden from users and managed by business logic
 * change_date TEXT // ISO 8601 format; last-modified date, hidden from users and managed by business logic
 *
 * COMPOSITIONS:
 * composition_id INTEGER PRIMARY KEY AUTOINCREMENT,
 * name TEXT NOT NULL,
 * composer_id INTEGER NOT NULL, // see foreign key constraint later
 * contrib_primary_1 INTEGER NOT NULL, // primary contributor; see foreign key constraint later
 * contrib_primary_2 INTEGER, // second primary contributor; see foreign key constraint later
 * contrib_addl TEXT, // comma-separated list of additional contributors; foreign key enforcement is not used here, but it is checked programmatically
 * author_secondary TEXT, // comma-separated list of secondary composers
 * type TEXT NOT NULL,
 * part TEXT,
 * rating_suzuki INTEGER,
 * rating_nyssma INTEGER,
 * publish_location TEXT NOT NULL,
 * publish_name TEXT NOT NULL,
 * publish_year INTEGER NOT NULL,
 * uri_type TEXT NOT NULL, // https, isbn, or other
 * uri TEXT,
 * key TEXT,
 * range TEXT,
 * position_highest TEXT, // integer as roman numerals
 * notes_pedagogical TEXT,
 * notes_historical TEXT,
 * notes_other TEXT,
 * image TEXT,
 * phases TEXT NOT NULL, // comma-separated list of phase numbers
 * entry_date TEXT NOT NULL, // ISO 8601 format; creation date, hidden from users and managed by business logic
 * tags TEXT, // comma-separated list of tags for filtering and search
 * change_date TEXT, // ISO 8601 format; last-modified date, hidden from users and managed by business logic
 * full_name TEXT UNIQUE NOT NULL GENERATED ALWAYS AS ((SELECT name FROM composers WHERE composers.composer_id = compositions.composer_id) || ' (' || name || ')') STORED // used for indexing and search
 * FOREIGN KEY (composer_id) REFERENCES COMPOSERS(composer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
 * FOREIGN KEY (contrib_primary_1) REFERENCES CONTRIBUTORS(contributor_id) ON UPDATE CASCADE ON DELETE RESTRICT,
 * FOREIGN KEY (contrib_primary_2) REFERENCES CONTRIBUTORS(contributor_id) ON UPDATE CASCADE ON DELETE RESTRICT
 */

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
 * The storage tiers a read can be served from, ordered cheapest/fastest first. D1 is the authoritative
 * source of truth; the Cache API and KV are accelerators layered in front of it. Used to report which
 * tier served a request as the system degrades across usage limits.
 */
type StorageTier = "cache-api" | "kv" | "d1"

/**
 * Heuristically classifies whether an error reflects a Cloudflare usage-limit, rate-limit, or quota
 * condition (the free-plan D1/KV caps this module degrades around) rather than a genuine fault such as
 * malformed SQL or bad data.
 *
 * Cloudflare reports these conditions as ordinary Errors whose message — sometimes only the nested
 * `cause` — carries the detail, so the whole chain is flattened and scanned for the vocabulary these
 * limits surface with. Classification is deliberately inclusive: skipping a tier we could have used is
 * cheap and self-correcting, whereas the authoritative D1 path never relies on this to swallow real
 * errors (it only uses it to decide whether a degraded whole-table fallback is worth attempting).
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
 * Schedules a best-effort cache write whose failure must never reach the caller. Populating or
 * invalidating the Cache API and KV is purely an optimization, so if the destination tier is over its
 * usage limit (or fails for any other reason) the error is logged and dropped rather than turning a
 * successful read or write into a failure.
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
 * module writes and the legacy `{ results: [...] }` shape older entries may still carry.
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
 * tiers as usage limits are hit.
 *
 * Tiers are consulted cheapest-first — Cache API, then KV, then an authoritative D1 table read. The two
 * cache tiers are pure accelerators, so any failure reading them (a usage limit, a malformed entry, a
 * parse error) is logged and skipped rather than propagated. Only the final D1 read is authoritative: if
 * it too fails there is nowhere left to fall back to and the error propagates (all options exhausted).
 * Whenever the data comes from a slower tier, the faster tiers are backfilled best-effort so subsequent
 * reads stay cheap.
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

    // Tier 3: D1 (authoritative source of truth) — a failure here is terminal
    const result = await exec_string(`SELECT * FROM ${table}`)
    const rows = result.results as Record<string, string | number | null>[]
    // repopulate both faster tiers best-effort so the next read does not have to reach D1
    _backfill(ctx, () => putCache("db_cache", table, rows, new Date().toISOString(), long))
    _backfill(ctx, () => setKey(table, rows, "json"))
    return { rows, origin: "d1" }
}

/**
 * Reads a query result cached under its statement identifier from the Cache API.
 *
 * Identifier-keyed results live only in the Cache API (they are never written to KV), so unlike
 * full-table resolution this consults a single tier — and avoids spending a metered KV read on a key
 * that can never be present. A read failure is treated as a miss so the caller falls through to D1.
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
        // they can only be served by the authoritative D1 tier. There is no fallback for a write — a usage
        // limit here propagates because the change genuinely cannot be persisted anywhere else.
        const output = await exec_stmt(stmt)
        // the write succeeded, so the now-stale caches are invalidated best-effort (a failed eviction must
        // not fail the write; the entries will also expire on their own via TTL). The Workers Cache API has
        // no store-wide purge, so invalidation is per-key against the affected table.
        if (stmt.from) {
            // invalidate the KV backing store and the per-table Cache API entry so a simple SELECT is not
            // repopulated from, or kept serving, stale data
            _backfill(ctx, () => deleteKey(stmt.from!))
            _backfill(ctx, () => deleteCacheKey("db_cache", stmt.from!))
            if (stmt.from === CONTRIBUTOR.name) {
                // a contributor write may change authorization-relevant fields or the identity_email
                // mapping, so also drop authorize.ts's per-isolate identity cache. This is a synchronous
                // in-memory Map clear (not best-effort like the cache evictions above) so it takes effect
                // before the response; see invalidateIdentityCache for why it clears wholesale.
                invalidateIdentityCache()
            }
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
    // targeted query. If no tier can supply the table either, _resolveTable throws and the request fails —
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
async function _addPrimitive(
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
    const now = new Date().toISOString()
    stmt.editValue(0, "entry_date", now)
    stmt.editValue(0, "change_date", now)
    const output = await _exec_wrap(stmt, ctx)
    return output.meta!.last_row_id
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
async function _getPrimitive(
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
async function _updatePrimitive(
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
    stmt.editValue(0, "change_date", new Date().toISOString())
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
async function _updatePrimitivePartial(
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
    stmt.editValue(0, "change_date", new Date().toISOString())
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
async function _deletePrimitive(ctx: ExecutionContext, schema: D1Schema, id: number): Promise<null> {
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
async function _listPrimitive(
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
async function _getWrapper(
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
async function _listWrapper(
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

/**
 * Get a contributor record based on a unique param
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param param the unique column being queried on (from D1Schema.index, i.e. the D1 types, not API types)
 * @param value the value of the unique column being queried
 * @returns the contributor record matching the query, or null if not found
 * @throws an error if the param is not a unique column
 */
export async function getContributor(
    ctx: ExecutionContext,
    param: string,
    value: string
): Promise<ContributorRecord | null> {
    // given the unique param and its value, return the contributor record
    // caching is implemented at the primitive level
    return _getWrapper(
        CONTRIBUTOR,
        await _getPrimitive(ctx, CONTRIBUTOR, param, value)
    ) as Promise<ContributorRecord | null>
}

/**
 * Add a contributor record to the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param record the contributor record to add
 * @returns the id of the new record
 */
export async function addContributor(ctx: ExecutionContext, record: Contributor): Promise<number> {
    // adds a contributor record to the database, returning the new record's id
    return await _addPrimitive(ctx, CONTRIBUTOR, record)
}

/**
 * Update a contributor record in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to update
 * @param record the updated contributor record; all fields must be provided
 * @returns null if successful
 * @throws an error if the record is invalid or if the id does not exist
 */
export async function updateContributor(ctx: ExecutionContext, id: number, record: Contributor): Promise<null> {
    // updates a contributor record in the database, returning null if successful
    return await _updatePrimitive(ctx, CONTRIBUTOR, id, record)
}

/**
 * Perform a partial update on a contributor record in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to update
 * @param record the updated contributor record; only provided fields will be updated
 * @param allowProtected whether the caller has authorized writing protected columns (roles/admin/
 *   identity_email); the caller must perform its own elevation/permission check before passing true
 * @returns null if successful
 * @throws an error if the record is invalid, if the id does not exist, or if it writes a protected column without authorization
 */
export async function updateContributorPartial(
    ctx: ExecutionContext,
    id: number,
    record: Partial<Contributor>,
    allowProtected: boolean = false
): Promise<null> {
    return await _updatePrimitivePartial(ctx, CONTRIBUTOR, id, record, allowProtected)
}

/**
 * Delete a contributor record from the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to delete
 * @returns null if successful
 * @throws an error if the id does not exist
 */
export async function deleteContributor(ctx: ExecutionContext, id: number): Promise<null> {
    return await _deletePrimitive(ctx, CONTRIBUTOR, id)
}

/**
 * List all contributor records in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @returns an array of all contributor records, or null if no records are found
 * @throws an error if the database query fails
 */
export async function listContributors(ctx: ExecutionContext): Promise<ContributorRecord[] | null> {
    return _listWrapper(CONTRIBUTOR, await _listPrimitive(ctx, CONTRIBUTOR)) as Promise<ContributorRecord[] | null>
}

/**
 * Get a composer record based on a unique param
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param param the unique column being queried on
 * @param value the value of the unique column being queried
 * @returns the composer record matching the query, or null if not found
 * @throws an error if the param is not a unique column
 */
export async function getComposer(ctx: ExecutionContext, param: string, value: string): Promise<ComposerRecord | null> {
    // retrieves a composer record based on the unique param
    return _getWrapper(COMPOSER, await _getPrimitive(ctx, COMPOSER, param, value)) as Promise<ComposerRecord | null>
}

/**
 * Add a composer record to the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param record the composer record to add
 * @returns the id of the new record
 * @throws an error if the record is invalid
 */
export async function addComposer(ctx: ExecutionContext, record: Composer): Promise<number> {
    return await _addPrimitive(ctx, COMPOSER, record)
}

/**
 * Update a composer record in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to update
 * @param record the updated composer record; all fields must be provided
 * @returns null if successful
 * @throws an error if the record is invalid or if the id does not exist
 */
export async function updateComposer(ctx: ExecutionContext, id: number, record: Composer): Promise<null> {
    return await _updatePrimitive(ctx, COMPOSER, id, record)
}

/**
 * Perform a partial update on a composer record in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to update
 * @param record the updated composer record; only provided fields will be updated
 * @returns null if successful
 * @throws an error if the record is invalid or if the id does not exist
 */
export async function updateComposerPartial(
    ctx: ExecutionContext,
    id: number,
    record: Partial<Composer>
): Promise<null> {
    return await _updatePrimitivePartial(ctx, COMPOSER, id, record)
}

/**
 * Delete a composer record from the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to delete
 * @returns null if successful
 * @throws an error if the id does not exist
 */
export async function deleteComposer(ctx: ExecutionContext, id: number): Promise<null> {
    return await _deletePrimitive(ctx, COMPOSER, id)
}

/**
 * List all composer records in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @returns an array of all composer records, or null if no records are found
 * @throws an error if the database query fails
 */
export async function listComposers(ctx: ExecutionContext): Promise<ComposerRecord[] | null> {
    return _listWrapper(COMPOSER, await _listPrimitive(ctx, COMPOSER)) as Promise<ComposerRecord[] | null>
}

/**
 * Get a composition record based on a unique param
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param param the unique column being queried on
 * @param value the value of the unique column being queried
 * @returns the composition record matching the query, or null if not found
 * @throws an error if the param is not a unique column
 */
export async function getComposition(
    ctx: ExecutionContext,
    param: string,
    value: string
): Promise<CompositionRecord | null> {
    return _getWrapper(
        COMPOSITION,
        await _getPrimitive(ctx, COMPOSITION, param, value)
    ) as Promise<CompositionRecord | null>
}

/**
 * Add a composition record to the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param record the composition record to add
 * @returns the id of the new record
 * @throws an error if the record is invalid
 */
export async function addComposition(ctx: ExecutionContext, record: Composition): Promise<number> {
    return await _addPrimitive(ctx, COMPOSITION, record)
}

/**
 * Update a composition record in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to update
 * @param record the updated composition record; all fields must be provided
 * @returns null if successful
 * @throws an error if the record is invalid or if the id does not exist
 */
export async function updateComposition(ctx: ExecutionContext, id: number, record: Composition): Promise<null> {
    return await _updatePrimitive(ctx, COMPOSITION, id, record)
}

/**
 * Perform a partial update on a composition record in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to update
 * @param record the updated composition record; only provided fields will be updated
 * @returns null if successful
 * @throws an error if the record is invalid or if the id does not exist
 */
export async function updateCompositionPartial(
    ctx: ExecutionContext,
    id: number,
    record: Partial<Composition>
): Promise<null> {
    return await _updatePrimitivePartial(ctx, COMPOSITION, id, record)
}

/**
 * Delete a composition record from the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param id the id of the record to delete
 * @returns null if successful
 * @throws an error if the id does not exist
 */
export async function deleteComposition(ctx: ExecutionContext, id: number): Promise<null> {
    return await _deletePrimitive(ctx, COMPOSITION, id)
}

/**
 * List all composition records in the database
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @returns an array of all composition records, or null if no records are found
 * @throws an error if the database query fails
 */
export async function listCompositions(ctx: ExecutionContext): Promise<CompositionRecord[] | null> {
    return _listWrapper(COMPOSITION, await _listPrimitive(ctx, COMPOSITION)) as Promise<CompositionRecord[] | null>
}

/**
 * Pairs each composition with the human-readable names referenced by its numeric fields
 *
 * A composition stores only numeric references: composer_id and the author_secondary id list point into
 * the composer table, while contrib_primary_1, contrib_primary_2, and contrib_addl point into the
 * contributor table. This resolves all of them to names. Each table is fetched once (both are served from
 * the caching layer) and indexed, so resolving a list of compositions costs a single read per table
 * rather than one per reference. Unresolvable ids yield an empty string, keeping author_secondary_names
 * and contrib_addl_names aligned positionally with their source arrays; a null contrib_primary_2 also
 * yields an empty string.
 *
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param compositions the composition records to resolve names for
 * @returns each composition paired with its resolved composer and contributor names
 */
export async function attachCompositionNames(
    ctx: ExecutionContext,
    compositions: CompositionRecord[]
): Promise<CompositionWithNames[]> {
    const composers = await listComposers(ctx)
    const composer_names = new Map<number, string>()
    if (composers) {
        for (const composer of composers) {
            composer_names.set(composer.id, composer.name)
        }
    }
    const contributors = await listContributors(ctx)
    const contributor_names = new Map<number, string>()
    if (contributors) {
        for (const contributor of contributors) {
            contributor_names.set(contributor.id, contributor.name)
        }
    }
    return compositions.map((composition) => ({
        object: composition,
        names: {
            composer_name: composer_names.get(composition.composer_id) ?? "",
            author_secondary_names: composition.author_secondary.map((id) => composer_names.get(id) ?? ""),
            contrib_primary_1_name: contributor_names.get(composition.contrib_primary_1) ?? "",
            contrib_primary_2_name:
                composition.contrib_primary_2 === null
                    ? ""
                    : (contributor_names.get(composition.contrib_primary_2) ?? ""),
            contrib_addl_names: composition.contrib_addl.map((id) => contributor_names.get(id) ?? "")
        }
    }))
}
