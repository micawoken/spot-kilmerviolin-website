/// <reference path="../src/lib/api/types.d.ts" />

import { describe, it, expect, test } from "vitest"

import { formatCompFromD1, formatCompToD1, formatCompToD1Partial, SQLCompareOp, sqlListJoin, sqlPrepOp } from '../src/lib/api/common.ts'

// check type conversion functions

const d1_composer_record: D1Composer = {
    composer_id: 1,
    entry_date: "2024-01-01T00:00:00Z",
    name: "First Last",
    role: "composer",
    birth_year: 1900,
    death_year: 1950,
    country: "United States",
    bio: "Lorem ipsum dolor sit amet.",
    image: null,
    tags: ""
}

const composer_record: ComposerRecord = {
    id: 1,
    entry_date: "2024-01-01T00:00:00Z",
    name: "First Last",
    role: "composer",
    birth_year: 1900,
    death_year: 1950,
    country: "United States",
    bio: "Lorem ipsum dolor sit amet.",
    image: null,
    tags: []
}

const composer: Composer = {
    name: "First Last",
    role: "composer",
    birth_year: 1900,
    death_year: 1950,
    country: "United States",
    bio: "Lorem ipsum dolor sit amet.",
    image: null,
    tags: []
}

const d1_composer_if_new: D1Composer = {
    composer_id: -1,
    entry_date: new Date().toISOString(), // analogue for current date
    name: "First Last",
    role: "composer",
    birth_year: 1900,
    death_year: 1950,
    country: "United States",
    bio: "Lorem ipsum dolor sit amet.",
    image: null,
    tags: ""
}

const partial_composer_record: Partial<Composer> & { id: number } = {
    id: 1,
    name: "First Last",
    role: "composer"
}

const partial_d1composer_record: Partial<D1Composer> & { composer_id: number } = {
    composer_id: 1,
    name: "First Last",
    role: "composer"
}

// convert D1Composer to ComposerRecord
describe('D1Composer to Composer conversion', () => {
    it('should convert D1Composer to Composer correctly', () => {
        const result = formatCompFromD1(d1_composer_record)
        expect(result).toEqual(composer_record)
    })
})

// convert ComposerRecord to D1Composer

describe('Composer to D1Composer conversion for new record', () => {
    it('should convert Composer to D1Composer with composer_id -1 and current date', () => {
        let result = formatCompToD1(composer)
        // override the date, which drifts because of run time
        result.entry_date = d1_composer_if_new.entry_date
        expect(result).toEqual(d1_composer_if_new)
    })
})

// convert partial ComposerRecord to partial D1Composer

describe("Partial ComposerRecord to partial D1Composer conversion", () => {
    it("should convert partial ComposerRecord to partial D1Composer correctly", () => {
        const result = formatCompToD1Partial(partial_composer_record)
        expect(result).toEqual(partial_d1composer_record)
    })
})

// check D1 SQL machinery

const stmt_spec_line_eq: [string, string | string[], SQLCompareOp] = ["name", "First Last", SQLCompareOp.EQ]
const stmt_spec_line_lte: [string, string | string[], SQLCompareOp] = ["birth_year", "1950", SQLCompareOp.LTE]
const stmt_spec_line_in: [string, string | string[], SQLCompareOp] = ["country", ["United States", "United Kingdom"], SQLCompareOp.IN]
const stmt_spec_line_like: [string, string | string[], SQLCompareOp] = ["bio", "Lorem ipsum%", SQLCompareOp.LIKE]
const stmt_spec_line_between: [string, string | string[], SQLCompareOp] = ["birth_year", ["1900", "1950"], SQLCompareOp.BETWEEN]
const stmt_orderby_spec_line_single: [string, string] = ["birth_year", "ASC"]
const stmt_orderby_spec_line_multi: [string, string][] = [["birth_year", "ASC"], ["death_year", "DESC"]]

const stmt_columns_spec: Array<[string, (string | string[])?, SQLCompareOp?]> = [["name"], ["birth_year"], ["death_year"]]


describe("SQL statement line preparation - EQ operator", () => {
    it("should prepare SQL line with EQ operator correctly", () => {
        const result = sqlPrepOp(stmt_spec_line_eq)
        expect(result).toEqual(["name = ?", ["First Last"]])
    })
})

describe("SQL statement line preparation - LTE operator", () => {
    it("should prepare SQL line with LTE operator correctly", () => {
        const result = sqlPrepOp(stmt_spec_line_lte)
        expect(result).toEqual(["birth_year <= ?", ["1950"]])
    })
})

describe("SQL statement line preparation - IN operator", () => {
    it("should prepare SQL line with IN operator correctly", () => {
        const result = sqlPrepOp(stmt_spec_line_in)
        expect(result).toEqual(["country IN (?, ?)", ["United States", "United Kingdom"]])
    })
})

test('SQL statement line preparation - LIKE operator', () => {
    const result = sqlPrepOp(stmt_spec_line_like)
    expect(result).toEqual(["bio LIKE ?", ["Lorem ipsum%"]])
})

describe("SQL statement line preparation - LIKE operator", () => {
    it("should prepare SQL line with LIKE operator correctly", () => {
        const result = sqlPrepOp(stmt_spec_line_like)
        expect(result).toEqual(["bio LIKE ?", ["Lorem ipsum%"]])
    })
})

describe("SQL statement line preparation - BETWEEN operator", () => {
    it("should prepare SQL line with BETWEEN operator correctly", () => {
        const result = sqlPrepOp(stmt_spec_line_between)
        expect(result).toEqual(["birth_year BETWEEN ? AND ?", ["1900", "1950"]])
    })
})

describe("SQL statement line preparation - ORDER BY single line", () => {
    it("should prepare SQL ORDER BY clause with single param correctly", () => {
        const result = sqlListJoin([stmt_orderby_spec_line_single], "order")
        expect(result).toEqual(["birth_year ASC", []])
    })
})

describe("SQL statement line preparation - ORDER BY multiple lines", () => {
    it("should prepare SQL ORDER BY clause with multiple params correctly", () => {
        const result = sqlListJoin(stmt_orderby_spec_line_multi, "order")
        expect(result).toEqual(["birth_year ASC, death_year DESC", []])
    })
})

describe("SQL statement line preparation - columns specification", () => {
    it("should prepare SQL line with columns correctly", () => {
        const result = sqlListJoin(stmt_columns_spec, "columns")
        expect(result).toEqual(["name, birth_year, death_year", []])
    })
})