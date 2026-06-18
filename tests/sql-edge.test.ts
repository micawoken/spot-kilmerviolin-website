/// <reference path="../src/lib/api/types.d.ts" />

/**
 * Tests edge cases in the SQL statement layer (sql.ts and the SQL helpers in common.ts)
 * that previously generated invalid SQL or crashed at runtime
 */

import { describe, it, expect } from "vitest"

import { SQLStatement, VirtualSQLTable } from "../src/lib/api/sql.ts"
import { CONTRIBUTOR, COMPOSER } from "../src/lib/api/d1.ts"
import { SQLCompareOp, sqlPrepOp } from "../src/lib/api/common.ts"

describe("SQLStatement.finish guards", () => {
    it("throws on UPDATE with no values to set instead of emitting invalid SQL", () => {
        const stmt = new SQLStatement(CONTRIBUTOR, "UPDATE", "contributors")
        stmt.addWhere("contributor_id", "5", SQLCompareOp.EQ)
        expect(() => stmt.finish()).toThrow(/at least one value/)
    })

    it("throws on INSERT with no value groups instead of emitting invalid SQL", () => {
        const stmt = new SQLStatement(CONTRIBUTOR, "INSERT", "contributors")
        expect(() => stmt.finish()).toThrow(/at least one value group/)
    })

    it("throws on IN with an empty value list instead of emitting 'IN ()'", () => {
        const stmt = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors")
        stmt.addWhere("contributor_id", [], SQLCompareOp.IN)
        expect(() => stmt.finish()).toThrow(/non-empty array/)
    })

    it("allows an empty string as a WHERE comparison value", () => {
        const stmt = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors")
        stmt.addWhere("bio", "", SQLCompareOp.EQ)
        const expected = ["SELECT * FROM contributors WHERE bio = ?;", [""]]
        expect(stmt.finish()).toEqual(expected)
    })

    it("orders full-table INSERT parameters by schema column order and fills missing columns with null", () => {
        const stmt = new SQLStatement(COMPOSER, "INSERT", "composers")
        // keys provided out of schema order, and several columns omitted entirely
        stmt.addValueGroup({ birth_year: 1900, name: "Test Person", country: "Nowhere" })
        const [command, params] = stmt.finish()
        expect(command).toBe("INSERT INTO composers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);")
        // schema order: composer_id, name, role, birth_year, death_year, country, bio, image, tags, entry_date, change_date
        expect(params).toEqual([null, "Test Person", null, "1900", null, "Nowhere", null, null, null, null, null])
    })

    it("rejects columns that are not part of the schema", () => {
        const stmt = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors", ["not_a_column"])
        expect(() => stmt.finish()).toThrow(/Invalid column/)
    })
})

describe("SQLStatement.addValueGroup", () => {
    it("stores undefined values as null instead of crashing on toString", () => {
        const stmt = new SQLStatement(COMPOSER, "UPDATE", "composers")
        // undefined sneaks past the type system in practice (e.g., optional rating members)
        expect(() => stmt.addValueGroup({ bio: undefined as unknown as string | null, name: "A" })).not.toThrow()
        stmt.addWhere("composer_id", "1", SQLCompareOp.EQ)
        const [command, params] = stmt.finish()
        expect(command).toBe("UPDATE composers SET bio = ?, name = ? WHERE composer_id = ?;")
        expect(params).toEqual([null, "A", "1"])
    })
})

describe("SQLStatement.identifier", () => {
    it("returns null for non-SELECT statements", () => {
        const stmt = new SQLStatement(CONTRIBUTOR, "DELETE", "contributors")
        stmt.addWhere("contributor_id", "1", SQLCompareOp.EQ)
        expect(stmt.identifier()).toBeNull()
    })

    it("is stable for identical statements and distinct for different statements", () => {
        const a = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors")
        a.addWhere("name", "John", SQLCompareOp.EQ)
        const b = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors")
        b.addWhere("name", "John", SQLCompareOp.EQ)
        const c = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors")
        c.addWhere("name", "Jane", SQLCompareOp.EQ)
        expect(a.identifier()).toBe(b.identifier())
        expect(a.identifier()).not.toBe(c.identifier())
    })
})

describe("VirtualSQLTable.valueConvert", () => {
    it("preserves empty strings for string-typed columns (matches D1 semantics)", () => {
        expect(VirtualSQLTable.valueConvert(CONTRIBUTOR, ["bio", "", SQLCompareOp.EQ])).toBe("")
    })

    it("converts the literal 'null' to null", () => {
        expect(VirtualSQLTable.valueConvert(CONTRIBUTOR, ["bio", "null", SQLCompareOp.EQ])).toBeNull()
    })

    it("converts number-typed values and arrays via the schema type hint", () => {
        expect(VirtualSQLTable.valueConvert(CONTRIBUTOR, ["contributor_id", "5", SQLCompareOp.EQ])).toBe(5)
        expect(VirtualSQLTable.valueConvert(CONTRIBUTOR, ["contributor_id", ["5", "6"], SQLCompareOp.IN])).toEqual([5, 6])
    })
})

describe("VirtualSQLTable execution against typed cells", () => {
    const rows: Record<string, string | number | null>[] = [
        { contributor_id: 1, name: "Empty Bio", class_year: 2000, major: "Music", phases: "1", bio: "", public_email: "a@x.com", identity_email: "a@id.com", active: 1, roles: "", admin: 0, image: null, tags: "", entry_date: "2024-01-01T00:00:00Z" },
        { contributor_id: 2, name: "Has Bio", class_year: 2001, major: "Music", phases: "1", bio: "hello", public_email: "b@x.com", identity_email: "b@id.com", active: 1, roles: "", admin: 0, image: null, tags: "", entry_date: "2024-01-01T00:00:00Z" }
    ]
    const table = new VirtualSQLTable(CONTRIBUTOR, rows)

    it("matches numeric primary keys queried with string values (the _getPrimitive path)", () => {
        const stmt = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors")
        stmt.addWhere("contributor_id", "2", SQLCompareOp.EQ)
        const result = table.execute(stmt)
        expect(result.length).toBe(1)
        expect(result[0].name).toBe("Has Bio")
    })

    it("matches empty-string cells when comparing against an empty string", () => {
        const stmt = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors")
        stmt.addWhere("bio", "", SQLCompareOp.EQ)
        const result = table.execute(stmt)
        expect(result.length).toBe(1)
        expect(result[0].name).toBe("Empty Bio")
    })

    it("supports LIKE wildcards", () => {
        const stmt = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors")
        stmt.addWhere("name", "%bio", SQLCompareOp.LIKE)
        const result = table.execute(stmt)
        expect(result.map(row => row.contributor_id)).toEqual([1, 2])
    })
})

describe("sqlPrepOp", () => {
    it("throws for empty IN lists", () => {
        expect(() => sqlPrepOp(["contributor_id", [], SQLCompareOp.IN])).toThrow(/non-empty array/)
    })

    it("builds BETWEEN with two parameters", () => {
        expect(sqlPrepOp(["class_year", ["2000", "2005"], SQLCompareOp.BETWEEN])).toEqual(["class_year BETWEEN ? AND ?", ["2000", "2005"]])
    })
})
