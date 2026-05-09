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
import { sqlListJoin } from "./common.ts"
import { SQLStatement } from "./sql.ts"


export const CONTRIBUTOR: D1Schema = {
    db: env.DB_MAIN,
    name: "contributors",
    columns: ["contributor_id", "name", "class_year", "major", "phases", "bio", "public_email", "identity_email", "active", "roles", "admin", "image"],
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
        image: "string"
    }
}

export const COMPOSER: D1Schema = {
    db: env.DB_MAIN,
    name: "composers",
    columns: ["composer_id", "name", "role", "birth_year", "death_year", "image", "bio"],
    index: ["composer_id", "name"],
    repr_exclude: ["entry_date"],
    primary_key: "composer_id",
    type_hint: {
        composer_id: "number",
        name: "string",
        role: "string",
        birth_year: "number",
        death_year: "number",
        image: "string",
        bio: "string"
    }
}

export const COMPOSITION: D1Schema = {
    db: env.DB_MAIN,
    name: "compositions",
    // columns use shape of Composition interface
    columns: ["composition_id", "name", "composer_id", "composer_name", "contrib_primary_1", "contrib_primary_2",
        "contrib_addl", "composer_addl", "type", "part", "suzuki_rating", "nyssma_rating", "publish_location",
        "publish_name", "publish_year", "uri_type", "uri", "key", "range", "position_highest", "notes_pedagogical",
        "notes_historical", "notes_other", "phases"],
    index: ["composition_id"],
    repr_exclude: ["entry_date", "full_name"],
    primary_key: "composition_id",
    type_hint: {
        composition_id: "number",
        name: "string",
        composer_id: "number",
        composer_name: "string",
        contrib_primary_1: "number", // contributor ID
        contrib_primary_2: "number",
        contrib_addl: "string", // comma-separated contributor IDs
        composer_addl: "string", // comma-separated composer IDs
        type: "string",
        part: "string",
        suzuki_rating: "number",
        nyssma_rating: "number",
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
        phases: "string" // comma-separated phase numbers, which are converted to a number array later
    }
}

async function _exec(command: string, params: unknown[]): Promise<D1Result | Error> {
    let prepared: D1PreparedStatement
    try {
        prepared = env.DB_MAIN.prepare(command)
    } catch (error) {
        return Promise.reject(error)
    }

    let exec_result
    try {
        exec_result = await prepared.bind(...params).run()
    } catch (error) {
        return Promise.reject(error)
    }
    
    if (!exec_result.success) {
        return Promise.reject(new Error(`SQL execution failed.`))
    }

    return exec_result // will format later
}

export async function exec_stmt(stmt: SQLStatement): Promise<D1Result | Error> {
    let finished
    try {
        finished = stmt.finish()
        if (!finished) {
            return Promise.reject(new Error("Failed to finalize SQL statement: missing required components"))
        }
    } catch (error) {
        return Promise.reject(error)
    }
    const [command, params] = finished
    return _exec(command, params).then(result => {
        if (!result) {
            return Promise.reject(new Error("Failed to execute SQL statement"))
        }
        return result
    })
}

export async function exec_string(command: string, params: unknown[] = []): Promise<D1Result | Error> {
    return _exec(command, params).then(result => {
        if (!result) {
            return Promise.reject(new Error("Failed to execute SQL statement"))
        }
        return result
    })
}

export function getRecord(schema: D1Schema, id: number): Promise<D1Result | Error> {
    const statement = `SELECT * FROM ${schema.name} WHERE ${schema.primary_key} = ?;`
    return _exec(statement, [id.toString()])
}

export function getRecordSpecificProp(schema: D1Schema, param: string, value: string): Promise<D1Result | Error> {
    // mainly used in authorization mechanism to query
    const statement = `SELECT * FROM ${schema.name} WHERE ${param} = ?;`
    return _exec(statement, [value])
}

export function deleteRecord(schema: D1Schema, id: number): Promise<D1Result | Error> {
    const statement = `DELETE FROM ${schema.name} WHERE ${schema.primary_key} = ?;`
    return _exec(statement, [id.toString()])
}

// complex operations, i.e. insertion, updates, and complex selects, can only be performed using exec_stmt