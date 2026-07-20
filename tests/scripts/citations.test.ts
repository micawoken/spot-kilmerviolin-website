/**
 * tests/scripts/citations.test.ts
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

import { describe, it, expect } from "vitest"

import { citationsToTextarea, parseCitationsTextarea, renderCitationsList } from "../../src/scripts/citations"

describe("parseCitationsTextarea", () => {
    it("parses a well-formed multi-line textarea into a citations map", () => {
        const raw = "IMSLP: https://imslp.org/wiki/Test\nGrove Music Online: 10.1000/182"
        expect(parseCitationsTextarea(raw)).toEqual({
            IMSLP: "https://imslp.org/wiki/Test",
            "Grove Music Online": "10.1000/182"
        })
    })

    it("splits only on the FIRST colon (a value may contain further colons)", () => {
        const raw = "IMSLP: https://imslp.org/wiki/Category:Bach"
        expect(parseCitationsTextarea(raw)).toEqual({ IMSLP: "https://imslp.org/wiki/Category:Bach" })
    })

    it("returns an empty object for blank input", () => {
        expect(parseCitationsTextarea("")).toEqual({})
        expect(parseCitationsTextarea("   \n  \n")).toEqual({})
    })

    it("drops a line with no colon", () => {
        expect(parseCitationsTextarea("no colon here")).toEqual({})
    })

    it("drops a line with a blank source name or blank value", () => {
        expect(parseCitationsTextarea(": https://example.com")).toEqual({})
        expect(parseCitationsTextarea("IMSLP: ")).toEqual({})
    })

    it("trims whitespace around the key and value", () => {
        expect(parseCitationsTextarea("  IMSLP  :   https://imslp.org/wiki/Test  ")).toEqual({
            IMSLP: "https://imslp.org/wiki/Test"
        })
    })
})

describe("citationsToTextarea", () => {
    it("serializes a citations map to one 'Source Name: value' line per entry", () => {
        expect(citationsToTextarea({ IMSLP: "https://imslp.org/wiki/Test", DOI: "10.1000/182" })).toBe(
            "IMSLP: https://imslp.org/wiki/Test\nDOI: 10.1000/182"
        )
    })

    it("returns an empty string for null, undefined, or an empty map", () => {
        expect(citationsToTextarea(null)).toBe("")
        expect(citationsToTextarea(undefined)).toBe("")
        expect(citationsToTextarea({})).toBe("")
    })

    it("round-trips through parseCitationsTextarea", () => {
        const citations = { IMSLP: "https://imslp.org/wiki/Test", DOI: "10.1000/182" }
        expect(parseCitationsTextarea(citationsToTextarea(citations))).toEqual(citations)
    })
})

describe("renderCitationsList", () => {
    it("renders each entry as an anchor with the source name as display text", () => {
        const html = renderCitationsList({ IMSLP: "https://imslp.org/wiki/Test" }, "(none)")
        expect(html).toContain('href="https://imslp.org/wiki/Test"')
        expect(html).toContain(">IMSLP<")
    })

    it("links a DOI to its doi.org resolver", () => {
        const html = renderCitationsList({ Grove: "10.1000/182" }, "(none)")
        expect(html).toContain('href="https://doi.org/10.1000/182"')
    })

    it("links an ISBN to its Open Library page", () => {
        const html = renderCitationsList({ "A Book": "9780306406157" }, "(none)")
        expect(html).toContain('href="https://openlibrary.org/isbn/9780306406157"')
    })

    it("returns the placeholder for null, undefined, or an empty map", () => {
        expect(renderCitationsList(null, "(none)")).toBe("(none)")
        expect(renderCitationsList(undefined, "(none)")).toBe("(none)")
        expect(renderCitationsList({}, "(none)")).toBe("(none)")
    })

    it("escapes an untrusted source name (XSS defense-in-depth)", () => {
        const html = renderCitationsList({ '<script>alert(1)</script>': "https://example.com" }, "(none)")
        expect(html).not.toContain("<script>")
        expect(html).toContain("&lt;script&gt;")
    })
})
