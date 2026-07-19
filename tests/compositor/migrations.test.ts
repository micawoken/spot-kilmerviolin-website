/**
 * tests/compositor/migrations.test.ts
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
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

import { describe, it, expect } from "vitest"

import { CURRENT_SCHEMA_VERSION, emptyDesignDoc, migrateDesign } from "../../src/lib/compositor/migrations"

const validDoc = {
    schemaVersion: 1,
    puck: { root: { props: {} }, content: [{ type: "Heading", props: { id: "h1", text: "Hi" } }] }
}

describe("migrateDesign — valid input", () => {
    it("returns a document at the current version", () => {
        const result = migrateDesign(validDoc)
        expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
        expect(result.puck).toEqual(validDoc.puck)
    })
    it("accepts an empty content array", () => {
        const result = migrateDesign({ schemaVersion: 1, puck: { root: {}, content: [] } })
        expect(result.puck.content).toEqual([])
    })
})

describe("migrateDesign — pre-envelope documents", () => {
    it("reads a bare Puck tree (saved by the early editor) as a version-1 envelope", () => {
        const result = migrateDesign(validDoc.puck)
        expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
        expect(result.puck).toEqual(validDoc.puck)
    })
    it("does not treat a partial envelope as a bare Puck tree", () => {
        expect(() => migrateDesign({ puck: { content: [] } })).toThrow(/schemaVersion/)
    })
})

describe("migrateDesign — malformed input throws", () => {
    it("rejects non-objects", () => {
        expect(() => migrateDesign(null)).toThrow(/expected an object/)
        expect(() => migrateDesign(42)).toThrow(/expected an object/)
        expect(() => migrateDesign([])).toThrow(/expected an object/)
    })
    it("rejects a missing or non-integer schemaVersion", () => {
        expect(() => migrateDesign({ puck: { content: [] } })).toThrow(/schemaVersion/)
        expect(() => migrateDesign({ schemaVersion: 1.5, puck: { content: [] } })).toThrow(/schemaVersion/)
    })
    it("rejects a puck without a content array", () => {
        expect(() => migrateDesign({ schemaVersion: 1, puck: {} })).toThrow(/content/)
        expect(() => migrateDesign({ schemaVersion: 1, puck: { content: {} } })).toThrow(/content/)
    })
    it("rejects a version newer than the build supports", () => {
        expect(() => migrateDesign({ schemaVersion: CURRENT_SCHEMA_VERSION + 1, puck: { content: [] } })).toThrow(
            /newer than this build/
        )
    })
    it("rejects a version below the minimum", () => {
        expect(() => migrateDesign({ schemaVersion: 0, puck: { content: [] } })).toThrow(/below the minimum/)
    })
})

describe("migrateDesign — backfills missing component ids", () => {
    // Puck's editor store indexes every node BY `props.id` (required in @puckeditor/core's own types,
    // not optional); a component written without one — e.g. by a hand-authored seed script, as
    // tools/seed-entity-templates.mjs once did — collides with every other id-less sibling on the same
    // index key, corrupting the store and driving the editor into an infinite re-render loop that OOMs
    // the tab. Every read must self-heal this, not just re-running the writer.
    it("assigns a unique id to a top-level component missing one", () => {
        const result = migrateDesign({
            schemaVersion: 1,
            puck: { root: {}, content: [{ type: "Heading", props: { text: "Hi" } }] }
        })
        const id = (result.puck.content[0] as { props: { id: unknown } }).props.id
        expect(typeof id).toBe("string")
        expect(id).not.toBe("")
    })

    it("assigns distinct ids to id-less siblings nested inside a slot", () => {
        const result = migrateDesign({
            schemaVersion: 1,
            puck: {
                root: {},
                content: [
                    {
                        type: "Section",
                        props: {
                            content: [
                                { type: "Heading", props: { text: "One" } },
                                { type: "Heading", props: { text: "Two" } }
                            ]
                        }
                    }
                ]
            }
        })
        const section = result.puck.content[0] as { props: { content: Array<{ props: { id: unknown } }> } }
        const [first, second] = section.props.content
        expect(first.props.id).toEqual(expect.any(String))
        expect(second.props.id).toEqual(expect.any(String))
        expect(first.props.id).not.toBe(second.props.id)
        expect(first.props.id).not.toBe("")
    })

    it("leaves a component's existing id untouched", () => {
        const result = migrateDesign({
            schemaVersion: 1,
            puck: { root: {}, content: [{ type: "Heading", props: { id: "kept-id", text: "Hi" } }] }
        })
        expect((result.puck.content[0] as { props: { id: unknown } }).props.id).toBe("kept-id")
    })
})

describe("emptyDesignDoc", () => {
    it("is a current-version envelope with an empty content array", () => {
        const doc = emptyDesignDoc()
        expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
        expect(doc.puck.content).toEqual([])
        // A freshly-created design must survive the same validation every read runs.
        expect(() => migrateDesign(doc)).not.toThrow()
    })
})
