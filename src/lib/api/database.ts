/**
 * lib/api/database.ts
 * 
 * Provides higher-level database services on top of D1, integrating KV caching and Cache API caching
 * 
 * 
 * Dependent on d1.ts
 */


/**
 * WARNING
 * Security-relevant operations should not use the database access primitives provided by this module since cache data may
 * become out of sync. Instead, directly use the D1 primitives to directly query the database.
 */


import { formatContribToD1, formatContribToD1Partial, formatCompToD1, formatWorkToD1, formatWorkToD1Partial, formatCompToD1Partial, formatContribFromD1, formatCompFromD1, formatWorkFromD1, SQLCompareOp } from "./common.ts"
import { CONTRIBUTOR, COMPOSER, COMPOSITION, exec_stmt, getRecord, getRecordSpecificProp, deleteRecord, exec_string } from "./d1.ts"
import { SQLStatement, VirtualSQLTable } from "./sql.ts"
import { getKey, setKey } from "./kv.ts"
import { getCache, purgeCache, putCache } from "./caching.ts"

// in general, authorization is managed by the API endpoint, so no identity checks are made in this module

/**
 * SQLITE TABLE SPEC
 * 
 * CONTRIBUTORS:
 * contributor_id INTEGER PRIMARY KEY AUTOINCREMENT,
 * name TEXT UNIQUE NOT NULL,
 * class_year INTEGER NOT NULL,
 * major TEXT NOT NULL,
 * phases TEXT NOT NULL // comma-separated list of phase numbers
 * bio TEXT,
 * public_email TEXT,
 * identity_email TEXT UNIQUE NOT NULL,
 * active INTEGER NOT NULL, // 0 or 1
 * roles TEXT NOT NULL, // comma-separated list of role names
 * admin INTEGER NOT NULL, // 0 or 1
 * image TEXT // URL to contributor image
 * entry_date TEXT NOT NULL // ISO 8601 format
 * 
 * COMPOSERS:
 * composer_id INTEGER PRIMARY KEY AUTOINCREMENT,
 * name TEXT UNIQUE NOT NULL,
 * year_birth INTEGER NOT NULL,
 * year_death INTEGER NOT NULL, // -1 is defined as not dead
 * country TEXT NOT NULL, // used as text for now, but will switch to ISO 3166-1 alpha-2 code in the future
 * bio TEXT,
 * image TEXT, // refers to a file in assets, or an external URL
 * entry_date TEXT NOT NULL // ISO 8601 format
 * 
 * REPERTOIRE:
 * composition_id INTEGER PRIMARY KEY AUTOINCREMENT,
 * name TEXT NOT NULL,
 * composer_ID INTEGER NOT NULL, // see foreign key constraint later
 * composer_name TEXT NOT NULL, // see foreign key constraint later
 * contrib_primary_1 INTEGER NOT NULL, // primary contributor; see foreign key constraint later
 * contrib_primary_2 INTEGER, // second primary contributor; see foreign key constraint later
 * contrib_addl TEXT, // comma-separated list of additional contributors; foreign key enforcement is not used here, but it is checked programmatically
 * full_name TEXT UNIQUE NOT NULL GENERATED ALWAYS AS (name || ', ' || composer_name) STORED // used for indexing and search
 * composer_addl // comma-separated list of additional composers
 * type TEXT NOT NULL,
 * part TEXT,
 * suzuki_rating INTEGER,
 * nyssma_rating INTEGER,
 * publish_location TEXT NOT NULL,
 * publish_name TEXT NOT NULL
 * publish_year INTEGER NOT NULL,
 * uri_type TEXT NOT NULL, // https, isbn, or other
 * uri TEXT,
 * key TEXT,
 * range TEXT,
 * position_highest TEXT, // integer as roman numerals
 * notes_pedagogical TEXT,
 * notes_historical TEXT,
 * notes_other TEXT,
 * phases TEXT NOT NULL, // comma-separated list of phase numbers
 * entry_date TEXT NOT NULL // ISO 8601 format
 * FOREIGN KEY (composer_ID) REFERENCES COMPOSERS(composer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
 * FOREIGN KEY (composer_name) REFERENCES COMPOSERS(name) ON UPDATE CASCADE ON DELETE RESTRICT,
 * FOREIGN KEY (contributor_1_id) REFERENCES CONTRIBUTORS(contributor_id) ON UPDATE CASCADE ON DELETE RESTRICT,
 * FOREIGN KEY (contributor_2_id) REFERENCES CONTRIBUTORS(contributor_id) ON UPDATE CASCADE ON DELETE RESTRICT
 */



async function _exec_wrap(stmt: SQLStatement, ctx: ExecutionContext): Promise<(string | number | null)[][] | Error> {
    // wraps exec_stmt commands to provide caching through KV and the Cache API
    // see lib/api/caching.ts for caching policy overview

    const identifier = await stmt.identifier()
    if (!identifier) {
        const output = await exec_stmt(stmt)
        if (output instanceof Error) {
            return Promise.reject(output)
        }
        // SQLStatement.identifier() returns null if the verb is not "SELECT"
        // the class's other supported verbs modify the database state, so cache needs to be purged
        ctx.waitUntil(purgeCache())
        return output.results as (string | number | null)[][]
    }
    // check the Cache API
    if (stmt.isSimple()) {
        // pull the entire database
        // for full database queries, the name of the table is used
        // for cached queries, the identifier is used
        const db_cache = await _cacheFetch(stmt.from!, true, ctx)
        let db
        if (db_cache) {
            // execute the command on the virtualized database
            db = new VirtualSQLTable(stmt.schema, db_cache as (string | number | null)[][])
        } else {
            // the table has not been cached, so pull the whole table, cache it, and run on the virtual table
            const data = await exec_string(`SELECT * FROM ${stmt.from!}`)
            if (data instanceof Error) {
                return Promise.reject(data)
            }
            db = new VirtualSQLTable(stmt.schema, data.results as (string | number | null)[][])
            // load into cache; caching is low priority and should be non-blocking, so they are awaited, and it is not a disaster if the cache puts fail
            ctx.waitUntil(putCache(ctx, stmt.from!, data, new Date().toISOString(), true))
            ctx.waitUntil(setKey(stmt.from!, data, "json"))
        }
        const output = db.execute(stmt)
        // load the data into cache
        ctx.waitUntil(putCache(ctx, identifier, output, new Date().toISOString(), true))
        ctx.waitUntil(setKey(stmt.from!, identifier, "json"))
        return output
    } else {
        // query for the serialized command
        const db_cache = await _cacheFetch(identifier, false, ctx)
        if (db_cache) {
            return db_cache as (string | number | null)[][]
        }
        // cache miss; execute command, then return and cache
        const output = await exec_stmt(stmt)
        if (output instanceof Error) {
            return Promise.reject(output)
        }
        ctx.waitUntil(putCache(ctx, identifier, output.results as (string | number | null)[][], new Date().toISOString(), false))
        return output.results as (string | number | null)[][]
    }
}

async function _cacheFetch(key: string, long: boolean, ctx: ExecutionContext): Promise<unknown> {
    // fetches the identified data from Cache API and KV
    // check Cache API first
    const cache_result = await getCache(key)
    if (cache_result) {
        return cache_result
    }
    // check KV
    const kv_result = await getKey(key)
    if (kv_result) {
        // update Cache API with the KV result for faster future retrieval
        await putCache(ctx, key, kv_result, new Date().toISOString(), long)
        return kv_result
    }
    return null
    
}



async function _addPrimitive(ctx: ExecutionContext, schema: D1Schema, record: Contributor | Composition | Composer): Promise<null | Error> {
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
    const output = await _exec_wrap(stmt, ctx)
    if (output instanceof Error) {
        return Promise.reject(output)
    }
    return Promise.resolve(null)
}

export async function _getPrimitiveCacheless(schema: D1Schema, param: string, value: string): Promise<any | null | Error> {
    // the _getPrimitiveCacheless variant provides direct access to D1, bypassing the caching layers
    // this function may be used in lieu of D1 primitives for security-relevant operations
    if (!schema.index.includes(param)) {
        return Promise.reject(new Error("Param is not a unique column"))
    }
    let response: D1Result | Error
    if (param === schema.primary_key) {
        response = await getRecord(schema, parseInt(value))
    } else {
        response = await getRecordSpecificProp(schema, param, value)
    }
    if (response instanceof Error) {
        return Promise.reject(response)
    }
    if (response.results.length === 0) {
        return Promise.resolve(null)
    }
    return Promise.resolve(response.results[0])
}

async function _getPrimitive(ctx: ExecutionContext, schema: D1Schema, param: string, value: string): Promise<(string | number | null)[] | null | Error> {
    if (!schema.index.includes(param)) {
        return Promise.reject(new Error("Param is not a unique column"))
    }
    const stmt = new SQLStatement(schema, "SELECT", schema.name)
    stmt.addWhere(param, value, SQLCompareOp.EQ)
    const response: (string | number | null)[][] | Error = await _exec_wrap(stmt, ctx) 
    if (response instanceof Error) {
        return Promise.reject(response)
    }
    if (response.length === 0) {
        return Promise.resolve(null)
    }
    return Promise.resolve(response[0])
}

async function _updatePrimitive(ctx: ExecutionContext, schema: D1Schema, id: number, record: Contributor | Composition | Composer): Promise<null | Error> {
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
    if (output instanceof Error) {
        return Promise.reject(output)
    } else {
        return Promise.resolve(null)
    }
}

async function _updatePrimitivePartial(ctx: ExecutionContext, schema: D1Schema, id: number, record: Partial<Contributor | Composition | Composer> & { id: number }): Promise<null | Error> {
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
    stmt.addColumns(Object.keys(cleanEntry).filter(col => col !== schema.primary_key && !schema.repr_exclude.includes(col))) // exclude primary key and entry date from update
    stmt.addValueGroup(cleanEntry, [schema.primary_key, ...schema.repr_exclude]) // exclude primary key and entry date from update
    stmt.addWhere(schema.primary_key, id.toString(), SQLCompareOp.EQ)
    const output = await _exec_wrap(stmt, ctx)
    if (output instanceof Error) {
        return Promise.reject(output)
    } else {
        return Promise.resolve(null)
    }
}

async function _deletePrimitive(ctx: ExecutionContext, schema: D1Schema, id: number): Promise<null | Error> {
    const stmt = new SQLStatement(schema, "DELETE", schema.name)
    stmt.addWhere(schema.primary_key, id.toString(), SQLCompareOp.EQ)
    const output = await _exec_wrap(stmt, ctx)
    if (output instanceof Error) {
        return Promise.reject(output)
    } else {
        return Promise.resolve(null)
    }
}

async function _listPrimitive(ctx: ExecutionContext, schema: D1Schema): Promise<(string | number | null)[][] | Error> {
    const stmt = new SQLStatement(schema, "SELECT", schema.name)
    const output = await _exec_wrap(stmt, ctx)
    if (output instanceof Error) {
        return Promise.reject(output)
    } else {
        return Promise.resolve(output)
    }
}

async function _getWrapper(schema: D1Schema, result: (string | number | null)[] | null | Error): Promise<ContributorRecord | ComposerRecord | CompositionRecord | null | Error> {
    // provides type conversion between the raw D1 output into the D1 type primitives, then converts to the API type primitives
    
    // the wrapper assumes that the result contains all columns in the same order; as such, it is an internal function
    // only used within the exported functions
    
    if (result instanceof Error || result === null) {
        return Promise.reject(result)
    }
    let output
    switch (schema) {
        case CONTRIBUTOR:
            output = formatContribFromD1(SQLStatement._constructObject(schema, result) as D1Contributor) as ContributorRecord
            break
        case COMPOSER:
            output = formatCompFromD1(SQLStatement._constructObject(schema, result) as D1Composer) as ComposerRecord
            break
        case COMPOSITION:
            output = formatWorkFromD1(SQLStatement._constructObject(schema, result) as D1Composition) as CompositionRecord
            break
        default:
            throw new Error("Invalid schema")
    }
    return Promise.resolve(output)
}

async function _listWrapper(schema: D1Schema, result: (string | number | null)[][] | null | Error): Promise<ContributorRecord[] | ComposerRecord[] | CompositionRecord[] | Error | null> {
    // see _getWrapper for details; this function implements _getWrapper on a list of result rows
    if (result instanceof Error || result === null) {
        return Promise.reject(result)
    }
    let output
    switch (schema) {
        case CONTRIBUTOR:
            output = result.map(row => formatContribFromD1(SQLStatement._constructObject(schema, row) as D1Contributor) as ContributorRecord)
            break
        case COMPOSER:
            output = result.map(row => formatCompFromD1(SQLStatement._constructObject(schema, row) as D1Composer) as ComposerRecord)
            break
        case COMPOSITION:
            output = result.map(row => formatWorkFromD1(SQLStatement._constructObject(schema, row) as D1Composition) as CompositionRecord)
            break
        default:
            throw new Error("Invalid schema")
    }
    return output
}

export async function getContributor(ctx: ExecutionContext, param: string, value: string): Promise<ContributorRecord | null | Error> {
    // given the unique param and its value, return the contributor record
    // caching is implemented at the primitive level
    return _getWrapper(CONTRIBUTOR, await _getPrimitive(ctx, CONTRIBUTOR, param, value)) as Promise<ContributorRecord | null | Error>
}

export async function addContributor(ctx: ExecutionContext, record: Contributor): Promise<null | Error> {
    // adds a contributor record to the database, returning the new record's id
    return await _addPrimitive(ctx, CONTRIBUTOR, record)
}

export async function updateContributor(ctx: ExecutionContext, id: number, record: Contributor): Promise<null | Error> {
    // updates a contributor record in the database, returning null if successful
    return await _updatePrimitive(ctx, CONTRIBUTOR, id, record)
}

export async function updateContributorPartial(ctx: ExecutionContext, id: number, record: Partial<Contributor> & { id: number }): Promise<null | Error> {
    return await _updatePrimitivePartial(ctx, CONTRIBUTOR, id, record)
}

export async function deleteContributor(ctx: ExecutionContext, id: number): Promise<null | Error> {
    return await _deletePrimitive(ctx, CONTRIBUTOR, id)
}

export async function listContributors(ctx: ExecutionContext): Promise<ContributorRecord[] | Error | null> {
    return _listWrapper(CONTRIBUTOR, await _listPrimitive(ctx, CONTRIBUTOR)) as Promise<ContributorRecord[] | Error | null>
}

export async function getComposer(ctx: ExecutionContext, param: string, value: string): Promise<D1Composer | null | Error> {
    // retrieves a composer record based on the unique param
    return _getWrapper(COMPOSER, await _getPrimitive(ctx, COMPOSER, param, value)) as Promise<D1Composer | Error | null>
}

export async function addComposer(ctx: ExecutionContext, record: Composer): Promise<null | Error> {
    return await _addPrimitive(ctx, COMPOSER, record)
}

export async function updateComposer(ctx: ExecutionContext, id: number, record: Composer): Promise<null | Error> {
    return await _updatePrimitive(ctx, COMPOSER, id, record)
}

export async function updateComposerPartial(ctx: ExecutionContext, id: number, record: Partial<Composer> & { id: number }): Promise<null | Error> {
    return await _updatePrimitivePartial(ctx, COMPOSER, id, record)
}

export async function deleteComposer(ctx: ExecutionContext, id: number): Promise<null | Error> {
    return await _deletePrimitive(ctx, COMPOSER, id)
}

export async function listComposers(ctx: ExecutionContext): Promise<D1Composer[] | Error | null> {
    return _listWrapper(COMPOSER, await _listPrimitive(ctx, COMPOSER)) as Promise<D1Composer[] | Error | null>
}

export async function getComposition(ctx: ExecutionContext, param: string, value: string): Promise<D1Composition | null | Error> {
    return _getWrapper(COMPOSITION, await _getPrimitive(ctx, COMPOSITION, param, value)) as Promise<D1Composition | null | Error>
}

export async function addComposition(ctx: ExecutionContext, record: Composition): Promise<null | Error> {
    return await _addPrimitive(ctx, COMPOSITION, record)
}

export async function updateComposition(ctx: ExecutionContext, id: number, record: Composition): Promise<null | Error> {
    return await _updatePrimitive(ctx, COMPOSITION, id, record)
}

export async function updateCompositionPartial(ctx: ExecutionContext, id: number, record: Partial<Composition> & { id: number }): Promise<null | Error> {
    return await _updatePrimitivePartial(ctx, COMPOSITION, id, record)
}

export async function deleteComposition(ctx: ExecutionContext, id: number): Promise<null | Error> {
    return await _deletePrimitive(ctx, COMPOSITION, id)
}

export async function listCompositions(ctx: ExecutionContext): Promise<D1Composition[] | Error | null> {
    return _listWrapper(COMPOSITION, await _listPrimitive(ctx, COMPOSITION)) as Promise<D1Composition[] | Error | null>
}