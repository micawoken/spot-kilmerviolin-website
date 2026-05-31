import { it, expect } from "vitest"

import { SQLStatement, VirtualSQLTable } from '../lib/api/sql.ts'
import { CONTRIBUTOR, COMPOSER, COMPOSITION } from '../lib/api/d1.ts'
import { SQLCompareOp } from '../lib/api/common.ts'


// TESTING the SQLStatement object to make sure it generates the SQL commands correctly
const contrib_select_all: SQLStatement = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors")
const composer_select_all: SQLStatement = new SQLStatement(COMPOSER, "SELECT", "composers")
const composition_select_all: SQLStatement = new SQLStatement(COMPOSITION, "SELECT", "compositions")

it('SQLStatement generates correct SQL for select alls', () => {
    const contrib_expected = ["SELECT * FROM contributors;", []]
    expect(contrib_select_all.finish()).toEqual(contrib_expected)

    const composer_expected = ["SELECT * FROM composers;", []]
    expect(composer_select_all.finish()).toEqual(composer_expected)

    const composition_expected = ["SELECT * FROM compositions;", []]
    expect(composition_select_all.finish()).toEqual(composition_expected)
})

const contrib_select_where_single: SQLStatement = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors")
contrib_select_where_single.addWhere("contributor_id", "5", SQLCompareOp.EQ)

const contrib_select_where_multiple: SQLStatement = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors")
contrib_select_where_multiple.addWhere("contributor_id", ["6", "7"], SQLCompareOp.IN)
contrib_select_where_multiple.addWhere("name", "John Doe", SQLCompareOp.EQ)

it('SQLStatement generates correct SQL for select with where clauses', () => {
    const single_expected = ["SELECT * FROM contributors WHERE contributor_id = ?;", ["5"]]
    expect(contrib_select_where_single.finish()).toEqual(single_expected)

    const multiple_expected = ["SELECT * FROM contributors WHERE contributor_id IN (?, ?) AND name = ?;", ["6", "7", "John Doe"]]
    expect(contrib_select_where_multiple.finish()).toEqual(multiple_expected)
})

const composer_select_order_by: SQLStatement = new SQLStatement(COMPOSER, "SELECT", "composers")
composer_select_order_by.addOrderBy("name", "ASC")

it('SQLStatement generates correct SQL for select with order by', () => {
    const expected = ["SELECT * FROM composers ORDER BY name ASC;", []]
    expect(composer_select_order_by.finish()).toEqual(expected)
})

const composer_select_some_columns: SQLStatement = new SQLStatement(COMPOSER, "SELECT", "composers", ["name", "birth_year"])

it('SQLStatement generates correct SQL for select with some columns', () => {
    const expected = ["SELECT name, birth_year FROM composers;", []]
    expect(composer_select_some_columns.finish()).toEqual(expected)
})

const contributor_update: SQLStatement = new SQLStatement(CONTRIBUTOR, "UPDATE", "contributors")
contributor_update.addValueGroup({name: "Jane Doe", major: "Music"})
contributor_update.addWhere("contributor_id", "5", SQLCompareOp.EQ)

it('SQLStatement generates correct SQL for update', () => {
    const expected = ["UPDATE contributors SET name = ?, major = ? WHERE contributor_id = ?;", ["Jane Doe", "Music", "5"]]
    expect(contributor_update.finish()).toEqual(expected)
})

const composition_insert: SQLStatement = new SQLStatement(COMPOSITION, "INSERT", "compositions", ["name", "composer_id", "publish_year"])
composition_insert.addValueGroup({name: "Symphony No. 5", composer_id: "1", publish_year: "1808"})
composition_insert.addWhere("composition_id", "10", SQLCompareOp.EQ)

it('SQLStatement generates correct SQL for insert', () => {
    const expected = ["INSERT INTO compositions (name, composer_id, publish_year) VALUES (?, ?, ?) WHERE composition_id = ?;", ["Symphony No. 5", "1", "1808", "10"]]
    expect(composition_insert.finish()).toEqual(expected)
})

const contributor_delete: SQLStatement = new SQLStatement(CONTRIBUTOR, "DELETE", "contributors")
contributor_delete.addWhere("contributor_id", "5", SQLCompareOp.EQ)

it('SQLStatement generates correct SQL for delete', () => {
    const expected = ["DELETE FROM contributors WHERE contributor_id = ?;", ["5"]]
    expect(contributor_delete.finish()).toEqual(expected)
})

const composer_select_distinct_limit: SQLStatement = new SQLStatement(COMPOSER, "SELECT", "composers", ["name"])
composer_select_distinct_limit.distinct = true
composer_select_distinct_limit.setLimit(10)

it('SQLStatement generates correct SQL for select with distinct and limit', () => {
    const expected = ["SELECT DISTINCT name FROM composers LIMIT 10;", []]
    expect(composer_select_distinct_limit.finish()).toEqual(expected)
})

// TESTING the VirtualSQLTable

// columns: ["contributor_id", "name", "class_year", "major", "phases", "bio", "public_email", "identity_email", "active", "roles", "admin", "image"]
const test_contributor_data: Record<string, string | number | null>[] = [
    {contributor_id: 1, name: "Niche Apples", class_year: 1999, major: "Cosmic Geology", phases: "1,2,3", bio: "Bio oh my", public_email: "test@example.com", identity_email: "auth@example.com", active: 1, roles: "", admin: 0, image: null},
    {contributor_id: 2, name: "John Doe", class_year: 2000, major: "Computer Science", phases: "2,3", bio: "Bio here", public_email: "john@example.com", identity_email: "auth2@example.com", active: 1, roles: "", admin: 0, image: null},
    {contributor_id: 3, name: "Chudchael Biwong", class_year: 2001, major: "Chudsic", phases: "3", bio: "Goodbye the chudgang", public_email: "test@mwmsc.net", identity_email: "contact@michaelwongmusic.com", active: 1, roles: "reviewer", admin: 1, image: null},
    {contributor_id: 4, name: "Angry Thorn", class_year: 2002, major: "Shosty", phases: "1,2", bio: "Repeating motifs", public_email: "spinaam206@potsdam.edu", identity_email: "test@examine.com", active: 0, roles: "reviewer", admin: 1, image: null},
    {contributor_id: 5, name: "Cool Girl", class_year: 2003, major: "Music", phases: "1", bio: "leaf", public_email: "woah@example.com", identity_email: "coolgirl@yahoo.com", active: 0, roles: "reviewer", admin: 1, image: null},
    {contributor_id: 67, name: "Nobody InParticular", class_year: 2004, major: "Music", phases: "4", bio: "Wonder who i could be", public_email: "whoooo@example.com", identity_email: "id@example.com", active: 0, roles: "reviewer", admin: 0, image: null}
]

const contributor_table = new VirtualSQLTable(CONTRIBUTOR, test_contributor_data)
const stmt_select_all = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors")

const stmt_select_where = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors")
stmt_select_where.addWhere("contributor_id", ["2", "3"], SQLCompareOp.IN)

const stmt_select_distinct_limit = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors", ["major"])
stmt_select_distinct_limit.distinct = true
stmt_select_distinct_limit.setLimit(2)

const stmt_invalid_verb = new SQLStatement(CONTRIBUTOR, "UPDATE", "contributors")
stmt_invalid_verb.addValueGroup({name: "Test"})
stmt_invalid_verb.addWhere("contributor_id", "1", SQLCompareOp.EQ)

const stmt_invalid_table = new SQLStatement(CONTRIBUTOR, "SELECT", "composers")

it('VirtualSQLTable executes simple select all', () => {
    const expected = test_contributor_data
    expect(contributor_table.execute(stmt_select_all)).toEqual(expected)
})

it('VirtualSQLTable executes select with where clause', () => {
    const expected = [test_contributor_data[1], test_contributor_data[2]]
    expect(contributor_table.execute(stmt_select_where)).toEqual(expected)
})

it('VirtualSQLTable executes select with distinct, limit, and column constraint', () => {
    const expected = [["Cosmic Geology"], ["Computer Science"]]
    expect(contributor_table.execute(stmt_select_distinct_limit)).toEqual(expected)
})

it('VirtualSQLTable throws error for unsupported verb', () => {
    expect(() => contributor_table.execute(stmt_invalid_verb)).toThrow(Error)
})

it('VirtualSQLTable throws error for invalid table', () => {
    expect(() => contributor_table.execute(stmt_invalid_table)).toThrow(Error)
})

it('SQLStatement construct prototype returns correct form from VirtualSQLTable', () => {
    const stmt = new SQLStatement(CONTRIBUTOR, "SELECT", "contributors", ["name", "major", "contributor_id"])
    const output = contributor_table.execute(stmt)
    expect(output[0]).toEqual({name: "Niche Apples", major: "Cosmic Geology", contributor_id: 1})
})

