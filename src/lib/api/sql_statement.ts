/**
 * lib/api/sql_statement.ts
 *
 * The object-oriented representation of an SQL statement: clauses (WHERE, ORDER BY, LIMIT, ...) held as
 * properties and rendered to parameterized SQL on demand. Split out of sql.ts alongside
 * sql_virtual_table.ts, which evaluates one of these against an in-memory table.
 *
 * `hashIdentifier` lives here, not with the table: only this class uses it, to derive stable aliases.
 *
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

import { SQLCompareOp, sqlListJoin } from "./common.ts"
import { COMPOSER, COMPOSITION, CONTRIBUTOR } from "./d1.ts"

const textEncoder = new TextEncoder()
const FNV_64_OFFSET_BASIS = 0xcbf29ce484222325n
const FNV_64_PRIME = 0x100000001b3n
const FNV_64_MASK = 0xffffffffffffffffn

function hashIdentifier(value: string): string {
    let hash = FNV_64_OFFSET_BASIS
    const bytes = textEncoder.encode(value)
    for (const byte of bytes) {
        hash ^= BigInt(byte)
        hash = (hash * FNV_64_PRIME) & FNV_64_MASK
    }
    return hash.toString(16).padStart(16, "0")
}

/**
 * An object representing an SQL statement
 */
export class SQLStatement {
    /**
     * The D1Schema object containing the D1 binding API object and information about the table to be queried
     */
    schema: D1Schema // used for enforcement of column names
    // schema validation executes on statement finalization, not during construction or composition
    /**
     * The SQL action to take, such as SELECT, INSERT, UPDATE, or DELETE
     */
    verb: "SELECT" | "INSERT" | "UPDATE" | "DELETE" // used to specify statement, used by all
    /**
     * For SELECT statements, whether to return distinct rows
     * For non-SELECT statements, this property is ignored
     */
    distinct: boolean = false // used for SELECT
    /**
     * The columns on which to run the statement against or return
     * If left empty, the finisher will automatically insert "*"
     */
    columns: string[] = [] // used by all statements; specifies a paramName to query; used for order enforcement of UPDATE AND INSERT
    /**
     * The name of the database table
     */
    from: string | null = null // used by SELECT, UPDATE, DELETE
    /**
     * Values to insert or update for the defined statement
     */
    values: Record<string, string | null>[] = [] // used by INSERT and UPDATE; stores paramName: value pairs in groups
    /**
     * WHERE clauses limiting row output or processing
     */
    where: Array<[string, string | string[], SQLCompareOp]> = [] // used by SELECT, UPDATE, DELETE
    // where stores the following info: [paramName, value (or list of values, depending on operator), comparison operator]
    /**
     * ORDER BY clauses to order SELECT output
     */
    order_by: Array<[string, string]> = [] // used by SELECT
    // stores [paramName, direction]
    /**
     * LIMIT clause to limit SELECT output
     */
    limit: number = 0 // used by SELECT; 0 is no limit

    /**
     * @param schema A D1Schema object corresponding to the table being queried, used for validation (not performed until finishing)
     * @param verb The SQL verb (SELECT, INSERT, UPDATE, or DELETE) representing the operation to perform
     * @param from The name of the table to query, which must match the one specified in the schema
     * @param columns The columns to run the statement against; if omitted, defaults to all columns
     */
    constructor(
        schema: D1Schema,
        verb: "SELECT" | "INSERT" | "UPDATE" | "DELETE",
        from: string,
        columns: string[] = []
    ) {
        this.schema = schema
        this.verb = verb
        this.from = from
        this.columns = columns
    }

    /**
     * Converts a row from a VirtualSQLTable execution into its object representation with a type assertion into the API type
     *
     * @param stmt An SQLStatement object representing the executed statement
     * @param output The output row from statement execution
     * @returns An object representation of the output row based on the executed statement's properties, with a type assertion into the API type
     */
    static constructObject(
        stmt: SQLStatement,
        output: Array<string | number | null>
    ): Partial<D1Contributor> | Partial<D1Composer> | Partial<D1Composition> {
        // given the output of a SQL statement execution, it constructs the object representation
        const columns = stmt.columns.includes("*") ? stmt.schema.columns : stmt.columns
        const construction = SQLStatement.#_constructObjectFromColumns(stmt.schema, columns, output)
        // based on the columns, check if the object is possibly complete
        if (new Set(stmt.schema.columns).difference(new Set(columns)).size === 0) {
            // if all columns are present, then the object is complete and can be fully typed
            return construction as D1Contributor | D1Composer | D1Composition
        }
        // properties are missing, so return as partial
        return construction
    }

    /**
     * Converts a full row from a VirtualSQLTable execution into its object representation using the schema instead of an SQLStatement
     *
     * @param schema The D1Schema corresponding to the VirtualSQLTable's database definition
     * @param output The output row from statement execution, which must include all columns in the schema in the order specified by the schema
     * @returns An object representation of the output row based on the schema, with a complete type assertion into the API type
     *
     */
    static _constructObject(
        schema: D1Schema,
        output: Array<string | number | null>
    ): D1Contributor | D1Composer | D1Composition {
        // constructs an object assuming all columns are present
        const data = SQLStatement.#_constructObjectFromColumns(schema, schema.columns, output)
        // since all properties are used, the object is assumed to be complete
        switch (schema) {
            case CONTRIBUTOR:
                return data as D1Contributor
            case COMPOSER:
                return data as D1Composer
            case COMPOSITION:
                return data as D1Composition
            default:
                throw new Error(`Unsupported schema: ${schema.name}`)
        }
    }

    /**
     * Internal method used to perform object construction
     *
     * @param schema The D1Schema
     * @param columns The columns in the output, in order
     * @param output The data from VirtualSQLTable.execute
     * @returns The object representation
     */
    static #_constructObjectFromColumns(
        schema: D1Schema,
        columns: string[],
        output: Array<string | number | null>
    ): Partial<D1Contributor> | Partial<D1Composer> | Partial<D1Composition> {
        const record: Record<string, string | number | null> = {}
        for (let index = 0; index < columns.length; index++) {
            record[columns[index]] = output[index]
        }
        switch (schema) {
            case CONTRIBUTOR:
                return record as Partial<D1Contributor>
            case COMPOSER:
                return record as Partial<D1Composer>
            case COMPOSITION:
                return record as Partial<D1Composition>
            default:
                throw new Error(`Unsupported schema: ${schema.name}`)
        }
    }

    /**
     * Set the SQL verb to use
     *
     * @param verb The SQL verb to set for the statement, which must be one of SELECT, INSERT, UPDATE, or DELETE
     */
    setVerb(verb: "SELECT" | "INSERT" | "UPDATE" | "DELETE"): void {
        this.verb = verb
    }

    /**
     * Set the target table for the statement
     *
     * @param from The name of the table
     */
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
        this.columns = this.columns.filter((col) => col !== column)
    }

    setValue(index: number, param: string, value: string | number | null): void {
        if (index >= this.values.length) {
            throw new Error(`Value index ${index} out of bounds for statement values of length ${this.values.length}`)
        }
        this.values[index][param] = value === null ? null : value.toString()
    }

    addValueGroup<T extends Record<string, string | number | null>>(group: T, exclude?: string[]): void {
        const filtered: Record<string, string | null> = {}
        for (const key in group) {
            if (exclude && exclude.includes(key)) {
                continue
            }
            // undefined can leak in at runtime despite the type; store it as null instead of crashing on .toString()
            filtered[key] = group[key] === null || group[key] === undefined ? null : group[key].toString()
        }
        this.values.push(filtered)
    }

    editValue(index: number, param: string, value: string | number | null): void {
        if (index >= this.values.length) {
            throw new Error(`Value index ${index} out of bounds for statement values of length ${this.values.length}`)
        }
        if (!this.schema.columns.includes(param)) {
            throw new Error(`Invalid parameter '${param}' for table '${this.from}'`)
        }
        this.values[index][param] = value === null ? null : value.toString()
    }

    voidValue(index: number, param: string): void {
        if (index >= this.values.length) {
            throw new Error(`Value index ${index} out of bounds for statement values of length ${this.values.length}`)
        }
        this.values[index][param] = null
    }

    clearValues(): void {
        this.values = []
    }

    addWhere(param: string, value: string | string[], op: SQLCompareOp): void {
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

    /**
     * Indicates whether the statement can be run on VirtualSQLTable without querying D1
     * Currently, all SELECT statements with no order by clauses or the limit operator are deemed "simple"
     * VirtualSQLTable can perform operations using order by and limit, but this is temporarily disallowed until the execution model is verified
     *
     * Note: a false isSimple() doesn't necessarily mean a statement will fail on VirtualSQLTable, but a true isSimple() means that it will succeed
     *
     * @return Whether the SQLStatement should be executed on VirtualSQLTable instead of D1
     *
     */
    isSimple(): boolean {
        // returns if the statement is simple enough to execute virtually
        // for now, simple statements are defined as SELECT statements with no order by and no limit
        return this.verb === "SELECT" && this.order_by.length === 0 && this.limit === 0
    }
    /**
     * Useful for VirtualSQLTable; determines if the statement is expected to return all columns, which indicates if a complete type can be used
     *
     * @returns Whether the statement is expected to return all columns from the schema, which allows a non-Partial type assertion
     */
    isComplete(): boolean {
        return this.columns.includes("*") || new Set(this.schema.columns).difference(new Set(this.columns)).size === 0
    }

    /**
     * Generates an identifier for caching using the statement's properties
     *
     * @returns A string hash representing the command, or null if the statement is not cacheable
     */
    identifier(): string | null {
        // generates a string representation of the statement described to use for caching
        // structure: [table_name]:(columns)?(where)|(order_by)!{distinct_char}{limvalue}
        // the structure is then passed through a hash function to generate a compact identifier for caching
        if (this.verb !== "SELECT") {
            return null
        }
        let output = `${this.from}:`
        if (this.columns.length > 0) {
            output += this.columns.join(",") + "?"
        }
        if (this.where.length > 0) {
            output +=
                this.where
                    .map(([param, value, op]) => `${param}${op}${Array.isArray(value) ? value.join(",") : value}`)
                    .join(",") + "|"
        }
        if (this.order_by.length > 0) {
            output += this.order_by.map(([param, direction]) => `${param}${direction}`).join(",")
        }
        output += `!${this.distinct ? "D" : "N"}${this.limit !== null ? this.limit : "0"}`

        return hashIdentifier(output)
    }

    /**
     * Completes the SQLStatement by converting it into a string with parameters to use on D1PreparedStatement.bind()
     * Schema validation runs during finishing, so invalid columns will be errored here
     *
     * @returns A string containing the raw SQL command, and a list of parameters to bind;
     */
    finish(): [string, Array<string | number | null>] {
        // returns (1) a string of the SQL command, and a list of prepared arguments in order

        if (!this.from) {
            throw new Error("Missing target table for SQL statement")
        }

        // The table name is interpolated, not bound, so it must be the schema's own — the same rule the
        // column and WHERE-parameter checks below enforce. Every construction site already passes
        // schema.name; asserting it here puts the guarantee in the function instead of in the discipline
        // of its callers.
        if (this.from !== this.schema.name) {
            throw new Error(`Invalid table '${this.from}' for schema '${this.schema.name}'`)
        }

        // LIMIT is interpolated too (SQLite accepts a bound limit, but the rest of this builder treats
        // clause structure as non-parameterized), so it must be a plain non-negative integer.
        if (!Number.isSafeInteger(this.limit) || this.limit < 0) {
            throw new Error(`Invalid limit '${this.limit}' for table '${this.from}'`)
        }

        if (this.columns.length === 0) {
            this.columns.push("*")
        }

        if (this.columns.indexOf("*") !== -1 && this.columns.length > 1) {
            throw new Error("'*' cannot be used with other columns")
        }

        // validate that columns and where clauses conform to schema
        if (this.columns.length > 0 && this.columns[0] !== "*") {
            const validColumns = this.schema.columns
            for (const column of this.columns) {
                if (!validColumns.includes(column)) {
                    throw new Error(`Invalid column '${column}' for table '${this.from}'`)
                }
            }
        }
        if (this.where.length > 0) {
            for (const [param] of this.where) {
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
                const column_construct = sqlListJoin(
                    this.columns.map((col) => [col]),
                    "columns"
                )
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
                    const order_construct = sqlListJoin(
                        this.order_by.map(([param, direction]) => [param, direction]),
                        "order"
                    )
                    command += ` ORDER BY ${order_construct[0]}`
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
                command += "INSERT INTO"
                // build columns
                // add from
                command += ` ${this.from}`
                // add target columns
                if (this.columns[0] !== "*") {
                    // there are specific columns to insert into, not all
                    const column_construct = sqlListJoin(
                        this.columns.map((col) => [col]),
                        "columns"
                    )
                    command += ` (${column_construct[0]})`
                    // no params to push since it is a column
                }
                // if stars are specified, then no specified columns are put

                // build values
                if (this.values.length === 0) {
                    throw new Error("INSERT statement requires at least one value group")
                }
                const sort_columns = this.columns[0] === "*" ? this.schema.columns : this.columns
                const value_groups: Array<string> = this.values.map((group) => {
                    // Build values in the deterministic order of `sort_columns`.
                    // If a column is missing from the group, use null so placeholder count matches columns.
                    const group_values = sort_columns.map((col) => (col in group ? group[col] : null))
                    params.push(...group_values)
                    const placeholders = group_values.map((_) => "?").join(", ")
                    return `(${placeholders})`
                })
                // join groups
                command += ` VALUES ${value_groups.join(", ")}`
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
            case "UPDATE": {
                command += `UPDATE ${this.from} SET `
                // build set clause - pulls from values

                const set_clauses: string[] = []
                this.values.forEach((group) => {
                    Object.entries(group).forEach(([param, value]) => {
                        // the SET column name is interpolated, not bound, so it must be a known schema
                        // column (the SELECT column list and WHERE params above are validated the same way)
                        if (!this.schema.columns.includes(param)) {
                            throw new Error(`Invalid column '${param}' for table '${this.from}'`)
                        }
                        set_clauses.push(`${param} = ?`)
                        params.push(value)
                    })
                })
                if (set_clauses.length === 0) {
                    throw new Error("UPDATE statement requires at least one value to set")
                }
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
