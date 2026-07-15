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

import { collectTokenUsage, lintDesign, hasBlockingError, type LintPairingContext, type OutletPropRegistry } from "../../src/lib/compositor/lint"
import type { CollectionField } from "../../src/lib/build/design-api"
import type { TokenCatalog, TokenPropRegistry } from "../../src/lib/compositor/tokens"
import type { DesignDoc, PuckData } from "../../src/lib/compositor/types"

// Catalog v1's token-select props (mirrors catalog.tsx TOKEN_PROPS); kept local so this unit test
// stays free of the catalog's React/Puck import, matching the token pass's decoupling intent.
const TOKEN_PROPS: TokenPropRegistry = {
    Section: { background: "colors", paddingY: "space" },
    Columns: { gap: "space" },
    Heading: { typography: "typography" },
    ContentText: { typography: "typography" },
    Spacer: { size: "space" },
    Divider: { spaceAround: "space", color: "colors" },
    Button: { variant: "buttonVariants" }
}

// The content outlets and their accepted field types (mirrors catalog.tsx OUTLET_PROPS), local for
// the same decoupling reason.
const OUTLET_PROPS: OutletPropRegistry = {
    ContentText: ["string", "text"],
    ContentRichText: ["portableText"],
    ContentImage: ["image"]
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

function lint(content: unknown[], theme: TokenCatalog | null = THEME, context?: LintPairingContext) {
    return lintDesign(doc(content), theme, TOKEN_PROPS, OUTLET_PROPS, context)
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
        expect(lintDesign(nested, THEME, TOKEN_PROPS, OUTLET_PROPS)).toEqual([])
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

// --- §1.11 fix: PT blocks styled h1–h6 inside rich-text bodies feed the heading checks -------------

/** A PT block styled as a heading, for RichText bodies and entry body values. */
function ptHeading(style: string, text = "PT heading") {
    return { _type: "block", _key: `k-${style}-${text}`, style, markDefs: [], children: [{ _type: "span", _key: "s", text, marks: [] }] }
}

describe("lintDesign — PT headings inside RichText bodies (§1.11)", () => {
    it("accepts a page whose only H1 comes from a RichText body", () => {
        expect(lint([{ type: "RichText", props: { body: [ptHeading("h1")] } }])).toEqual([])
    })

    it("errors when a RichText body's h1 duplicates a Heading h1", () => {
        const findings = lint([heading("h1"), { type: "RichText", props: { body: [ptHeading("h1")] } }])
        expect(rules(findings)).toContain("single-h1")
    })

    it("errors on a level skip across the Heading/RichText boundary (h1 → PT h3)", () => {
        const findings = lint([heading("h1"), { type: "RichText", props: { body: [ptHeading("h3")] } }])
        expect(rules(findings)).toContain("heading-skip")
    })

    it("ignores non-heading PT styles", () => {
        const findings = lint([heading("h1"), { type: "RichText", props: { body: [ptHeading("normal"), ptHeading("blockquote")] } }])
        expect(rules(findings)).not.toContain("heading-skip")
        expect(rules(findings)).not.toContain("single-h1")
    })
})

// --- Pairing rules (pivot §5.5) ---------------------------------------------------------------------

const SCHEMA: CollectionField[] = [
    { slug: "title", label: "Title", type: "string" },
    { slug: "body", label: "Body", type: "portableText" },
    { slug: "cover", label: "Cover", type: "image" },
    { slug: "published", label: "Published", type: "boolean" }
]

const ENTRY: Record<string, unknown> = {
    title: "Entry title",
    body: [ptHeading("normal", "plain paragraph")],
    // The real local-media wire shape: `src` stripped, key at `meta.storageKey`. A bare `id` resolves to
    // NOTHING (the file route is keyed by the storage key), which is why lint treats it as empty.
    cover: { id: "med_1", alt: "A violin", provider: "local", meta: { storageKey: "med_1.jpg" } }
}

function contentText(field: string, level = "h1") {
    return { type: "ContentText", props: { field, level, typography: "display", align: "start" } }
}
function contentRichText(field: string) {
    return { type: "ContentRichText", props: { field } }
}
function contentImage(field: string) {
    return { type: "ContentImage", props: { field, aspect: "original" } }
}

/** Lints in template mode against the standard schema/entry (overridable per test). */
function lintTemplate(content: unknown[], context: Partial<LintPairingContext> = {}) {
    return lint(content, THEME, { entry: ENTRY, schemaFields: SCHEMA, ...context })
}

describe("lintDesign — outlet-outside-template", () => {
    it("errors on any outlet in a design_page doc (no pairing context)", () => {
        const findings = lint([heading("h1"), contentText("title", "h2"), contentRichText("body"), contentImage("cover")])
        expect(findings.filter((f) => f.rule === "outlet-outside-template")).toHaveLength(3)
        expect(hasBlockingError(findings)).toBe(true)
    })

    it("accepts the same outlets in template mode", () => {
        const findings = lintTemplate([contentText("title"), contentRichText("body"), contentImage("cover")])
        expect(rules(findings)).not.toContain("outlet-outside-template")
        expect(findings).toEqual([])
    })
})

describe("lintDesign — dangling-outlet-field", () => {
    it("errors on an unbound outlet", () => {
        const findings = lintTemplate([contentText(""), contentRichText("body")])
        const dangling = findings.filter((f) => f.rule === "dangling-outlet-field")
        expect(dangling).toHaveLength(1)
        expect(dangling[0].message).toContain("no content field bound")
    })

    it("errors on a field slug absent from the schema", () => {
        const findings = lintTemplate([contentText("subtitle")])
        expect(rules(findings)).toContain("dangling-outlet-field")
    })

    it("errors on a field whose type the outlet does not accept", () => {
        const findings = lintTemplate([contentText("body")]) // portableText into a string/text outlet
        const dangling = findings.filter((f) => f.rule === "dangling-outlet-field")
        expect(dangling).toHaveLength(1)
        expect(dangling[0].message).toContain('"portableText"')
    })

    it("skips the check when the schema could not be read (schemaFields null)", () => {
        const findings = lintTemplate([contentText("subtitle")], { schemaFields: null, entry: null })
        expect(rules(findings)).not.toContain("dangling-outlet-field")
    })
})

describe("lintDesign — empty-outlet-value and content-image-alt", () => {
    it("warns when the entry's value for a bound field is missing or empty", () => {
        const entry = { ...ENTRY, title: "   ", body: [] }
        const findings = lintTemplate([contentText("title"), contentRichText("body")], { entry })
        const empty = findings.filter((f) => f.rule === "empty-outlet-value")
        expect(empty).toHaveLength(2)
        expect(empty.every((f) => f.severity === "warning")).toBe(true)
    })

    it("skips entry-dependent rows template-alone (entry null)", () => {
        const findings = lintTemplate([contentText("title"), contentImage("cover")], { entry: null })
        expect(findings).toEqual([])
    })

    it("errors when the resolved image has no alt text", () => {
        const entry = { ...ENTRY, cover: { id: "med_1", alt: "", provider: "local", meta: { storageKey: "med_1.jpg" } } }
        const findings = lintTemplate([contentText("title"), contentImage("cover")], { entry })
        expect(rules(findings)).toContain("content-image-alt")
        expect(hasBlockingError(findings)).toBe(true)
    })

    it("warns (not errors) when the image value is missing entirely", () => {
        const entry = { ...ENTRY, cover: undefined }
        const findings = lintTemplate([contentText("title"), contentImage("cover")], { entry })
        expect(rules(findings)).toContain("empty-outlet-value")
        expect(rules(findings)).not.toContain("content-image-alt")
    })

    it("warns when the image value carries only a media id — it resolves to nothing at render", () => {
        // Lint must predict the renderer: a bare id is not a usable handle, so this renders no <img>.
        // Reporting it as "present" would let a silently-imageless page publish clean.
        const entry = { ...ENTRY, cover: { id: "med_1", alt: "A violin" } }
        const findings = lintTemplate([contentText("title"), contentImage("cover")], { entry })
        expect(rules(findings)).toContain("empty-outlet-value")
    })
})

describe("lintDesign — heading order over the combined template+entry sequence", () => {
    it("errors when a ContentText h1 duplicates the entry body's h1", () => {
        const entry = { ...ENTRY, body: [ptHeading("h1", "Body h1")] }
        const findings = lintTemplate([contentText("title", "h1"), contentRichText("body")], { entry })
        expect(rules(findings)).toContain("single-h1")
    })

    it("accepts a template whose H1 is supplied by the entry body", () => {
        const entry = { ...ENTRY, body: [ptHeading("h1", "Body h1"), ptHeading("h2", "Body h2")] }
        const findings = lintTemplate([contentRichText("body")], { entry })
        expect(findings).toEqual([])
    })

    it("errors on a skip across the template/entry boundary (ContentText h1 → body h3)", () => {
        const entry = { ...ENTRY, body: [ptHeading("h3", "Body h3")] }
        const findings = lintTemplate([contentText("title", "h1"), contentRichText("body")], { entry })
        expect(rules(findings)).toContain("heading-skip")
    })

    it("skips the heading checks template-alone: the entry body may supply the missing levels", () => {
        const findings = lintTemplate([contentRichText("body")], { entry: null })
        expect(rules(findings)).not.toContain("single-h1")
    })

    it("runs PT safety over the entry's rich-text value", () => {
        const entry = {
            ...ENTRY,
            body: [
                ptHeading("h1"),
                {
                    _type: "block",
                    _key: "b2",
                    style: "normal",
                    markDefs: [{ _type: "link", _key: "l1", href: "javascript:void(0)" }],
                    children: [{ _type: "span", _key: "s2", text: "click", marks: ["l1"] }]
                }
            ]
        }
        const findings = lintTemplate([contentRichText("body")], { entry })
        expect(rules(findings)).toContain("unsafe-href")
    })
})

describe("lintDesign — template-no-outlets", () => {
    it("warns on a template containing zero outlets", () => {
        const findings = lintTemplate([heading("h1"), { type: "Spacer", props: { size: "md" } }])
        const warning = findings.filter((f) => f.rule === "template-no-outlets")
        expect(warning).toHaveLength(1)
        expect(warning[0].severity).toBe("warning")
    })

    it("never fires for a design_page doc", () => {
        expect(rules(lint([heading("h1")]))).not.toContain("template-no-outlets")
    })
})

// --- Phase D: unknown-token severity by publication state (DD2) -------------------------------------

describe("lintDesign — unknown-token fires on Button.variant and hardens when published", () => {
    // THEME declares no buttonVariants, so any Button.variant is a dangling reference.
    const button = { type: "Button", props: { label: "Go", href: "/x", variant: "primary" } }

    it("fires unknown-token on a Button.variant absent from the theme", () => {
        const findings = lintDesign(doc([heading("h1"), button]), THEME, TOKEN_PROPS, OUTLET_PROPS)
        const unknown = findings.filter((f) => f.rule === "unknown-token")
        expect(unknown).toHaveLength(1)
        expect(unknown[0].message).toContain("buttonVariants")
    })

    it("is a WARNING for a draft (published omitted/false) — does not block the editor", () => {
        const findings = lintDesign(doc([heading("h1"), button]), THEME, TOKEN_PROPS, OUTLET_PROPS, undefined, false)
        const unknown = findings.filter((f) => f.rule === "unknown-token")
        expect(unknown[0].severity).toBe("warning")
        expect(hasBlockingError(findings)).toBe(false)
    })

    it("is an ERROR when published — fails the build (DD2)", () => {
        const findings = lintDesign(doc([heading("h1"), button]), THEME, TOKEN_PROPS, OUTLET_PROPS, undefined, true)
        const unknown = findings.filter((f) => f.rule === "unknown-token")
        expect(unknown[0].severity).toBe("error")
        expect(hasBlockingError(findings)).toBe(true)
    })
})

describe("collectTokenUsage", () => {
    it("maps each token reference to the distinct design labels using it", () => {
        const docs = [
            { label: "Home", doc: doc([{ type: "Section", props: { background: "accent", paddingY: "md", content: [heading("h1")] } }]) },
            {
                label: "About",
                doc: doc([
                    { type: "Section", props: { background: "accent", paddingY: "sm", content: [] } },
                    { type: "Button", props: { label: "Go", href: "/x", variant: "primary" } }
                ])
            }
        ]
        const usage = collectTokenUsage(docs, TOKEN_PROPS)
        expect(usage.get("colors:accent")).toEqual(["Home", "About"])
        expect(usage.get("space:md")).toEqual(["Home"])
        expect(usage.get("typography:display")).toEqual(["Home"])
        expect(usage.get("space:sm")).toEqual(["About"])
        expect(usage.get("buttonVariants:primary")).toEqual(["About"])
        expect(usage.get("colors:missing")).toBeUndefined()
    })

    it("records a label once per token even when it references it twice (and recurses into slots)", () => {
        const twice = doc([
            { type: "Section", props: { background: "accent", paddingY: "md", content: [{ type: "Divider", props: { spaceAround: "md", color: "accent" } }] } }
        ])
        const usage = collectTokenUsage([{ label: "Dup", doc: twice }], TOKEN_PROPS)
        expect(usage.get("colors:accent")).toEqual(["Dup"])
    })

    it("skips empty ('') token props (the None option)", () => {
        const withNone = doc([{ type: "Section", props: { background: "", paddingY: "md", content: [] } }])
        const usage = collectTokenUsage([{ label: "X", doc: withNone }], TOKEN_PROPS)
        expect(usage.has("colors:")).toBe(false)
        expect(usage.get("space:md")).toEqual(["X"])
    })
})
