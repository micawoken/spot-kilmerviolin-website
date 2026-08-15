/**
 * lib/api/sql_virtual_table.ts
 *
 * A SQL execution engine working in memory
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

import { SQLCompareOp } from "./common.ts"
import { SQLStatement } from "./sql_statement.ts"

/**
 * Given a D1 schema and the full database value, this object
 * represents the full SQL table
 *
 * Commands on the table are executed either using the index query functions or by
 * supplying a SQLStatement object
 */
export class VirtualSQLTable {
    /**
     * The schema of the specified table, imported from lib/api/d1.ts and supplied at initialization
     * Used for enforcement of column names and construction of SQL statements
     */
    schema: D1Schema
    /**
     * The database contents, pulled from D1, KV, or cache and supplied at initialization
     * Represented as an array of rows, where row indices correspond with columns in order
     *
     * It is assumed that all columns in the row are present and in the schema column order
     */
    database: Record<string, string | number | null>[]
    /**
     * @param schema The D1 schema corresponding to the table
     * @param database The full database contents, represented as an array of rows, where row indices correspond with columns in order. It is assumed that all columns in the row are present and in the schema column order
     */
    constructor(schema: D1Schema, database: Record<string, string | number | null>[]) {
        this.schema = schema
        this.database = database
    }

    /**
     * Given a schema, a database, and desired columns, it reduces the database horizontally to the specified columns in the column order
     *
     * @param schema The D1 schema corresponding to the table, used for column name enforcement and order
     * @param database The full database contents, represented as an array of rows, where row indices correspond with columns in order. It is assumed that all columns in the row are present and in the schema column order
     * @param columns The columns to constrain to, which must be present in the schema. The order of columns determines the order of values in the output database
     * @returns A new database only including the columns specified in the columns parameter, with enforcement from schema
     */
    static constrain(
        schema: D1Schema,
        database: Record<string, string | number | null>[],
        columns: string[]
    ): Record<string, string | number | null>[] {
        // returns a new database only including the columns specified in the columns parameter, with enforcement from schema

        // edge case - return if database is empty
        if (database.length === 0) {
            return []
        }

        // edge case - if columns includes * or all columns, return as-is
        if (columns.includes("*") || new Set(schema.columns).difference(new Set(columns)).size === 0) {
            return database
        }

        // validate that all specified columns exist in schema
        if (new Set(columns).difference(new Set(schema.columns)).size !== 0) {
            throw new Error(
                `Columns not defined in schema: ${columns.filter((col) => !schema.columns.includes(col)).join(", ")}`
            )
        }

        // determine the shape of the first object, since there is at least one
        const keys = Object.keys(database[0])

        // columns are validated, go through each row and only extract the columns specified
        // if a column specified does not exist,
        return database.map((row) => {
            // validate the shape matches the first object
            if (new Set(Object.keys(row)).difference(new Set(keys)).size !== 0) {
                throw new Error(`Inconsistent row shape in database: ${JSON.stringify(row)}`)
            }
            // shape is consistent, perform constrain by creating a new object with a subset of the keys based on columns

            return Object.keys(row).reduce((acc, key) => {
                if (columns.includes(key)) {
                    acc[key] = row[key]
                }
                return acc
            }, Object()) as Record<string, string | number | null>
        })
    }
    /**
     * Given a schema, a database, and a where clause, it reduces the database vertically to rows matching the where clause
     *
     * @param schema The D1 schema corresponding to the table, used for column name enforcement and order
     * @param database The full database contents, represented as an array of rows, where row indices correspond with columns in order. It is assumed that all columns in the row are present and in the schema column order
     * @param param The column name to apply the where clause to, which must be present in the schema
     * @param value The value to compare against
     * @param op The comparison operator, a member of the SQLCompareOp enum
     * @returns A new database only including rows that match the where clause
     */
    static where(
        schema: D1Schema,
        database: Record<string, string | number | null>[],
        param: string,
        value: string | string[] | number | number[] | null,
        op: SQLCompareOp
    ): Record<string, string | number | null>[] {
        // returns a new database where a given where clause has been executed
        if (!schema.columns.includes(param)) {
            throw new Error(`Column '${param}' is not in schema`)
        }
        let output: Record<string, string | number | null>[] = []
        for (const row of database) {
            const cell = row[param]
            switch (op) {
                case SQLCompareOp.EQ:
                    if (cell === value) {
                        output.push(row)
                    }
                    continue
                case SQLCompareOp.NEQ:
                    if (cell !== value) {
                        output.push(row)
                    }
                    continue
                case SQLCompareOp.LT:
                    if (typeof cell !== "number" || typeof value !== "number") {
                        throw new Error(`LT operator requires numeric values`)
                    }
                    if (cell < value) {
                        output.push(row)
                    }
                    continue
                case SQLCompareOp.LTE:
                    if (typeof cell !== "number" || typeof value !== "number") {
                        throw new Error(`LTE operator requires numeric values`)
                    }
                    if (cell <= value) {
                        output.push(row)
                    }
                    continue
                case SQLCompareOp.GT:
                    if (typeof cell !== "number" || typeof value !== "number") {
                        throw new Error(`GT operator requires numeric values`)
                    }
                    if (cell > value) {
                        output.push(row)
                    }
                    continue
                case SQLCompareOp.GTE:
                    if (typeof cell !== "number" || typeof value !== "number") {
                        throw new Error(`GTE operator requires numeric values`)
                    }
                    if (cell >= value) {
                        output.push(row)
                    }
                    continue
                case SQLCompareOp.IN:
                    if (!Array.isArray(value)) {
                        throw new Error(`IN operator requires an array of values`)
                    }
                    if (cell === null) {
                        continue
                    }
                    if ((value as Array<string | number>).includes(cell as string | number)) {
                        output.push(row)
                    }
                    continue
                case SQLCompareOp.NOT_IN:
                    if (!Array.isArray(value)) {
                        throw new Error(`NOT_IN operator requires an array of values`)
                    }
                    if (!(value as Array<string | number>).includes(cell as string | number)) {
                        output.push(row)
                    }
                    continue
                case SQLCompareOp.LIKE:
                    if (typeof cell !== "string" || typeof value !== "string") {
                        throw new Error(`LIKE operator requires string values`)
                    }
                    // Convert the SQL LIKE pattern to a regular expression
                    const regex_like = sqlLikeToRegex(value)
                    if (regex_like.test(cell)) {
                        output.push(row)
                    }
                    continue
                case SQLCompareOp.NOT_LIKE:
                    if (typeof cell !== "string" || typeof value !== "string") {
                        throw new Error(`NOT_LIKE operator requires string values`)
                    }
                    // Convert the SQL NOT LIKE pattern to a regular expression
                    const regex_not_like = sqlLikeToRegex(value)
                    if (!regex_not_like.test(cell)) {
                        output.push(row)
                    }
                    continue
                case SQLCompareOp.BETWEEN:
                    if (!Array.isArray(value) || value.length !== 2) {
                        throw new Error(`BETWEEN operator requires an array of two values`)
                    }
                    if (typeof cell !== "number" || typeof value[0] !== "number" || typeof value[1] !== "number") {
                        throw new Error(`BETWEEN operator requires numeric values`)
                    }
                    if (cell >= value[0] && cell <= value[1]) {
                        output.push(row)
                    }
                    continue
                case SQLCompareOp.NOT_BETWEEN:
                    if (!Array.isArray(value) || value.length !== 2) {
                        throw new Error(`NOT_BETWEEN operator requires an array of two values`)
                    }
                    if (typeof cell !== "number" || typeof value[0] !== "number" || typeof value[1] !== "number") {
                        throw new Error(`NOT_BETWEEN operator requires numeric values`)
                    }
                    if (cell < value[0] || cell > value[1]) {
                        output.push(row)
                    }
                    continue
                default:
                    throw new Error(`Unsupported comparison operator: ${op}`)
            }
        }
        return output
    }

    /**
     * Performs a comparison between two rows based on the order by clauses
     * Intended for use in an Array.sort() or Array.toSorted() call as it returns the <0, 0, and >0 values expected
     *
     * @param stmt The SQLStatement object containing the order by clauses to sort by
     * @param row_a The first row to compare (need not be complete, but should)
     * @param row_b The second row to compare (need not be complete, but should)
     * @return A number; if less than 0, A before B; if more than 0, B before A; if 0, order is equivalent
     *
     */
    static sortFunc(
        stmt: SQLStatement,
        row_a: Record<string, string | number | null>,
        row_b: Record<string, string | number | null>
    ): number {
        // executes the order by clauses sequentially until a non-equal comparison is found
        // supplied rows span the entire table, so we'll use the schema columns, which are ordered
        for (const [param, direction] of stmt.order_by) {
            if (!stmt.schema.columns.includes(param)) {
                throw new Error(`Column '${param}' is not in schema`)
            }
            const cell_a = row_a[param]
            const cell_b = row_b[param]
            if (typeof cell_a === "number" && typeof cell_b === "number") {
                if (cell_a < cell_b) {
                    return direction === "ASC" ? -1 : 1
                } else if (cell_a > cell_b) {
                    return direction === "ASC" ? 1 : -1
                }
                // if equal, continue to next statement
            } else if (typeof cell_a === "string" && typeof cell_b === "string") {
                if (cell_a < cell_b) {
                    return direction === "ASC" ? -1 : 1
                } else if (cell_a > cell_b) {
                    return direction === "ASC" ? 1 : -1
                }
            } else if (cell_a === null && cell_b !== null) {
                return direction === "ASC" ? -1 : 1
            } else if (cell_a !== null && cell_b === null) {
                return direction === "ASC" ? 1 : -1
            } else if (typeof cell_a !== typeof cell_b) {
                throw new Error(`Cannot compare values of different types: '${cell_a}' and '${cell_b}'`)
            }
        }
        return 0 // all order by clauses resulted in equality
    }

    /**
     * Performs type conversion for use in where clauses (since SQLStatement.where stores them as strings or string arrays)
     * Conversion requires a type hint be declared in the schema
     *
     * @param schema the D1 schema to fetch the type hint form
     * @param where_clause a SQLStatement where clause
     * @return the type-converted value
     */
    static valueConvert(
        schema: D1Schema,
        where_clause: [string, string | string[], SQLCompareOp]
    ): string | string[] | number | number[] | null {
        // converts value types from strings to functional types
        const [param, value] = where_clause
        const type_hint = param in schema.type_hint ? schema.type_hint[param] : null

        // TODO implement null check
        if (value === "null") {
            return null
            // the where clause type spec indicates that the type is a string or an array of strings,
            // so checking for actual null is not appropriate
            // an empty string is a legitimate value for string columns (and matches D1 semantics), so it is not treated as null
        }

        switch (type_hint) {
            case "number":
                if (Array.isArray(value)) {
                    return value.map((v) => (typeof v === "string" ? parseInt(v, 10) : v))
                } else {
                    return parseInt(value, 10)
                }
            case "string":
                return value
            case "null":
                return null
            default:
                throw new Error(`Unsupported type hint '${type_hint}' for parameter '${param}'`)
        }
    }

    /**
     * Looks up a row by an indexed column; returns the matching row (only one since an index is used) or no result ([])
     *
     * @param param The column name to query, which must be declared as an index in the schema
     * @param value The value to search for in the indexed column
     * @returns The matching row, or null if no match is found
     */
    getRowByIndexed(param: string, value: string | number): Record<string, string | number | null> | null {
        // returns one row, or a null result, from a column marked as an index
        if (!this.schema.index.includes(param)) {
            throw new Error(`Column '${param}' is not indexed, so indexed queries are not supported on this column`)
        }
        for (const row of this.database) {
            if (row[param] === value) {
                return row
            }
        }
        return null
    }

    /**
     * Executes a provided SQLStatement object against the database
     * The SQLStatement object is an object-oriented representation of an SQL statement, containing clauses such as WHERE and ORDER BY as properties
     * These properties are used to filter and constrain the VirtualSQLTable's database to the desired output
     *
     * @param stmt The SQLStatement object representing the desired SQL query to execute against the database
     * @returns The resulting database after executing the SQLStatement, represented as an array of rows
     */
    execute(stmt: SQLStatement): Record<string, string | number | null>[] {
        // first, verify that the statement is supported by the schema
        if (stmt.from !== this.schema.name) {
            throw new Error(
                `Statement references table '${stmt.from}' but this VirtualSQLTable is for table '${this.schema.name}'`
            )
        }
        // verify the statement is select
        if (stmt.verb !== "SELECT") {
            throw new Error(`Only SELECT statements are supported by VirtualSQLTable.execute()`)
        }
        // statement is valid for table
        // first, execute the where clauses to filter
        let remaining = this.database
        for (const [param, value, op] of stmt.where) {
            if (!remaining.length) {
                break
            }
            remaining = VirtualSQLTable.where(
                this.schema,
                remaining,
                param,
                VirtualSQLTable.valueConvert(this.schema, [param, value, op]),
                op
            )
        }
        if (!remaining.length) {
            return []
        }
        // execute order by
        remaining.sort((row_a, row_b) => VirtualSQLTable.sortFunc(stmt, row_a, row_b))
        // execute columns
        const use_schema = stmt.columns.length === 0 || stmt.columns[0] === "*"
        remaining = VirtualSQLTable.constrain(this.schema, remaining, use_schema ? this.schema.columns : stmt.columns)
        // execute distinct
        if (stmt.distinct) {
            let exists: string[] = []
            remaining = remaining.filter((row) => {
                const key = JSON.stringify(row)
                if (exists.includes(key)) {
                    return false
                } else {
                    exists.push(key)
                    return true
                }
            })
        }
        // execute limit
        if (stmt.limit > 0) {
            remaining = remaining.slice(0, stmt.limit)
        }
        return remaining
    }
}

/**
 * Converts a SQL LIKE pattern to a regular expression, with support for % and _ wildcards and an optional escape character
 *
 * @param pattern The SQL LIKE pattern to convert
 * @param caseInsensitive Whether the resulting regular expression should be case insensitive (default: true)
 * @param escapeChar The character used to escape wildcard characters in the pattern (default: '\')
 *
 * @returns A RegExp object representing the equivalent regular expression for the given SQL LIKE pattern
 */
function sqlLikeToRegex(pattern: string, caseInsensitive = true, escapeChar = "\\"): RegExp {
    // escapeChar needs to be a single character to operate in the tokenizer correctly
    if ([...escapeChar].length !== 1) {
        throw new Error("escapeChar must be a single character")
    }
    // convert the escape character to a RegEx safe form
    const esc = escapeRegexChar(escapeChar)
    /**
     * the tokenizer runs through the body of the pattern to identify special characters
     * it identifies:
     * 1. escaped characters (capture group 1) - these are run through the escape function to remove any special meaning
     * 2. trailing escape characters (capture group 2) - strings terminating with the escape character are treated literally
     *    NOTE: the first $ symbol is a JS template literal, not a RegEx end of string symbol
     * 3. percent symbols (capture group 3) - these are converted to the .* RegEx wildcard
     * 4. underscore symbols (capture group 4) - these are converted to the . RegEx wildcard
     * 5. all other characters (capture group 5) - these are run through the escape function to remove any special meaning
     *
     * The order of the capture groups and execution logic is done to make sure that operator precedence is correct (escaped characters first, then wildcards, then literals))
     * (note: the _ variable in pattern.replace references the total match, a feature of the String.replace function, but it is not useful to the tokenizer)
     */
    const tokenizer = new RegExp(`${esc}([\\s\\S])|(${esc}$)|(%)|(_)|([\\s\\S])`, "g")
    const body = pattern.replace(tokenizer, (_, escaped, trailingEsc, percent, under, literal) => {
        if (escaped !== undefined) return escapeRegexChar(escaped)
        if (trailingEsc !== undefined) return escapeRegexChar(escapeChar)
        if (percent !== undefined) return ".*"
        if (under !== undefined) return "."
        return escapeRegexChar(literal)
    })

    return new RegExp(`^${body}$`, caseInsensitive ? "siu" : "su")
}

/**
 * Escapes characters present in the SQL LIKE operator that are treated as special in RegEx
 *
 * @param str The character to process
 * @return The processed output
 */
function escapeRegexChar(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
