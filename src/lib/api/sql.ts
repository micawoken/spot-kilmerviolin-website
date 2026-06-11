/**
 * lib/api/sql.ts
 * 
 * Implements an object representing a SQL statement and an object representing a SQL database
 * 
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
    constructor(schema: D1Schema, verb: "SELECT" | "INSERT" | "UPDATE" | "DELETE", from: string, columns: string[] = []) {
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
    static constructObject(stmt: SQLStatement, output: Array<string | number | null>): (Partial<D1Contributor> | Partial<D1Composer> | Partial<D1Composition>) {
        // given the output of a SQL statement execution, it constructs the object representation
        const columns = stmt.columns.includes("*") ? stmt.schema.columns : stmt.columns
        const construction = SQLStatement.#_constructObjectFromColumns(stmt.schema, columns, output)
        // based on the columns, check if the object is possibly complete
        if (new Set(stmt.schema.columns).difference(new Set(columns)).size === 0) {
            // if all columns are present, then the object is complete and can be fully typed
            return construction as (D1Contributor | D1Composer | D1Composition)
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
    static _constructObject(schema: D1Schema, output: Array<string | number | null>): (D1Contributor | D1Composer | D1Composition) {
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
    static #_constructObjectFromColumns(schema: D1Schema, columns: string[], output: Array<string | number | null>): (Partial<D1Contributor> | Partial<D1Composer> | Partial<D1Composition>) {
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
        this.columns = this.columns.filter(col => col !== column)
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
            filtered[key] = group[key] === null ? null : group[key].toString()
        }
        this.values.push(filtered)
    }

    editValue(index: number, param: string, value: string | number | null): void {
        if (index >= this.values.length) {
            throw new Error(`Value index ${index} out of bounds for statement values of length ${this.values.length}`)
        }
        console.log(this.schema.columns)
        if (!(this.schema.columns.includes(param))) {
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
            output += this.where.map(([param, value, op]) => `${param}${op}${Array.isArray(value) ? value.join(",") : value}`).join(",") + "|"
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
            // it could be assumed from schema.name, but it is not for now
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
                    const column_construct = sqlListJoin(this.columns.map(col => [col]), "columns")
                    command += ` (${column_construct[0]})`
                    // no params to push since it is a column
                }
                // if stars are specified, then no specified columns are put

                // build values
                const sort_columns = this.columns[0] === "*" ? this.schema.columns : this.columns
                const value_groups: Array<string> = this.values.map(group => {
                    // Build values in the deterministic order of `sort_columns`.
                    // If a column is missing from the group, use null so placeholder count matches columns.
                    const group_values = sort_columns.map(col => (col in group ? group[col] : null))
                    params.push(...group_values)
                    const placeholders = group_values.map(_ => "?").join(", ")
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
    static constrain(schema: D1Schema, database: Record<string, string | number | null>[], columns: string[]): Record<string, string | number | null>[] {
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
            throw new Error(`Columns not defined in schema: ${columns.filter(col => !schema.columns.includes(col)).join(", ")}`)
        }

        // determine the shape of the first object, since there is at least one
        const keys = Object.keys(database[0])

        // columns are validated, go through each row and only extract the columns specified
        // if a column specified does not exist, 
        return database.map(row => {
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
    static where(schema: D1Schema, database: Record<string, string | number | null>[], param: string, value: string | string[] | number | number[] | null, op: SQLCompareOp): Record<string, string | number | null>[] {
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
    static sortFunc(stmt: SQLStatement, row_a: Record<string, string | number | null>, row_b: Record<string, string | number | null>): number {
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
    static valueConvert(schema: D1Schema, where_clause: [string, string | string[], SQLCompareOp]): string | string[] | number | number[] | null {
        // converts value types from strings to functional types
        const [param, value, op] = where_clause
        const type_hint = param in schema.type_hint ? schema.type_hint[param] : null

        // TODO implement null check
        if (value === "null" || value === "") {
            return null
            // the where clause type spec indicates that the type is a string or an array of strings,
            // so checking for actual null is not appropriate
        }

        switch (type_hint) {
            case "number":
                if (Array.isArray(value)) {
                    return value.map(v => typeof v === "string" ? parseInt(v) : v)
                } else {
                    return parseInt(value)
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
            throw new Error(`Statement references table '${stmt.from}' but this VirtualSQLTable is for table '${this.schema.name}'`)
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
            remaining = VirtualSQLTable.where(this.schema, remaining, param, VirtualSQLTable.valueConvert(this.schema, [param, value, op]), op)
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
            remaining = remaining.filter(row => {
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
        throw new Error("escapeChar must be a single character");
    }
    // convert the escape character to a RegEx safe form
    const esc = escapeRegexChar(escapeChar);
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
    const tokenizer = new RegExp(`${esc}([\\s\\S])|(${esc}$)|(%)|(_)|([\\s\\S])`, "g");
    const body = pattern.replace(
        tokenizer,
        (_, escaped, trailingEsc, percent, under, literal) => {
            if (escaped     !== undefined) return escapeRegexChar(escaped);
            if (trailingEsc !== undefined) return escapeRegexChar(escapeChar);
            if (percent     !== undefined) return ".*";
            if (under       !== undefined) return ".";
            return escapeRegexChar(literal);
        }
    );

    return new RegExp(`^${body}$`, caseInsensitive ? "siu" : "su");
}

/**
 * Escapes characters present in the SQL LIKE operator that are treated as special in RegEx
 * 
 * @param str The character to process
 * @return The processed output
 */
function escapeRegexChar(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Converts a regex pattern to SQL LIKE for use in search
 *
 * @param {RegExp} regex The RegExp to convert to SQL LIKE
 * @param {string} escapeChar The escape character to use for special SQL LIKE characters (default: '\')
 *
 * @returns {string} A SQL LIKE pattern string
 * @throws if escapeChar is not a single character
 */
export function regexToSqlLike(regex: RegExp, escapeChar: string = "\\"): string {
    if ([...escapeChar].length !== 1) {
        throw new Error("escapeChar must be a single character");
    }

    let source = regex.source;

    const leadingPercent  = source.startsWith("^") ? (source = source.slice(1),  false) : true;
    const trailingPercent = source.endsWith("$")   ? (source = source.slice(0,-1), false) : true;

    /**
     * The tokenizer walks the regex body and identifies, in priority order:
     * 1. `.*`       (full match ".*")       → SQL % wildcard
     * 2. `.`        (full match ".")        → SQL _ wildcard
     * 3. `\X`       (capture group 1 = X)  → literal char X, SQL-escaped if needed
     * 4. Any char   (capture group 2)       → literal char,   SQL-escaped if needed
     *
     */
    const tokenizer = /\.\*|\.|\\([\s\S])|([\s\S])/g;

    let result = "";
    for (const [full, escapedChar, literal] of source.matchAll(tokenizer)) {
        if (full === ".*") {
            result += "%";
        } else if (full === ".") {
            result += "_";
        } else if (escapedChar !== undefined) {
            // Regex-escaped literal — strip the backslash and SQL-escape if needed
            result += escapeSqlLikeChar(escapedChar, escapeChar);
        } else {
            // Plain literal character
            result += escapeSqlLikeChar(literal, escapeChar);
        }
    }

    if (leadingPercent && !result.startsWith("%"))  result = "%" + result;
    if (trailingPercent && !result.endsWith("%")) result = result + "%";

    return result;
}

/**
 * Escapes characters with special meaning in SQL LIKE
 *
 * @param {string} char The character to review
 * @param {string} escapeChar The escape character
 *
 * @returns {string} the processed character
 */
function escapeSqlLikeChar(char: string, escapeChar: string): string {
    if (char === "%" || char === "_" || char === escapeChar) {
        return escapeChar + char;
    }
    return char;
}