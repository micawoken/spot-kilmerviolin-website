/**
 * lib/api/database.ts
 * 
 * Provides higher-level database services on top of D1, integrating KV caching and Cache API caching
 * 
 * 
 * Dependent on d1.ts
 */


/*
 * WARNING
 * Security-relevant operations should not use the database access primitives provided by this module since cache data may
 * become out of sync. Instead, directly use the D1 primitives to directly query the database.
 */


import { formatContribToD1, formatContribToD1Partial, formatCompToD1, formatWorkToD1, formatWorkToD1Partial, formatCompToD1Partial, formatContribFromD1, formatCompFromD1, formatWorkFromD1, SQLCompareOp } from "./common.ts"
import { CONTRIBUTOR, COMPOSER, COMPOSITION, exec_stmt, getRecord, getRecordSpecificProp, deleteRecord, exec_string, recordTypeAssertComplete } from "./d1.ts"
import { SQLStatement, VirtualSQLTable } from "./sql.ts"
import { getKey, setKey, deleteKey, listKeys } from "./kv.ts"
import { getCache, purgeCache, putCache, deleteCacheKey } from "./caching.ts"

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
 * entry_date TEXT NOT NULL // ISO 8601 format
 * 
 * COMPOSERS:
 * composer_id INTEGER PRIMARY KEY AUTOINCREMENT,
 * name TEXT UNIQUE NOT NULL,
 * role TEXT NOT NULL,
 * birth_year INTEGER NOT NULL,
 * death_year INTEGER NOT NULL, // -1 is defined as not dead
 * country TEXT NOT NULL, // used as text for now, but will switch to ISO 3166-1 alpha-2 code in the future
 * bio TEXT,
 * image TEXT, // refers to a file in assets, or an external URL
 * tags TEXT, // comma-separated list of tags for filtering and search
 * entry_date TEXT NOT NULL // ISO 8601 format
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
 * entry_date TEXT NOT NULL, // ISO 8601 format
 * tags TEXT, // comma-separated list of tags for filtering and search
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
    // purges KV entries
    if (fixed) {
        // purge only known keys
        const known_keys = ["composers", "contributors", "compositions"]
        await Promise.all(known_keys.map(key => deleteKey(key)))
        return;
    } else {
        const keys = await listKeys(false) as string[]
        await Promise.all(keys.map(key => deleteKey(key)))
        return;
    }
}

/**
 * Purges the Cache API and KV cache
 * 
 * @param kv_fixed Whether to purge only known keys from KV, or purge all enrolled keys in KV
 * @returns {boolean} Whether the Cache API purge succeeded
 */
export async function purgeCacheAll(kv_fixed: boolean = true): Promise<boolean> {
    const outcome = await purgeCache("db_cache")
    // purgeCache cannot enumerate or drop the whole store on Workers, so evict the known per-table entries directly
    const known_keys = ["composers", "contributors", "compositions"]
    await Promise.all(known_keys.map(key => deleteCacheKey("db_cache", key)))
    await purgeKV(kv_fixed) // KV deletion succeeds whether the key exists or not
    return outcome
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
    console.log("Finished statement: ", stmt.finish())
    const identifier = stmt.identifier()
    if (identifier === null) {
        const output = await exec_stmt(stmt)
        // SQLStatement.identifier() returns null if the verb is not "SELECT"
        // the class's other supported verbs modify the database state, so cache needs to be purged
        ctx.waitUntil(purgeCache("db_cache"))
        // invalidate KV backing store for this table so Cache API is not repopulated with stale KV data
        if (stmt.from) {
            ctx.waitUntil(deleteKey(stmt.from))
            // purgeCache cannot drop the whole store on Workers, so the per-table Cache API entry
            // must be evicted directly or simple SELECTs will keep serving stale data until TTL expiry
            ctx.waitUntil(deleteCacheKey("db_cache", stmt.from))
        }
        return {
            data: output.results as Record<string, string | number | null>[],
            cached: false,
            query_scope: "local",
            meta: output.meta
        }
    }
    // check the Cache API
    if (stmt.isSimple()) {
        /*
        // check if the serialized command has been executed and cached
        console.log("Fetching query ", identifier, " from cache")
        const id_cache = await _cacheFetch(identifier, false)
        if (id_cache) {
            return {
                data: id_cache as Record<string, string | number | null>[],
                query_scope: "local",
                cached: true
            }
        }
        */ // disabling serial-based caching since large-scale cache invalidation is not possible at this time

        // identifier cache miss; pull the entire database
        // for full database queries, the name of the table is used
        // for cached queries, the identifier is used
        console.log("Fetching table ", stmt.from!, " from cache")
        const db_cache = await _cacheFetch(stmt.from!, true)
        console.log("DB CACHE FETCH RESULT:", db_cache)
        let db
        let from_cache = false
        if (db_cache) {
            // execute the command on the virtualized database
            db = new VirtualSQLTable(stmt.schema, db_cache as Record<string, string | number | null>[])
            from_cache = true
        } else {
            // the table has not been cached, so pull the whole table, cache it, and run on the virtual table
            const data = await exec_string(`SELECT * FROM ${stmt.from!}`)
            db = new VirtualSQLTable(stmt.schema, data.results as Record<string, string | number | null>[])
            // load into cache; caching is low priority and should be non-blocking, so they are awaited, and it is not a disaster if the cache puts fail
            ctx.waitUntil(putCache("db_cache", stmt.from!, data.results, new Date().toISOString(), true))
            ctx.waitUntil(setKey(stmt.from!, data.results, "json"))
        }
        console.log("Executing statement")
        const output = db.execute(stmt)
        // load the data into cache
        //ctx.waitUntil(putCache("db_cache", identifier, output, new Date().toISOString(), true)) // see earlier on disabling id-based caching

        return {
            data: output as Record<string, string | number | null>[],
            cached: from_cache,
            query_scope: "global"
        }
    } else {
        // query for the serialized command
        console.log("Fetching query ", identifier, " from cache")
        const db_cache = await _cacheFetch(identifier, false)
        if (db_cache) {
            return {
                data: db_cache as Record<string, string | number | null>[],
                cached: true,
                query_scope: "local"
            }
        }
        // cache miss; execute command, then return and cache
        const output = await exec_stmt(stmt)
        console.log("Output for identifier ", identifier, ":", output)
        ctx.waitUntil(putCache("db_cache", identifier, output.results as Record<string, string | number | null>[], new Date().toISOString(), false))
        return {
            data: output.results as Record<string, string | number | null>[],
            cached: false,
            query_scope: "local",
            meta: output.meta
        }
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
 * Retrieve an item from the database cache
 * If found in KV but not in Cache API, it is loaded into Cache API for faster future retrieval
 * 
 * @param key the cache key to retrieve
 * @param long whether to use long caching policy
 * @returns the cached data, or null if not found
 * 
 */
async function _cacheFetch(key: string, long: boolean): Promise<unknown> {
    // fetches the identified data from Cache API and KV
    // check Cache API first
    console.log(`Attempting to fetch from cache with key ${key}`)
    const cache_result = await getCache("db_cache", key)
    if (cache_result) {
        console.log(`Cache hit for key ${key}`)
        if (Array.isArray(cache_result)) {
            return cache_result
        }
        if (typeof cache_result === "object" && cache_result !== null && "results" in cache_result) {
            const results = (cache_result as { results?: unknown }).results
            if (Array.isArray(results)) {
                return results
            }
        }
        return cache_result
    }
    console.log(`Cache miss for key ${key}`)
    console.log(`Attempting to fetch from KV with key ${key}`)
    // check KV
    const kv_result = await getKey(key)
    console.log(`KV fetch result for key ${key}:`, kv_result)
    if (kv_result) {
        console.log(`KV hit for key ${key}, loading into cache`)
        // update Cache API with the KV result for faster future retrieval
        await putCache("db_cache", key, kv_result, new Date().toISOString(), long)
        return kv_result
    }
    console.log(`KV miss for key ${key}`)
    return null
    
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
async function _addPrimitive(ctx: ExecutionContext, schema: D1Schema, record: Contributor | Composition | Composer): Promise<number> {
    const stmt = new SQLStatement(schema, "INSERT", schema.name) // new record insertion uses all columns since none are specified
    let entry, id
    switch (schema) {
        case CONTRIBUTOR:
            entry = formatContribToD1(record as Contributor)
            id = entry.contributor_id
            break
        case COMPOSER:
            entry = formatCompToD1(record as Composer)
            id = entry.composer_id
            break
        case COMPOSITION:
            entry = formatWorkToD1(record as Composition)
            id = entry.composition_id
            break
        default:
            throw new Error("Invalid schema")
    }
    stmt.addValueGroup(entry)
    stmt.voidValue(0, schema.primary_key)
    stmt.editValue(0, "entry_date", new Date().toISOString())
    console.log("Statement info: ", stmt)
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
export async function _getPrimitiveCacheless(schema: D1Schema, param: string, value: string): Promise<Record<string, string | number | null> | null> {
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
async function _getPrimitive(ctx: ExecutionContext, schema: D1Schema, param: string, value: string): Promise<Record<string, string | number | null> | null> {
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
async function _updatePrimitive(ctx: ExecutionContext, schema: D1Schema, id: number, record: Contributor | Composition | Composer): Promise<null> {
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
    stmt.addColumns(schema.columns.filter(col => col !== schema.primary_key && !schema.repr_exclude.includes(col))) // exclude primary key and entry date from update
    stmt.addValueGroup(entry, [schema.primary_key, "entry_date"]) // exclude primary key and entry date from update
    stmt.addWhere(schema.primary_key, id.toString(), SQLCompareOp.EQ)
    const output = await _exec_wrap(stmt, ctx)
    return null
}

/**
 * Internal function to perform a partial update on a record in the database, with type assertion and cache management
 * 
 * @param ctx the Cloudflare Worker ExecutionContext
 * @param schema the D1Schema of the record being updated
 * @param id the ID of the record being updated
 * @param record the updated record, as a partial Contributor, Composition, or Composer type; only provided fields will be updated
 * @returns null
 * @throws an error if the record is invalid or if the schema is invalid
 */
async function _updatePrimitivePartial(ctx: ExecutionContext, schema: D1Schema, id: number, record: Partial<Contributor | Composition | Composer>): Promise<null> {
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
    const cleanEntry = Object.fromEntries(Object.entries(entry).filter(([_, value]) => value !== undefined)) as Record<string, string | number | null>
    const update_columns = Object.keys(cleanEntry).filter(col => col !== schema.primary_key && !schema.repr_exclude.includes(col))
    if (update_columns.length === 0) {
        // nothing to update; running a SET-less UPDATE would be invalid SQL, so treat as a no-op
        return null
    }
    stmt.addColumns(update_columns) // exclude primary key and entry date from update
    stmt.addValueGroup(cleanEntry, [schema.primary_key, ...schema.repr_exclude]) // exclude primary key and entry date from update
    stmt.addWhere(schema.primary_key, id.toString(), SQLCompareOp.EQ)
    const output = await _exec_wrap(stmt, ctx)
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
    const output = await _exec_wrap(stmt, ctx)
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
async function _listPrimitive(ctx: ExecutionContext, schema: D1Schema): Promise<Record<string, string | number | null>[]> {
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
async function _getWrapper(schema: D1Schema, result: Record<string, string | number | null> | null): Promise<ContributorRecord | ComposerRecord | CompositionRecord | null> {
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
            output = formatContribFromD1(recordTypeAssertComplete(schema, result, false) as D1Contributor) as ContributorRecord
            break
        case COMPOSER:
            output = formatCompFromD1(recordTypeAssertComplete(schema, result, false) as D1Composer) as ComposerRecord
            break
        case COMPOSITION:
            output = formatWorkFromD1(recordTypeAssertComplete(schema, result, false) as D1Composition) as CompositionRecord
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
async function _listWrapper(schema: D1Schema, result: Record<string, string | number | null>[] | null): Promise<ContributorRecord[] | ComposerRecord[] | CompositionRecord[] | null> {
    // see _getWrapper for details; this function implements _getWrapper on a list of result rows
    if (result === null) {
        return null
    }
    let output
    switch (schema) {
        case CONTRIBUTOR:
            output = result.map(row => formatContribFromD1(recordTypeAssertComplete(schema, row, false) as D1Contributor) as ContributorRecord)
            break
        case COMPOSER:
            output = result.map(row => formatCompFromD1(recordTypeAssertComplete(schema, row, false) as D1Composer) as ComposerRecord)
            break
        case COMPOSITION:
            output = result.map(row => formatWorkFromD1(recordTypeAssertComplete(schema, row, false) as D1Composition) as CompositionRecord)
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
 * @param param the unique column being queried on
 * @param value the value of the unique column being queried
 * @returns the contributor record matching the query, or null if not found
 * @throws an error if the param is not a unique column
 */
export async function getContributor(ctx: ExecutionContext, param: string, value: string): Promise<ContributorRecord | null> {
    // given the unique param and its value, return the contributor record
    // caching is implemented at the primitive level
    return _getWrapper(CONTRIBUTOR, await _getPrimitive(ctx, CONTRIBUTOR, param, value)) as Promise<ContributorRecord | null>
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
 * @returns null if successful
 * @throws an error if the record is invalid or if the id does not exist
 */
export async function updateContributorPartial(ctx: ExecutionContext, id: number, record: Partial<Contributor>): Promise<null> {
    return await _updatePrimitivePartial(ctx, CONTRIBUTOR, id, record)
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
export async function updateComposerPartial(ctx: ExecutionContext, id: number, record: Partial<Composer>): Promise<null> {
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
export async function getComposition(ctx: ExecutionContext, param: string, value: string): Promise<CompositionRecord | null> {
    return _getWrapper(COMPOSITION, await _getPrimitive(ctx, COMPOSITION, param, value)) as Promise<CompositionRecord | null>
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
export async function updateCompositionPartial(ctx: ExecutionContext, id: number, record: Partial<Composition>): Promise<null> {
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