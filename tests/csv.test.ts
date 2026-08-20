/**
 * tests/csv.test.ts
 *
 * Unit tests for the shared CSV toolkit and the import core
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

/// <reference path="../src/lib/api/types.d.ts" />

import { describe, it, expect } from "vitest"

import { parseCsv, parseCsvWithHeader, nearestName } from "../src/lib/api/csv.ts"
import {
    buildComposer,
    buildContributor,
    buildComposition,
    flagCompositionDuplicates,
    flagNameDuplicates,
    indexByName,
    indexByNameRole,
    parsePhases,
    compositionKey,
    normalizeName,
    type WorksContext,
    type BuildIssue
} from "../src/scripts/import_build.ts"
import { sentinelComposerName } from "../src/lib/api/composer_sentinel.ts"
import { composer_csv_columns, composition_csv_columns } from "../src/scripts/types.ts"

/** Plain message text for warnings, for assertions that don't care about column tagging. */
const warningMessages = (warnings: BuildIssue[]): string[] => warnings.map((warning) => warning.message)

/** Plain message text for issues, for assertions that don't care about column tagging. */
const messages = (issues: BuildIssue[]): string[] => issues.map((issue) => issue.message)

describe("parseCsv", () => {
    it("parses a simple grid", () => {
        expect(parseCsv("a,b,c\n1,2,3")).toEqual([
            ["a", "b", "c"],
            ["1", "2", "3"]
        ])
    })

    it("handles quoted fields with embedded commas, quotes, and newlines", () => {
        const text = 'name,note\n"Bach, J.S.","He said ""hi""\nsecond line"'
        expect(parseCsv(text)).toEqual([
            ["name", "note"],
            ["Bach, J.S.", 'He said "hi"\nsecond line']
        ])
    })

    it("accepts CRLF line endings and ignores a trailing newline", () => {
        expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
            ["a", "b"],
            ["1", "2"]
        ])
    })

    it("preserves a genuinely empty middle line as a single empty cell", () => {
        expect(parseCsv("a\n\nb")).toEqual([["a"], [""], ["b"]])
    })
})

describe("parseCsvWithHeader", () => {
    it("maps rows to objects keyed by header, order-independent", () => {
        const rows = parseCsvWithHeader("b,a\n2,1", ["a", "b"])
        expect(rows).toEqual([{ a: "1", b: "2" }])
    })

    it("skips trailing blank lines", () => {
        const rows = parseCsvWithHeader("a,b\n1,2\n\n", ["a", "b"])
        expect(rows).toHaveLength(1)
    })

    it("throws on a missing expected column", () => {
        expect(() => parseCsvWithHeader("a\n1", ["a", "b"])).toThrow(/missing column/)
    })

    it("throws on an unexpected column when extras are not allowed", () => {
        expect(() => parseCsvWithHeader("a,b,c\n1,2,3", ["a", "b"])).toThrow(/unexpected column/)
    })

    it("tolerates and carries through extra columns when allowed", () => {
        const rows = parseCsvWithHeader("name,note\nAda,hi", ["name"], true)
        expect(rows).toEqual([{ name: "Ada", note: "hi" }])
    })

    it("throws on a duplicate header column", () => {
        expect(() => parseCsvWithHeader("a,a\n1,2", ["a"])).toThrow(/Duplicate column/)
    })

    it("throws when a row has the wrong number of cells", () => {
        expect(() => parseCsvWithHeader("a,b\n1", ["a", "b"])).toThrow(/column/)
    })

    it("throws on an empty file", () => {
        expect(() => parseCsvWithHeader("", ["a"])).toThrow(/empty/)
    })
})

describe("nearestName", () => {
    const names = ["Johann Sebastian Bach", "Ludwig van Beethoven", "Claude Debussy"]

    it("returns an exact match ignoring case and whitespace", () => {
        expect(nearestName("  johann   sebastian bach ", names)).toBe("Johann Sebastian Bach")
    })

    it("suggests the closest name within the edit-distance bound", () => {
        expect(nearestName("Claude Debussi", names)).toBe("Claude Debussy")
    })

    it("returns null when nothing is close enough", () => {
        expect(nearestName("Igor Stravinsky", names)).toBeNull()
    })
})

// helper: build a full composer CSV cell record with blanks, overriding as needed
function composerCells(overrides: Record<string, string> = {}): Record<string, string> {
    const cells: Record<string, string> = {}
    for (const column of composer_csv_columns) {
        cells[column] = ""
    }
    return { ...cells, ...overrides }
}

// helper: build a full composition CSV cell record with blanks, overriding as needed
function compositionCells(overrides: Record<string, string> = {}): Record<string, string> {
    const cells: Record<string, string> = {}
    for (const column of composition_csv_columns) {
        cells[column] = ""
    }
    return { ...cells, ...overrides }
}

describe("buildComposer", () => {
    it("normalizes the country, splits tags, and nulls blank optional fields", () => {
        const { record, issues } = buildComposer(
            composerCells({
                name: "Amy Beach",
                role: "composer",
                country: " us ",
                tags: "romantic; american",
                birth_year: "1867"
            })
        )
        expect(issues).toEqual([])
        expect(record.country).toBe("US")
        expect(record.tags).toEqual(["romantic", "american"])
        expect(record.birth_year).toBe(1867)
        expect(record.death_year).toBeNull()
        expect(record.bio).toBeNull()
    })

    it("flags a blank name", () => {
        const { issues } = buildComposer(composerCells({ name: "  ", role: "composer" }))
        expect(messages(issues)).toContain("name is required")
        expect(issues[0].column).toBe("name")
    })

    it("flags a blank role", () => {
        const { issues } = buildComposer(composerCells({ name: "Amy Beach", role: "  " }))
        expect(messages(issues)).toContain("role is required")
        expect(issues.find((issue) => issue.message === "role is required")?.column).toBe("role")
    })

    it("case-unifies role against the AuthorRole enum", () => {
        const { record } = buildComposer(composerCells({ name: "Amy Beach", role: "ARRANGER" }))
        expect(record.role).toBe("arranger")
    })

    it("leaves a non-AuthorRole role as-is (just trimmed)", () => {
        const { record, issues } = buildComposer(composerCells({ name: "Amy Beach", role: "  Ghostwriter  " }))
        expect(issues).toEqual([])
        expect(record.role).toBe("Ghostwriter")
    })

    it("strips control characters and trims whitespace from name/bio", () => {
        const nullByte = String.fromCharCode(0)
        const { record } = buildComposer(
            composerCells({ name: "  Amy Beach  ", role: "composer", bio: `  A ${nullByte}bio.  ` })
        )
        expect(record.name).toBe("Amy Beach")
        expect(record.bio).toBe("A bio.")
    })

    it("accepts a valid image URL/path", () => {
        const { issues } = buildComposer(
            composerCells({ name: "Amy Beach", role: "composer", image: "https://example.com/pic.jpg" })
        )
        expect(issues).toEqual([])
    })

    it("flags an invalid image value", () => {
        const { issues } = buildComposer(composerCells({ name: "Amy Beach", role: "composer", image: "not a url" }))
        expect(messages(issues)).toContain("image is not a valid URL or internal path")
        expect(issues.find((issue) => issue.column === "image")).toBeDefined()
    })

    it("dedupes tags case-insensitively and trims each one", () => {
        const { record } = buildComposer(
            composerCells({ name: "Amy Beach", role: "composer", tags: " Romantic ; romantic; American" })
        )
        expect(record.tags).toEqual(["Romantic", "American"])
    })

    it("flags too many distinct tags", () => {
        const tags = Array.from({ length: 26 }, (_, i) => `tag${i}`).join(";")
        const { issues } = buildComposer(composerCells({ name: "Amy Beach", role: "composer", tags }))
        expect(issues.some((issue) => /too many tags/.test(issue.message) && issue.column === "tags")).toBe(true)
    })

    it("canonicalizes a sentinel name and does not require role", () => {
        const { record, issues } = buildComposer(composerCells({ name: "unk", role: "" }))
        expect(record.name).toBe("Unknown")
        expect(messages(issues)).not.toContain("role is required")
    })

    it("still flags a blank role for a non-sentinel name", () => {
        const { issues } = buildComposer(composerCells({ name: "Traditionally Yours", role: "" }))
        expect(messages(issues)).toContain("role is required")
    })
})

describe("buildContributor", () => {
    it("produces an inactive, permissionless placeholder with a blank identity_email", () => {
        const { record, issues } = buildContributor({ name: "Placeholder Person" })
        expect(issues).toEqual([])
        expect(record).toMatchObject({
            name: "Placeholder Person",
            active: false,
            admin: false,
            roles: [],
            identity_email: "",
            class_year: null,
            phases: null
        })
    })

    it("flags a blank name", () => {
        expect(messages(buildContributor({ name: "" }).issues)).toContain("name is required")
    })
})

// a resolution context with two composers (Bach also appears as an "arranger" under a second id, so
// secondary-author role matching has something real to disambiguate) and two contributors, no existing
// works, empty phase map
function makeCtx(): WorksContext {
    const composerRecords = [
        { id: 10, name: "Johann Sebastian Bach", role: "composer" },
        { id: 11, name: "Amy Beach", role: "composer" },
        { id: 12, name: "Johann Sebastian Bach", role: "arranger" }
    ]
    const composers = indexByName(composerRecords)
    const contributors = indexByName([
        { id: 20, name: "Ada Lovelace" },
        { id: 21, name: "Grace Hopper" }
    ])
    return {
        composerByName: composers.byName,
        composerByNameRole: indexByNameRole(composerRecords),
        contributorByName: contributors.byName,
        composerNames: composers.names,
        contributorNames: contributors.names,
        existingKeys: new Set<string>(),
        phaseMap: new Map<string, string>()
    }
}

describe("sentinelComposerName", () => {
    it("collapses recognized \"unknown\" spellings to the \"Unknown\" sentinel", () => {
        for (const raw of ["unknown", "Unknown", "UNKNOWN COMPOSER", "unk", "unk.", "N/A", " na "]) {
            expect(sentinelComposerName(raw)).toBe("Unknown")
        }
    })

    it("collapses recognized \"traditional\" spellings to the \"Traditional\" sentinel", () => {
        for (const raw of ["traditional", "Traditional", "TRAD", "trad."]) {
            expect(sentinelComposerName(raw)).toBe("Traditional")
        }
    })

    it("leaves every other name unchanged", () => {
        for (const raw of ["Amy Beach", "Johann Sebastian Bach", "", "Unknown River Band"]) {
            expect(sentinelComposerName(raw)).toBe(raw)
        }
    })
})

// a resolution context extending makeCtx() with the two sentinel composer records already present, for
// tests that need sentinelComposerName's output to actually resolve rather than just report the issue
function makeCtxWithSentinels(): WorksContext {
    const composerRecords = [
        { id: 10, name: "Johann Sebastian Bach", role: "composer" },
        { id: 11, name: "Amy Beach", role: "composer" },
        { id: 12, name: "Johann Sebastian Bach", role: "arranger" },
        { id: 13, name: "Unknown", role: "other" },
        { id: 14, name: "Traditional", role: "other" }
    ]
    const composers = indexByName(composerRecords)
    const contributors = indexByName([
        { id: 20, name: "Ada Lovelace" },
        { id: 21, name: "Grace Hopper" }
    ])
    return {
        composerByName: composers.byName,
        composerByNameRole: indexByNameRole(composerRecords),
        contributorByName: contributors.byName,
        composerNames: composers.names,
        contributorNames: contributors.names,
        existingKeys: new Set<string>(),
        phaseMap: new Map<string, string>()
    }
}

describe("buildComposition: unknown/traditional composer sentinel normalization", () => {
    it("resolves a variant \"unknown\" composer cell to the Unknown sentinel composer", () => {
        const { record, issues } = buildComposition(
            baseCompositionCells({ composer: "unk.", contrib_primary_1: "Ada Lovelace" }),
            makeCtxWithSentinels()
        )
        expect(issues).toEqual([])
        expect(record.composer_id).toBe(13)
    })

    it("resolves a variant \"traditional\" composer cell to the Traditional sentinel composer", () => {
        const { record, issues } = buildComposition(
            baseCompositionCells({ composer: "TRAD", contrib_primary_1: "Ada Lovelace" }),
            makeCtxWithSentinels()
        )
        expect(issues).toEqual([])
        expect(record.composer_id).toBe(14)
    })

    it("resolves a variant sentinel spelling in author_secondary the same way", () => {
        const { record, issues } = buildComposition(
            baseCompositionCells({ author_secondary: "N/A (other)" }),
            makeCtxWithSentinels()
        )
        expect(issues).toEqual([])
        expect(record.author_secondary).toEqual([13]) // resolved via the "Unknown" sentinel's (name, role) entry
    })
})

describe("buildComposition", () => {
    it("resolves composer and contributor names to ids and maps the contribution period to phases", () => {
        const ctx = makeCtx()
        ctx.phaseMap.set("Early years", "1, 2")
        const { record, issues } = buildComposition(
            compositionCells({
                name: "Invention No. 1",
                composer: "johann sebastian bach",
                contrib_primary_1: "Ada Lovelace",
                contrib_addl: "Grace Hopper",
                author_secondary: "Amy Beach (composer)",
                type: "solo",
                contribution_period: "Early years"
            }),
            ctx
        )
        expect(issues).toEqual([])
        expect(record.composer_id).toBe(10)
        expect(record.contrib_primary_1).toBe(20)
        expect(record.contrib_addl).toEqual([21])
        expect(record.author_secondary).toEqual([11])
        expect(record.phases).toEqual([1, 2])
    })

    it("reports an unknown contributor with a did-you-mean suggestion, tagged to its own column", () => {
        const { issues } = buildComposition(
            compositionCells({
                name: "Study",
                composer: "Amy Beach",
                contrib_primary_1: "Ada Lovelce",
                type: "solo"
            }),
            makeCtx()
        )
        const issue = issues.find((candidate) =>
            /unknown contributor "Ada Lovelce".*did you mean "Ada Lovelace"/.test(candidate.message)
        )
        expect(issue).toBeDefined()
        // the field this issue is really about, not the "composer" column the generic "contributor" label
        // might otherwise be confused for
        expect(issue?.column).toBe("contrib_primary_1")
    })

    it("tags an unknown author_secondary reference to its own column, not the composer column", () => {
        const { issues } = buildComposition(
            compositionCells({
                name: "Study",
                composer: "Amy Beach",
                contrib_primary_1: "Ada Lovelace",
                author_secondary: "Not A Real Composer",
                type: "solo"
            }),
            makeCtx()
        )
        const issue = issues.find((candidate) => /unknown composer "Not A Real Composer"/.test(candidate.message))
        expect(issue).toBeDefined()
        expect(issue?.column).toBe("author_secondary")
    })

    it("flags a non-blank contribution period that has not been mapped, tagged to the contribution_period column", () => {
        const { issues } = buildComposition(
            compositionCells({
                name: "Study",
                composer: "Amy Beach",
                contrib_primary_1: "Ada Lovelace",
                type: "solo",
                contribution_period: "Late period"
            }),
            makeCtx()
        )
        const issue = issues.find((candidate) => /"Late period" is not mapped/.test(candidate.message))
        expect(issue).toBeDefined()
        expect(issue?.column).toBe("contribution_period")
    })

    it("leaves phases empty for a blank contribution period without an issue", () => {
        const { record, issues } = buildComposition(
            compositionCells({
                name: "Study",
                composer: "Amy Beach",
                contrib_primary_1: "Ada Lovelace",
                type: "solo"
            }),
            makeCtx()
        )
        expect(record.phases).toEqual([])
        expect(issues).toEqual([])
    })
})

// base cells shared by the sanitization-focused buildComposition tests below: a minimally valid row with
// every field an individual test doesn't care about left blank
function baseCompositionCells(overrides: Record<string, string> = {}): Record<string, string> {
    return compositionCells({
        name: "Study",
        composer: "Amy Beach",
        contrib_primary_1: "Ada Lovelace",
        type: "Chamber",
        ...overrides
    })
}

describe("buildComposition: secondary-author (name, role) matching", () => {
    it("resolves an explicit role annotation to the matching role variant", () => {
        const { record, issues } = buildComposition(
            baseCompositionCells({ author_secondary: "Johann Sebastian Bach (arranger)" }),
            makeCtx()
        )
        expect(issues).toEqual([])
        expect(record.author_secondary).toEqual([12]) // the "arranger" id, not the "composer" id (10)
    })

    it("defaults to the arranger role when no role annotation is given", () => {
        const { record, issues } = buildComposition(
            baseCompositionCells({ author_secondary: "Johann Sebastian Bach" }),
            makeCtx()
        )
        expect(issues).toEqual([])
        expect(record.author_secondary).toEqual([12])
    })

    it("reports an unresolved (name, role) pairing, naming the assumed/given role", () => {
        // Amy Beach exists only as "composer" - an unannotated secondary-author entry assumes "arranger",
        // which does not exist for her, so this must be reported rather than silently resolving to id 11
        const { issues } = buildComposition(baseCompositionCells({ author_secondary: "Amy Beach" }), makeCtx())
        expect(issues.some((issue) => /unknown composer "Amy Beach" with role "arranger"/.test(issue.message))).toBe(
            true
        )
    })

    it("case-unifies an explicit role against AuthorRole before matching", () => {
        const { record, issues } = buildComposition(
            baseCompositionCells({ author_secondary: "Johann Sebastian Bach (ARRANGER)" }),
            makeCtx()
        )
        expect(issues).toEqual([])
        expect(record.author_secondary).toEqual([12])
    })
})

describe("buildComposition: type/key/image/tags", () => {
    it("flags a blank type", () => {
        const { issues } = buildComposition(baseCompositionCells({ type: "" }), makeCtx())
        expect(issues.some((issue) => issue.message === "type is required" && issue.column === "type")).toBe(true)
    })

    it("case-unifies type against the WorkType enum", () => {
        const { record } = buildComposition(baseCompositionCells({ type: "chamber" }), makeCtx())
        expect(record.type).toBe("Chamber")
    })

    it("case-unifies key against the Key enum", () => {
        const { record, warnings } = buildComposition(baseCompositionCells({ key: "c major" }), makeCtx())
        expect(record.key).toBe("C Major")
        expect(warnings).toEqual([])
    })

    it("takes the first of several semicolon-delimited keys and warns", () => {
        const { record, warnings } = buildComposition(
            baseCompositionCells({ key: "G Major; D Major" }),
            makeCtx()
        )
        expect(record.key).toBe("G Major")
        expect(warningMessages(warnings).some((message) => /multiple keys given/.test(message))).toBe(true)
    })

    it("accepts a valid image URL", () => {
        const { issues } = buildComposition(
            baseCompositionCells({ image: "https://example.com/pic.jpg" }),
            makeCtx()
        )
        expect(issues).toEqual([])
    })

    it("flags an invalid image value", () => {
        const { issues } = buildComposition(baseCompositionCells({ image: "not a url" }), makeCtx())
        expect(issues.some((issue) => issue.column === "image")).toBe(true)
    })

    it("dedupes tags case-insensitively and flags too many", () => {
        const { record } = buildComposition(
            baseCompositionCells({ tags: " Fun ; fun; Recital" }),
            makeCtx()
        )
        expect(record.tags).toEqual(["Fun", "Recital"])

        const tooMany = Array.from({ length: 26 }, (_, i) => `tag${i}`).join(";")
        const { issues } = buildComposition(baseCompositionCells({ tags: tooMany }), makeCtx())
        expect(issues.some((issue) => /too many tags/.test(issue.message) && issue.column === "tags")).toBe(true)
    })
})

describe("buildComposition: range cleanup", () => {
    it("trims whitespace and title-cases each component", () => {
        const { record } = buildComposition(baseCompositionCells({ range: " g3 - a5 " }), makeCtx())
        expect(record.range).toBe("G3-A5")
    })

    it("respells a double-accidental component to its enharmonic equivalent", () => {
        const { record } = buildComposition(baseCompositionCells({ range: "Fx3-A5" }), makeCtx())
        expect(record.range).toBe("G3-A5")
    })
})

describe("buildComposition: position_highest extraction", () => {
    it("passes through an already-valid value unchanged, without a warning", () => {
        const { record, warnings } = buildComposition(
            baseCompositionCells({ position_highest: "III" }),
            makeCtx()
        )
        expect(record.position_highest).toBe("III")
        expect(warnings).toEqual([])
    })

    it("extracts a valid token from a messy value and warns", () => {
        const { record, warnings } = buildComposition(
            baseCompositionCells({ position_highest: "Position III (approx.)" }),
            makeCtx()
        )
        expect(record.position_highest).toBe("III")
        expect(
            warningMessages(warnings).some((message) => /position_highest .* was interpreted as "III"/.test(message))
        ).toBe(true)
    })

    it("leaves an unextractable value as-is (no client-side issue; the server dry-run reports it)", () => {
        const { record, issues, warnings } = buildComposition(
            baseCompositionCells({ position_highest: "unclear" }),
            makeCtx()
        )
        expect(record.position_highest).toBe("unclear")
        expect(issues).toEqual([])
        expect(warnings).toEqual([])
    })
})

describe("buildComposition: rating and publish_year digit extraction", () => {
    it("extracts a rating from surrounding prose", () => {
        const { record, issues } = buildComposition(
            baseCompositionCells({ rating_suzuki: "Level 5 stars" }),
            makeCtx()
        )
        expect(issues).toEqual([])
        expect(record.rating).toEqual({ suzuki: 5, nyssma: null })
    })

    it("extracts a publish_year from surrounding punctuation/prose", () => {
        const { record } = buildComposition(
            baseCompositionCells({
                publish_name: "Test Press",
                publish_location: "Boston",
                publish_year: "c. 1923",
                uri_type: "https",
                uri: "https://example.com"
            }),
            makeCtx()
        )
        expect((record.publication_info as { year: number }).year).toBe(1923)
    })
})

describe("buildComposition: uri_type inference and ISBN-13 preference", () => {
    it("infers https from the uri's shape and warns", () => {
        const { record, warnings } = buildComposition(
            baseCompositionCells({
                publish_name: "Test Press",
                publish_location: "Boston",
                publish_year: "2000",
                uri: "https://example.com"
            }),
            makeCtx()
        )
        expect((record.publication_info as { uri_type: string }).uri_type).toBe("https")
        expect(warningMessages(warnings).some((message) => /uri_type was not specified.*inferred "https"/.test(message))).toBe(
            true
        )
    })

    it("does not warn when uri_type was explicitly given", () => {
        const { warnings } = buildComposition(
            baseCompositionCells({
                publish_name: "Test Press",
                publish_location: "Boston",
                publish_year: "2000",
                uri_type: "https",
                uri: "https://example.com"
            }),
            makeCtx()
        )
        expect(warningMessages(warnings).some((message) => /uri_type/.test(message))).toBe(false)
    })

    it("prefers ISBN-13 when the uri is a checksum-valid ISBN-10", () => {
        const { record } = buildComposition(
            baseCompositionCells({
                publish_name: "Test Press",
                publish_location: "Boston",
                publish_year: "2000",
                uri_type: "isbn",
                uri: "0-306-40615-2"
            }),
            makeCtx()
        )
        expect((record.publication_info as { uri: string }).uri).toBe("9780306406157")
    })
})

describe("parsePhases", () => {
    it("parses comma- and semicolon-separated phases, de-duplicating and sorting", () => {
        expect(parsePhases("2, 1; 2")).toEqual([1, 2])
    })

    it("yields an empty list for blank or non-numeric input", () => {
        expect(parsePhases("  ")).toEqual([])
        expect(parsePhases("none")).toEqual([])
    })
})

describe("flagCompositionDuplicates", () => {
    it("flags a duplicate against the existing database", () => {
        const existing = new Set<string>([compositionKey(10, "Invention No. 1", null)])
        const results = [{ record: { composer_id: 10, name: "Invention No. 1", part: null }, issues: [] as BuildIssue[], warnings: [] as BuildIssue[] }]
        flagCompositionDuplicates(results, existing)
        expect(messages(results[0].issues)).toContain(
            "a composition with this name and part already exists for this composer"
        )
    })

    it("flags two rows with the same composer, name, and part within the file", () => {
        const results = [
            { record: { composer_id: 10, name: "Prelude", part: "Violin I" }, issues: [] as BuildIssue[], warnings: [] as BuildIssue[] },
            { record: { composer_id: 10, name: "prelude", part: "violin i" }, issues: [] as BuildIssue[], warnings: [] as BuildIssue[] }
        ]
        flagCompositionDuplicates(results, new Set<string>())
        // second occurrence is flagged as a within-file duplicate (name and part compared case-insensitively)
        expect(messages(results[1].issues)).toContain(
            "duplicate composition (same name, composer, and part) within this file"
        )
    })

    it("does not flag same-name works by different composers", () => {
        const results = [
            { record: { composer_id: 10, name: "Prelude", part: null }, issues: [] as BuildIssue[], warnings: [] as BuildIssue[] },
            { record: { composer_id: 11, name: "Prelude", part: null }, issues: [] as BuildIssue[], warnings: [] as BuildIssue[] }
        ]
        flagCompositionDuplicates(results, new Set<string>())
        expect(results[0].issues).toEqual([])
        expect(results[1].issues).toEqual([])
    })

    it("does not flag same-name works by the same composer with different parts", () => {
        const results = [
            { record: { composer_id: 10, name: "Sonata", part: "Violin I" }, issues: [] as BuildIssue[], warnings: [] as BuildIssue[] },
            { record: { composer_id: 10, name: "Sonata", part: "Violin II" }, issues: [] as BuildIssue[], warnings: [] as BuildIssue[] }
        ]
        flagCompositionDuplicates(results, new Set<string>())
        expect(results[0].issues).toEqual([])
        expect(results[1].issues).toEqual([])
    })

    it("treats a null part and a blank part as the same part", () => {
        const existing = new Set<string>([compositionKey(10, "Etude", null)])
        const results = [{ record: { composer_id: 10, name: "Etude", part: "" }, issues: [] as BuildIssue[], warnings: [] as BuildIssue[] }]
        flagCompositionDuplicates(results, existing)
        expect(messages(results[0].issues)).toContain(
            "a composition with this name and part already exists for this composer"
        )
    })
})

describe("flagNameDuplicates", () => {
    it("flags a name that already exists in the database", () => {
        const existing = new Set<string>([normalizeName("Amy Beach")])
        const results = [{ record: { name: "amy   beach" }, issues: [] as BuildIssue[], warnings: [] as BuildIssue[] }]
        flagNameDuplicates(results, existing, "composer")
        expect(messages(results[0].issues)).toContain("a composer with this name already exists")
    })

    it("flags repeated names within the file (case-insensitive)", () => {
        const results = [
            { record: { name: "Ada Lovelace" }, issues: [] as BuildIssue[], warnings: [] as BuildIssue[] },
            { record: { name: "ada lovelace" }, issues: [] as BuildIssue[], warnings: [] as BuildIssue[] }
        ]
        flagNameDuplicates(results, new Set<string>(), "contributor")
        expect(messages(results[0].issues)).toContain("duplicate contributor name within this file")
        expect(messages(results[1].issues)).toContain("duplicate contributor name within this file")
    })

    it("does not flag distinct names", () => {
        const results = [
            { record: { name: "Ada Lovelace" }, issues: [] as BuildIssue[], warnings: [] as BuildIssue[] },
            { record: { name: "Grace Hopper" }, issues: [] as BuildIssue[], warnings: [] as BuildIssue[] }
        ]
        flagNameDuplicates(results, new Set<string>(), "contributor")
        expect(results[0].issues).toEqual([])
        expect(results[1].issues).toEqual([])
    })

    it("keys composers on (name, role), not name alone (mirrors idx_composers_name_role)", () => {
        const existing = new Set<string>([`${normalizeName("Amy Beach")} ${normalizeName("composer")}`])
        const sameNameDifferentRole = [{ record: { name: "Amy Beach", role: "arranger" }, issues: [] as BuildIssue[], warnings: [] as BuildIssue[] }]
        flagNameDuplicates(sameNameDifferentRole, existing, "composer")
        expect(sameNameDifferentRole[0].issues).toEqual([]) // not a collision - different role

        const sameNameSameRole = [{ record: { name: "amy   beach", role: "Composer" }, issues: [] as BuildIssue[], warnings: [] as BuildIssue[] }]
        flagNameDuplicates(sameNameSameRole, existing, "composer")
        expect(messages(sameNameSameRole[0].issues)).toContain("a composer with this name already exists")
    })
})
