/**
 * tests/compositor/lint.test.ts
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
 *
 * This license is also subject to additional terms as specified in the README.md.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, it, expect } from "vitest"

import { lintDesign, hasBlockingError } from "../../src/lib/compositor/lint"
import type { TokenCatalog, TokenPropRegistry } from "../../src/lib/compositor/tokens"
import type { DesignDoc, PuckData } from "../../src/lib/compositor/types"

// Catalog v1's token-select props (mirrors catalog.tsx TOKEN_PROPS); kept local so this unit test
// stays free of the catalog's React/Puck import, matching the token pass's decoupling intent.
const TOKEN_PROPS: TokenPropRegistry = {
    Section: { background: "colors", paddingY: "space" },
    Columns: { gap: "space" },
    Heading: { typography: "typography" },
    Spacer: { size: "space" },
    Divider: { spaceAround: "space", color: "colors" }
}

const THEME: TokenCatalog = {
    schemaVersion: 1,
    colors: [
        { name: "accent", value: "#f00" },
        { name: "page-bg", value: "#fff" }
    ],
    typography: [{ name: "display", family: "serif", size: "2rem", weight: "700", lineHeight: "1.2" }],
    space: [{ name: "md", value: "1rem" }],
    radius: [],
    shadows: [],
    borders: [],
    breakpoints: []
}

/** Wraps a top-level component array in a valid design envelope. */
function doc(content: unknown[]): DesignDoc {
    return { schemaVersion: 1, puck: { root: { props: {} }, content } as unknown as PuckData }
}

function heading(level: string, typography = "display", text = "Text") {
    return { type: "Heading", props: { text, level, typography, align: "start" } }
}

function lint(content: unknown[], theme: TokenCatalog | null = THEME) {
    return lintDesign(doc(content), theme, TOKEN_PROPS)
}

/** Rule ids present in a finding set (order-preserving). */
function rules(findings: ReturnType<typeof lint>) {
    return findings.map((finding) => finding.rule)
}

describe("lintDesign — clean documents", () => {
    it("returns no findings for a valid page", () => {
        const findings = lint([heading("h1"), heading("h2")])
        expect(findings).toEqual([])
        expect(hasBlockingError(findings)).toBe(false)
    })

    it("counts a single H1 nested inside a slot", () => {
        const nested = doc([{ type: "Section", props: { background: "", paddingY: "md", content: [heading("h1")] } }])
        expect(lintDesign(nested, THEME, TOKEN_PROPS)).toEqual([])
    })
})

describe("lintDesign — heading rules", () => {
    it("errors when there is no H1", () => {
        const findings = lint([heading("h2"), heading("h3")])
        expect(rules(findings)).toContain("single-h1")
        expect(hasBlockingError(findings)).toBe(true)
    })

    it("errors when there is more than one H1", () => {
        const findings = lint([heading("h1"), heading("h1")])
        expect(findings.filter((f) => f.rule === "single-h1")).toHaveLength(1)
    })

    it("errors on a skipped heading level (h1 → h3)", () => {
        const findings = lint([heading("h1"), heading("h3")])
        expect(rules(findings)).toContain("heading-skip")
    })

    it("does not flag a contiguous descent (h1 → h2 → h3)", () => {
        expect(lint([heading("h1"), heading("h2"), heading("h3")])).toEqual([])
    })
})

describe("lintDesign — a11y and safety errors", () => {
    it("errors on an Image with empty alt", () => {
        const findings = lint([heading("h1"), { type: "Image", props: { alt: "  ", aspect: "original" } }])
        expect(rules(findings)).toContain("image-alt")
    })

    it("accepts an Image with alt text", () => {
        const findings = lint([heading("h1"), { type: "Image", props: { alt: "A violin", aspect: "original" } }])
        expect(rules(findings)).not.toContain("image-alt")
    })

    it("errors on a Button with a disallowed URL scheme", () => {
        const findings = lint([heading("h1"), { type: "Button", props: { label: "Go", href: "javascript:alert(1)", variant: "primary" } }])
        expect(rules(findings)).toContain("unsafe-href")
    })

    it("accepts safe Button hrefs (relative, https, mailto)", () => {
        for (const href of ["/about", "https://example.com", "mailto:x@y.z", "#top"]) {
            const findings = lint([heading("h1"), { type: "Button", props: { label: "Go", href, variant: "primary" } }])
            expect(rules(findings)).not.toContain("unsafe-href")
        }
    })
})

describe("lintDesign — warnings", () => {
    it("warns on a token name absent from the theme, skipping None ('')", () => {
        const findings = lint([
            heading("h1"),
            { type: "Section", props: { background: "ghost-color", paddingY: "md", content: [] } },
            { type: "Divider", props: { spaceAround: "md", color: "" } }
        ])
        const unknown = findings.filter((f) => f.rule === "unknown-token")
        expect(unknown).toHaveLength(1)
        expect(unknown[0].message).toContain("ghost-color")
        expect(unknown[0].severity).toBe("warning")
    })

    it("skips token checks when no theme is supplied", () => {
        const findings = lint([heading("h1"), { type: "Section", props: { background: "ghost-color", paddingY: "zzz", content: [] } }], null)
        expect(rules(findings)).not.toContain("unknown-token")
    })

    it("warns on an empty rendered column", () => {
        const findings = lint([
            heading("h1"),
            { type: "Columns", props: { count: 2, gap: "md", col1: [heading("h2")], col2: [], col3: [], col4: [] } }
        ])
        const empty = findings.filter((f) => f.rule === "empty-column")
        expect(empty).toHaveLength(1)
        expect(empty[0].message).toContain("Column 2 of 2")
    })

    it("warns on an unsupported rich-text block type", () => {
        const body = [
            { _type: "block", _key: "b1", style: "normal", markDefs: [], children: [{ _type: "span", _key: "s1", text: "ok", marks: [] }] },
            { _type: "image", _key: "i1" }
        ]
        const findings = lint([heading("h1"), { type: "RichText", props: { body } }])
        expect(rules(findings)).toContain("unsupported-block")
    })

    it("errors on a rich-text link with a disallowed scheme", () => {
        const body = [
            {
                _type: "block",
                _key: "b1",
                style: "normal",
                markDefs: [{ _type: "link", _key: "l1", href: "javascript:void(0)" }],
                children: [{ _type: "span", _key: "s1", text: "click", marks: ["l1"] }]
            }
        ]
        const findings = lint([heading("h1"), { type: "RichText", props: { body } }])
        expect(rules(findings)).toContain("unsafe-href")
    })
})
