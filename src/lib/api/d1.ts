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
import { sqlListJoin } from "./common"

export const CONTRIBUTOR: D1Schema = {
    db: env.DB_MAIN,
    name: "contributors",
    columns: ["contributor_id", "name", "class_year", "major", "phases", "bio", "public_email", "identity_email", "active", "roles", "admin", "image"],
    index: ["contributor_id", "identity_email", "public_email"],
    repr_exclude: ["entry_date"],
    primary_key: "contributor_id"
}

export const COMPOSER: D1Schema = {
    db: env.DB_MAIN,
    name: "composers",
    columns: ["composer_id", "name", "role", "birth_year", "death_year", "image", "bio"],
    index: ["composer_id", "name"],
    repr_exclude: ["entry_date"],
    primary_key: "composer_id"
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
    primary_key: "composition_id"
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

export class SQLStatement {
    schema: D1Schema // used for enforcement of column names
    // schema validation executes on statement finalization, not during construction or composition
    verb: "SELECT" | "INSERT" | "UPDATE" | "DELETE" // used to specify statement, used by all
    distinct: boolean = false // used for SELECT
    columns: string[] = [] // used by all statements; specifies a paramName to query; used for order enforcement of UPDATE AND INSERT
    from: string | null = null // used by SELECT, UPDATE, DELETE
    values: Record<string, string | number | null>[] = [] // used by INSERT and UPDATE; stores paramName: value pairs in groups
    where: Array<[string, string | string[], SQLCompareOp]> = [] // used by SELECT, UPDATE, DELETE
    // where stores the following info: [paramName, value (or list of values, depending on operator), comparison operator]
    order_by: Array<[string, string]> = [] // used by SELECT
    // stores [paramName, direction]
    limit: number = 0 // used by SELECT; 0 is no limit

    constructor(schema: D1Schema, verb: "SELECT" | "INSERT" | "UPDATE" | "DELETE", from: string, columns: string[] = []) {
        this.schema = schema
        this.verb = verb
        this.from = from
    }

    setVerb(verb: "SELECT" | "INSERT" | "UPDATE" | "DELETE"): void {
        this.verb = verb
    }

    setFrom(from: string): void {
        this.from = from
    }

    addColumn(column: string): void {
        this.columns.push(column)
    }

    addColumns(columns: string[]): void {
        this.columns.push(...columns)
    }

    removeColumn(column: string): void {
        this.columns = this.columns.filter(col => col !== column)
    }

    addValueGroup<T extends Record<string, string | number | null>>(group: T, exclude?: string[]): void {
        const filtered: Record<string, string | number | null> = {}
        for (const key in group) {
            if (exclude && exclude.includes(key)) {
                continue
            }
            filtered[key] = group[key]
        }
        this.values.push(filtered)
    }

    clearValues(): void {
        this.values = []
    }

    addWhere(param: string, value: string, op: SQLCompareOp): void {
        this.where.push([param, value, op])
    }

    removeWhere(param: string): void {
        this.where = this.where.filter(([key]) => key !== param)
    }

    clearWhere(): void {
        this.where = []
    }

    addOrderBy(param: string, direction: "ASC" | "DESC"): void {
        this.order_by.push([param, direction])
    }

    removeOrderBy(param: string): void {
        this.order_by = this.order_by.filter(([key]) => key !== param)
    }

    clearOrderBy(): void {
        this.order_by = []
    }

    setLimit(limit: number): void {
        this.limit = limit
    }

    finish(): [string, Array<string | number | null>] | null {
        // returns (1) a string of the SQL command, and a list of prepared arguments in order

        if (!this.from) {
            return null
        }

        if (this.columns.length === 0 && (this.verb === "DELETE" || this.verb === "UPDATE")) {
            throw new Error("At least one column is required for UPDATE or DELETE statements")
        } else if (this.columns.length === 0 && this.verb !== "DELETE" && this.verb !== "UPDATE") {
            this.columns.push("*")
        }

        if (this.columns.indexOf("*") !== -1 && this.columns.length > 1) {
            throw new Error("'*' cannot be used with other columns")
        }

        // validate that columns and where clauses conform to schema
        if (this.columns.length > 0) {
            const validColumns = this.schema.columns
            for (const column of this.columns) {
                if (!validColumns.includes(column)) {
                    throw new Error(`Invalid column '${column}' for table '${this.from}'`)
                }
            }
        }
        if (this.where.length > 0) {
            for (const [param, value, op] of this.where) {
                if (!this.schema.columns.includes(param)) {
                    throw new Error(`Invalid column '${param}' for table '${this.from}'`)
                }
            }
        }

        let params: Array<string | number | null> = []
        let command = ""

        switch (this.verb) {
            case "SELECT": {
                command += "SELECT"
                if (this.distinct) {
                    command += " DISTINCT"
                }
                // build columns
                const column_construct = sqlListJoin(this.columns.map(col => [col]), "columns")
                command += " " + column_construct[0]
                // no params to push since it is a column
                // build from
                command += ` FROM ${this.from}`
                // build where
                if (this.where.length > 0) {
                    const where_construct = sqlListJoin(this.where, "where")
                    command += ` WHERE ${where_construct[0]}`
                    params.push(...where_construct[1])
                }
                // build order by
                if (this.order_by.length > 0) {
                    const order_construct = sqlListJoin(this.order_by.map(([param, direction]) => [param, direction]), "order")
                    command += ` ORDER BY ${order_construct[0]} `
                    // no params to push since order by does not accept prepared arguments
                }
                // limit clause
                if (this.limit > 0) {
                    command += ` LIMIT ${this.limit}`
                }
                // end statement
                command += ";"
                break
            }
            case "INSERT": {
                command += "INSERT INTO "
                // build columns
                // add from
                command += `${this.from} `
                // add target columns
                if (this.columns[0] !== "*") {
                    // there are specific columns to insert into, not all
                    const column_construct = sqlListJoin(this.columns.map(col => [col]), "columns")
                    command += `(${column_construct[0]}) `
                    // no params to push since it is a column
                }
                // if stars are specified, then no specified columns are put

                // build values
                const value_groups: Array<string | number | null> = this.values.map(group => {
                    const group_keys = Object.keys(group)
                    // sort with this.columns order
                    const group_values = Object.values(group).toSorted((a, b) => {
                        const a_index = this.columns.indexOf(group_keys.find(key => group[key] === a) || "")
                        const b_index = this.columns.indexOf(group_keys.find(key => group[key] === b) || "")
                        return a_index - b_index
                    })
                    params.push(...group_values)
                    const placeholders = group_values.map(_ => "?").join(", ")
                    return `(${placeholders})`
                })
                // join groups
                command += `VALUES ${value_groups.join(", ")}`
                // end statement
                command += ";"
                break
            }
            case "UPDATE": {
                command += `UPDATE ${this.from} SET `
                // build set clause - pulls from values

                const set_clauses: string[] = []
                this.values.forEach(group => {
                    Object.entries(group).forEach(([param, value]) => {
                        set_clauses.push(`${param} = ?`)
                        params.push(value)
                    })
                })
                command += set_clauses.join(", ")
                // build where clause
                if (this.where.length > 0) {
                    const where_construct = sqlListJoin(this.where, "where")
                    command += ` WHERE ${where_construct[0]}`
                    params.push(...where_construct[1])
                }
                // end statement
                command += ";"
                break
            }
            case "DELETE": {
                command += `DELETE FROM ${this.from}`
                // build where clause
                if (this.where.length > 0) {
                    const where_construct = sqlListJoin(this.where, "where")
                    command += ` WHERE ${where_construct[0]}`
                    params.push(...where_construct[1])
                }
                // end statement
                command += ";"
                break
            }
            default: {
                throw new Error(`Unsupported SQL verb: ${this.verb}`)
            }
        }
        return [command, params]
    }
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