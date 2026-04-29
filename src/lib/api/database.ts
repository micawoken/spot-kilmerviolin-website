/**
 * lib/api/database.ts
 * 
 * Provides higher-level database services on top of d1, including caching
 * 
 * 
 * Dependent on d1.ts
 */

import { formatContribToD1, formatContribToD1Partial, formatCompToD1, formatWorkToD1, formatWorkToD1Partial, formatCompToD1Partial, formatContribFromD1 } from "./common"
import { CONTRIBUTOR, COMPOSER, COMPOSITION, SQLStatement, exec_stmt, getRecord, getRecordSpecificProp, deleteRecord } from "./d1"


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

async function _addPrimitive(schema: D1Schema, record: Contributor | Composition | Composer): Promise<null | Error> {
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
    const output = await exec_stmt(stmt)
    if (output instanceof Error) {
        return Promise.reject(output)
    }
    return Promise.resolve(null)
}

async function _getPrimitive(schema: D1Schema, param: string, value: string): Promise<any | null | Error> {
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

async function _updatePrimitive(schema: D1Schema, id: number, record: Contributor | Composition | Composer): Promise<null | Error> {
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
    const output = await exec_stmt(stmt)
    if (output instanceof Error) {
        return Promise.reject(output)
    } else {
        return Promise.resolve(null)
    }
}

async function _updatePrimitivePartial(schema: D1Schema, id: number, record: Partial<Contributor | Composition | Composer> & { id: number }): Promise<null | Error> {
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
    const output = await exec_stmt(stmt)
    if (output instanceof Error) {
        return Promise.reject(output)
    } else {
        return Promise.resolve(null)
    }
}

async function _deletePrimitive(schema: D1Schema, id: number): Promise<null | Error> {
    const stmt = new SQLStatement(schema, "DELETE", schema.name)
    stmt.addWhere(schema.primary_key, id.toString(), SQLCompareOp.EQ)
    const output = await exec_stmt(stmt)
    if (output instanceof Error) {
        return Promise.reject(output)
    } else {
        return Promise.resolve(null)
    }
}

async function _listPrimitive(schema: D1Schema): Promise<any[] | Error> {
    const stmt = new SQLStatement(schema, "SELECT", schema.name)
    const output = await exec_stmt(stmt)
    if (output instanceof Error) {
        return Promise.reject(output)
    } else {
        return Promise.resolve(output.results)
    }
}

export async function getContributor(param: string, value: string): Promise<ContributorRecord | null | Error> {
    // given the unique param and its value, return the contributor record

    // check caching here

    const result = await _getPrimitive(CONTRIBUTOR, param, value)
    if (result instanceof Error || result === null) {
        return result
    }
    const output = formatContribFromD1(result as D1Contributor) as ContributorRecord

    // implement caching here

    return output
}



async function _addContributor(record: Contributor): Promise<null | Error> {
    // adds a contributor record to the database, returning the new record's id
    return await _addPrimitive(CONTRIBUTOR, record)
}

async function _updateContributor(id: number, record: Contributor): Promise<null | Error> {
    // updates a contributor record in the database, returning null if successful
    return await _updatePrimitive(CONTRIBUTOR, id, record)
}

async function _updateContributorPartial(id: number, record: Partial<Contributor> & { id: number}): Promise<null | Error> {
    const stmt = new SQLStatement(CONTRIBUTOR, "UPDATE", "contributors")
    const entry: Partial<D1Contributor> = formatContribToD1Partial(record)
    const cleanEntry = Object.fromEntries(Object.entries(entry).filter(([_, value]) => value !== undefined)) as Record<string, string | number | null>
    stmt.addColumns(Object.keys(cleanEntry).filter(col => col !== "contributor_id" && col !== "entry_date")) // exclude primary key and entry date from update
    stmt.addValueGroup(cleanEntry, ["contributor_id", "entry_date"]) // exclude primary key and entry date from update
    stmt.addWhere("contributor_id", id.toString(), SQLCompareOp.EQ)
    const output = await exec_stmt(stmt)
    if (output instanceof Error) {
        return Promise.reject(output)
    } else {
        return Promise.resolve(null)
    }
}

async function _deleteContributor(id: number): Promise<null | Error> {
    return await _deletePrimitive(CONTRIBUTOR, id)
}

async function _listContributors(): Promise<ContributorRecord[] | Error> {
    const stmt = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors")
    const output = await exec_stmt(stmt)
    if (output instanceof Error) {
        return Promise.reject(output)
    } else {
        return Promise.resolve(output.results as ContributorRecord[])
    }
}

async function _getComposer(param: string, value: string): Promise<D1Composer | null | Error> {
    // retrieves a composer record based on the unique param
    return await _getPrimitive(COMPOSER, param, value) as Promise<D1Composer | null | Error>
}

async function _addComposer(record: Composer): Promise<null | Error> {
    return await _addPrimitive(COMPOSER, record)
}

async function _updateComposer(id: number, record: Composer): Promise<null | Error> {
    return await _updatePrimitive(COMPOSER, id, record)
}

async function _deleteComposer(id: number): Promise<null | Error> {
    return await _deletePrimitive(COMPOSER, id)
}