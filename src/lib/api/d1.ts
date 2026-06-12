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
import { Key, sqlListJoin, WorkType } from "./common.ts"
import { SQLStatement } from "./sql.ts"


const d1_contrib_sql_init: string = `
CREATE TABLE contributors ( 
contributor_id INTEGER PRIMARY KEY AUTOINCREMENT, 
name TEXT UNIQUE NOT NULL,
class_year INTEGER,
major TEXT,
phases TEXT,
bio TEXT, 
public_email TEXT, 
identity_email TEXT UNIQUE NOT NULL, 
active INTEGER NOT NULL, 
roles TEXT NOT NULL, 
admin INTEGER NOT NULL, 
image TEXT, 
tags TEXT, 
entry_date TEXT NOT NULL 
);
`
const d1_composer_sql_init: string = `
CREATE TABLE composers ( 
composer_id INTEGER PRIMARY KEY AUTOINCREMENT, 
name TEXT UNIQUE NOT NULL, 
role TEXT NOT NULL,
birth_year INTEGER NOT NULL, 
death_year INTEGER NOT NULL, 
country TEXT NOT NULL, 
bio TEXT, 
image TEXT, 
tags TEXT, 
entry_date TEXT NOT NULL 
);
`
const d1_composition_sql_init: string = `
CREATE TABLE compositions (
composition_id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
composer_id INTEGER NOT NULL,
contrib_primary_1 INTEGER NOT NULL,
contrib_primary_2 INTEGER,
contrib_addl TEXT,
author_secondary TEXT,
type TEXT NOT NULL,
part TEXT,
rating_suzuki INTEGER,
rating_nyssma INTEGER,
publish_location TEXT NOT NULL,
publish_name TEXT NOT NULL,
publish_year INTEGER NOT NULL,
uri_type TEXT NOT NULL,
uri TEXT,
key TEXT,
range TEXT,
position_highest TEXT,
notes_pedagogical TEXT,
notes_historical TEXT,
notes_other TEXT,
image TEXT,
phases TEXT NOT NULL,
entry_date TEXT NOT NULL,
tags TEXT,
FOREIGN KEY (composer_id) REFERENCES composers(composer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
FOREIGN KEY (contrib_primary_1) REFERENCES contributors(contributor_id) ON UPDATE CASCADE ON DELETE RESTRICT,
FOREIGN KEY (contrib_primary_2) REFERENCES contributors(contributor_id) ON UPDATE CASCADE ON DELETE RESTRICT
);
`



/**
 * Schema for contributors table
 */
export const CONTRIBUTOR: D1Schema = {
    db: env.DB_MAIN,
    name: "contributors",
    columns: ["contributor_id", "name", "class_year", "major", "phases", "bio", "public_email", "identity_email", "active", "roles", "admin", "image", "tags", "entry_date"],
    index: ["contributor_id", "identity_email", "public_email"],
    repr_exclude: ["entry_date"],
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
        entry_date: "string"
    },
    protected: ["roles", "admin", "identity_email"]
}

/**
 * Schema for composers table
 */
export const COMPOSER: D1Schema = {
    db: env.DB_MAIN,
    name: "composers",
    columns: ["composer_id", "name", "role", "birth_year", "death_year", "country", "bio", "image", "tags", "entry_date"],
    index: ["composer_id", "name"],
    repr_exclude: ["entry_date"],
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
        entry_date: "string"
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
        "notes_historical", "notes_other", "image", "phases", "entry_date", "tags"],
    index: ["composition_id"],
    repr_exclude: ["entry_date"],
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
        tags: "string"
    }
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
        throw error
    }

    let exec_result
    try {
        exec_result = await prepared.bind(...params).run()
    } catch (error) {
        throw error
    }
    
    if (!exec_result.success) {
        throw new Error(`SQL execution failed.`)
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
    // DB_ENABLE_WRITE gates all writes issued through the statement abstraction (see wrangler.jsonc)
    if (stmt.verb !== "SELECT" && !env.DB_ENABLE_WRITE) {
        throw new Error("Database writes are disabled by DB_ENABLE_WRITE")
    }
    let finished
    try {
        finished = stmt.finish()
        if (!finished) {
            throw new Error("Failed to finalize SQL statement: missing required components")
        }
    } catch (error) {
        throw error
    }
    const [command, params] = finished
    const result = await _exec(command, params)
    if (!result) {
        throw new Error("Failed to execute SQL statement")
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
 * Given an unknown object from JSON, determine if it is a complete Contributor record and perform a type assertion
 * 
 * @param record the record to check and assert
 * @returns the record as a Contributor type if valid, or a string error message if invalid
 */
export function _stateTypeAssertCompleteContributor(record: unknown, expect_id: boolean = true): Contributor | string {
    // type guard
    if (typeof record !== "object" || record === null) {
        return "Record is not an object"
    }
    const r = record as { [key: string]: any }

    console.log(record)

    console.log("Asserting contributor record:",
        ((typeof r.id !== "number") && (typeof r.id !== "undefined" || expect_id)),
        (typeof r.class_year !== "number" && r.class_year !== null),
        typeof r.name !== "string",
        (typeof r.major !== "string" && r.major !== null),
        (!(r.phases instanceof Array) && r.phases !== null),
        (typeof r.bio !== "string" && r.bio !== null),
        (typeof r.public_email !== "string" && r.public_email !== null),
        typeof r.identity_email !== "string",
        typeof r.active !== "boolean",
        !(r.roles instanceof Array),
        typeof r.admin !== "boolean",
        (typeof r.image !== "string" && r.image !== null))

    console.log(r)

    // class_year, major, and phases are nullable columns, so null is accepted alongside their base types
    if (((typeof r.id !== "number") && (typeof r.id !== "undefined" || expect_id)) ||
        typeof r.name !== "string" ||
        (typeof r.class_year !== "number" && r.class_year !== null) ||
        (typeof r.major !== "string" && r.major !== null) ||
        (!(r.phases instanceof Array) && r.phases !== null) ||
        (typeof r.bio !== "string" && r.bio !== null) ||
        (typeof r.public_email !== "string" && r.public_email !== null) ||
        typeof r.identity_email !== "string" ||
        typeof r.active !== "boolean" ||
        !(r.roles instanceof Array) ||
        typeof r.admin !== "boolean" ||
        (typeof r.image !== "string" && r.image !== null)) {
        return "Record has invalid types for one or more parameters"
    }
    // validate arrays are of correct type
    if (r.phases !== null && r.phases.length > 0 && !r.phases.every((phase: any) => typeof phase === "number")) {
        return "Record has invalid type for phases parameter"
    }
    if (!r.roles.every((role: any) => typeof role === "string") && r.roles.length > 0) {
        return "Record has invalid type for roles parameter"
    }
    return r as Contributor
} 

/**
 * Given an unknown object from JSON, determine if it is a valid partial Contributor record and perform a type assertion
 * 
 * @param record the record to check and assert
 * @returns the record as a partial Contributor type if valid, or a string error message if invalid
 */
export function _stateTypeAssertPartialContributor(record: unknown, expect_id: boolean = true): Partial<Contributor> | string {
    // type guard
    if (typeof record !== "object" || record === null) {
        return "Record is not an object"
    }
    const r = record as { [key: string]: any }
    // class_year, major, and phases are nullable columns, so null is accepted alongside their base types
    if (((typeof r.id !== "number") && (typeof r.id !== "undefined" || expect_id)) ||
        (r.name !== undefined && typeof r.name !== "string") ||
        (r.class_year !== undefined && typeof r.class_year !== "number" && r.class_year !== null) ||
        (r.major !== undefined && typeof r.major !== "string" && r.major !== null) ||
        (r.phases !== undefined && !(r.phases instanceof Array) && r.phases !== null) ||
        (r.bio !== undefined && typeof r.bio !== "string" && r.bio !== null) ||
        (r.public_email !== undefined && typeof r.public_email !== "string" && r.public_email !== null) ||
        (r.identity_email !== undefined && typeof r.identity_email !== "string") ||
        (r.active !== undefined && typeof r.active !== "boolean") ||
        (r.roles !== undefined && !(r.roles instanceof Array)) ||
        (r.admin !== undefined && typeof r.admin !== "boolean") ||
        (r.image !== undefined && typeof r.image !== "string" && r.image !== null)) {
        return "Record has invalid types for one or more parameters"
    }
    // validate arrays are of correct type, if they exist
    if (r.phases !== undefined && r.phases !== null && (r.phases.length > 0 && !r.phases.every((phase: any) => typeof phase === "number"))) {
        return "Record has invalid type for phases parameter"
    }
    if (r.roles !== undefined && (!r.roles.every((role: any) => typeof role === "string") && r.roles.length > 0)) {
        return "Record has invalid type for roles parameter"
    }
    return r as Partial<Contributor>
}

/**
 * Given an unknown object from JSON, determine if it is a complete Composer record and perform a type assertion
 * 
 * @param record the record to check and assert
 * @returns the record as a Composer type if valid, or a string error message if invalid
 */
export function _stateTypeAssertCompleteComposer(record: unknown, expect_id: boolean = true): Composer | string {
    // type guard
    if (typeof record !== "object" || record === null) {
        return "Record is not an object"
    }
    const r = record as { [key: string]: any }
    if (((typeof r.id !== "number") && (typeof r.id !== "undefined" || expect_id)) ||
        typeof r.name !== "string" ||
        typeof r.role !== "string" ||
        typeof r.birth_year !== "number" ||
        typeof r.death_year !== "number" ||
        (typeof r.image !== "string" && r.image !== null) ||
        (typeof r.bio !== "string" && r.bio !== null)) {
        return "Record has invalid types for one or more parameters"
    }
    return r as Composer
}

/**
 * Given an unknown object from JSON, determine if it is a valid partial Composer record and perform a type assertion
 * 
 * @param record the record to check and assert
 * @returns the record as a partial Composer type if valid, or a string error message if invalid
 */
export function _stateTypeAssertPartialComposer(record: unknown, expect_id: boolean = true): Partial<Composer> | string {
    // type guard
    if (typeof record !== "object" || record === null) {
        return "Record is not an object"
    }
    const r = record as { [key: string]: any }
    if (((typeof r.id !== "number") && (typeof r.id !== "undefined" || expect_id)) ||
        (r.name !== undefined && typeof r.name !== "string") ||
        (r.role !== undefined && typeof r.role !== "string") ||
        (r.birth_year !== undefined && typeof r.birth_year !== "number") ||
        (r.death_year !== undefined && typeof r.death_year !== "number") ||
        (r.image !== undefined && typeof r.image !== "string" && r.image !== null) ||
        (r.bio !== undefined && typeof r.bio !== "string" && r.bio !== null)) {
        return "Record has invalid types for one or more parameters"
    }
    return r as Partial<Composer>
}

/**
 * Given an unknown object from JSON, determine if it is a complete CompRating record and perform a type assertion
 * 
 * @param record the record to check and assert
 * @returns the record as a CompRating type if valid, or a string error message if invalid
 */
function validateCompRating(record: unknown, partial: boolean = false): boolean {
    if (typeof record !== "object" || record === null) {
        return false
    }
    const r = record as { [key: string]: any }

    const tests: boolean[] = [
        "suzuki" in r ? typeof r.suzuki === "number" : false,
        "nyssma" in r ? typeof r.nyssma === "number" : false
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
        "year" in r ? typeof r.year === "number" : false,
        "uri_type" in r ? typeof r.uri_type === "string" : false,
        "uri" in r ? typeof r.uri === "string" : false
    ]
    return partial ? tests.some(test => test) : tests.every(test => test)
}
/**
 * Given an unknown object from JSON, determine if it is a complete Composition record and perform a type assertion
 * 
 * @param record the record to check and assert
 * @returns the record as a Composition type if valid, or a string error message if invalid
 */
export function _stateTypeAssertCompleteComposition(record: unknown, expect_id: boolean = true): Composition | string {
    // type guard
    if (typeof record !== "object" || record === null) {
        return "Record is not an object"
    }
    const r = record as { [key: string]: any }


    console.log(((typeof r.id !== "number") && (typeof r.id !== "undefined" || expect_id)),
        typeof r.name !== "string",
        typeof r.composer_id !== "number",
        typeof r.contrib_primary_1 !== "number",
        (r.contrib_primary_2 !== null && typeof r.contrib_primary_2 !== "number"),
        (!(r.contrib_addl instanceof Array)),
        (!(r.author_secondary instanceof Array)),
        (!(r.phases instanceof Array)),
        (typeof r.type !== "string" && !(r.type in WorkType)),
        (typeof r.part !== "string" && r.part !== null),
        ((typeof r.key !== "string" && !(r.key in Key)) && r.key !== null),
        (typeof r.range !== "string" && r.range !== null),
        (typeof r.position_highest !== "string" && r.position_highest !== null),
        (typeof r.notes_pedagogical !== "string" && r.notes_pedagogical !== null),
        (typeof r.notes_historical !== "string" && r.notes_historical !== null),
        (typeof r.notes_other !== "string" && r.notes_other !== null),
        (r.rating !== null && !validateCompRating(r.rating, false)),
        !validatePubInfo(r.publication_info, false))
    if (((typeof r.id !== "number") && (typeof r.id !== "undefined" || expect_id)) ||
        typeof r.name !== "string" ||
        typeof r.composer_id !== "number" ||
        typeof r.contrib_primary_1 !== "number" || 
        (r.contrib_primary_2 !== null && typeof r.contrib_primary_2 !== "number") ||
        (!(r.contrib_addl instanceof Array)) ||
        (!(r.author_secondary instanceof Array)) ||
        (!(r.phases instanceof Array)) ||
        (typeof r.type !== "string" && !(r.type in WorkType)) ||
        (typeof r.part !== "string" && r.part !== null) ||
        ((typeof r.key !== "string" && !(r.key in Key)) && r.key !== null) ||
        (typeof r.range !== "string" && r.range !== null) ||
        (typeof r.position_highest !== "string" && r.position_highest !== null) ||
        (typeof r.notes_pedagogical !== "string" && r.notes_pedagogical !== null) ||
        (typeof r.notes_historical !== "string" && r.notes_historical !== null) ||
        (typeof r.notes_other !== "string" && r.notes_other !== null) ||
        (r.rating !== null && !validateCompRating(r.rating, false)) ||
        !validatePubInfo(r.publication_info, false))
    {
        return "Record has invalid types for one or more parameters"
    }
    return r as Composition
}

/**
 * Given an unknown object from JSON, determine if it is a valid partial Composition record and perform a type assertion
 * 
 * @param record the record to check and assert
 * @returns the record as a partial Composition type if valid, or a string error message if invalid
 */
export function _stateTypeAssertPartialComposition(record: unknown, expect_id: boolean = true): Partial<Composition> | string {
    // type guard
    if (typeof record !== "object" || record === null) {
        return "Record is not an object"
    }
    const r = record as { [key: string]: any }
    if (((typeof r.id !== "number") && (typeof r.id !== "undefined" || expect_id)) ||
        (r.name !== undefined && typeof r.name !== "string") ||
        (r.composer_id !== undefined && typeof r.composer_id !== "number") ||
        (r.contrib_primary_1 !== undefined && typeof r.contrib_primary_1 !== "number") || 
        (r.contrib_primary_2 !== undefined && (r.contrib_primary_2 !== null && typeof r.contrib_primary_2 !== "number")) ||
        (r.contrib_addl !== undefined && !(r.contrib_addl instanceof Array)) ||
        (r.author_secondary !== undefined && !(r.author_secondary instanceof Array)) ||
        (r.phases !== undefined && !(r.phases instanceof Array)) ||
        (r.type !== undefined && (typeof r.type !== "string" && !(r.type in WorkType))) ||
        (r.part !== undefined && (typeof r.part !== "string" && r.part !== null)) ||
        (r.key !== undefined && ((typeof r.key !== "string" && !(r.key in Key)) && r.key !== null)) ||
        (r.range !== undefined && (typeof r.range !== "string" && r.range !== null)) ||
        (r.position_highest !== undefined && (typeof r.position_highest !== "string" && r.position_highest !== null)) ||
        (r.notes_pedagogical !== undefined && (typeof r.notes_pedagogical !== "string" && r.notes_pedagogical !== null)) ||
        (r.notes_historical !== undefined && (typeof r.notes_historical !== "string" && r.notes_historical !== null)) ||
        (r.notes_other !== undefined && (typeof r.notes_other !== "string" && r.notes_other !== null)) ||
        (r.rating !== undefined && !validateCompRating(r.rating, true)) ||
        (r.publication_info !== undefined && !validatePubInfo(r.publication_info, true))) 
    {
        return "Record has invalid types for one or more parameters"
    }
    return r as Partial<Composition>
}