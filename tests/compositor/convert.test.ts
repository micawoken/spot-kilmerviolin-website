/**
 * tests/compositor/convert.test.ts
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

import { describe, it, expect, vi } from "vitest"

import {
    designToEditorForm,
    editorFormToDesign,
    type RichTextPropRegistry
} from "../../src/lib/compositor/convert"
import { CURRENT_SCHEMA_VERSION, migrateDesign } from "../../src/lib/compositor/migrations"
import type { DesignDoc, PuckData } from "../../src/lib/compositor/types"

// Puck's richtext field's real onChange value is `editor.getHTML()` — a string. Converting it needs a
// DOM (convert.ts calls @tiptap/html's browser `generateJSON`, which parses via `window.DOMParser`) that
// this repo's Cloudflare Workers test pool cannot provide (not even happy-dom's Window can construct
// here — it needs `node:vm`'s `Script`, which workerd doesn't expose). Mocked to a deterministic
// stand-in so the "HTML string (§ Puck's actual richtext value)" tests below can verify convert.ts's
// dispatch — a string is routed through the conversion pipeline, not passed through raw — without a
// real DOM; the HTML→ProseMirror parsing itself (Puck's own @tiptap/html dependency) was verified
// separately against the real implementation via a standalone Node script outside this harness.
vi.mock("@tiptap/html", () => ({
    generateJSON: vi.fn((html: string) => ({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: html }] }]
    }))
}))

const REGISTRY: RichTextPropRegistry = { RichText: ["body"] }

// A Portable Text body exercising the round-trip extension list confirmed in spike (d): paragraphs
// with marks + a link markDef, a heading, a blockquote, bullet list items, and a code block.
const PT_BODY = [
    {
        _type: "block",
        _key: "b1",
        style: "normal",
        markDefs: [{ _type: "link", _key: "l1", href: "https://example.com", blank: false }],
        children: [
            { _type: "span", _key: "s1", text: "Hello ", marks: [] },
            { _type: "span", _key: "s2", text: "bold link", marks: ["strong", "l1"] },
            { _type: "span", _key: "s3", text: " world", marks: [] }
        ]
    },
    {
        _type: "block",
        _key: "b2",
        style: "h2",
        markDefs: [],
        children: [{ _type: "span", _key: "s4", text: "A heading", marks: [] }]
    },
    {
        _type: "block",
        _key: "b3",
        style: "blockquote",
        markDefs: [],
        children: [{ _type: "span", _key: "s5", text: "A quote", marks: [] }]
    },
    {
        _type: "block",
        _key: "b4",
        style: "normal",
        listItem: "bullet",
        level: 1,
        markDefs: [],
        children: [{ _type: "span", _key: "s6", text: "Item one", marks: [] }]
    },
    {
        _type: "block",
        _key: "b5",
        style: "normal",
        listItem: "bullet",
        level: 1,
        markDefs: [],
        children: [{ _type: "span", _key: "s7", text: "Item two", marks: [] }]
    },
    { _type: "code", _key: "c1", code: "const x = 1", language: "js" }
]

/** Builds a fresh design doc with a RichText nested inside a Section slot, plus an unknown component. */
function makeDoc(): DesignDoc {
    return {
        schemaVersion: 1,
        puck: {
            root: { props: {} },
            content: [
                {
                    type: "Section",
                    props: {
                        id: "sec-1",
                        background: "page-bg",
                        content: [
                            { type: "RichText", props: { id: "rt-1", body: structuredClone(PT_BODY) } },
                            { type: "Mystery", props: { id: "m-1", note: "leave me untouched" } }
                        ]
                    }
                }
            ]
        } as unknown as PuckData
    }
}

/** Recursively strips `_key` fields so PT can be compared semantically (keys regenerate each pass). */
function stripKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripKeys)
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {}
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
            if (key === "_key") continue
            out[key] = stripKeys(val)
        }
        return out
    }
    return value
}

/**
 * Canonicalizes a PT body for cross-pass comparison. Beyond stripping `_key`, a markDef's key and
 * the reference to it inside `span.marks` are an opaque matched pair the converter regenerates on
 * every pass (spike (d)) — so both are rewritten to a stable index-based id (`md0`, `md1`, …). Only
 * annotation references change; literal decorators (strong/em/…) are left as-is.
 */
function normalizeBody(body: unknown): unknown {
    if (!Array.isArray(body)) return stripKeys(body)
    return body.map((rawBlock) => {
        if (!rawBlock || typeof rawBlock !== "object") return rawBlock
        const block = rawBlock as Record<string, unknown>
        const markDefs = Array.isArray(block.markDefs) ? (block.markDefs as Array<Record<string, unknown>>) : []
        const keyToCanon = new Map<string, string>()
        markDefs.forEach((def, i) => {
            if (typeof def._key === "string") keyToCanon.set(def._key, `md${i}`)
        })
        const normalized = stripKeys(block) as Record<string, unknown>
        if (Array.isArray(block.children)) {
            normalized.children = (block.children as Array<Record<string, unknown>>).map((span) => {
                const s = stripKeys(span) as Record<string, unknown>
                if (Array.isArray(span.marks)) {
                    s.marks = (span.marks as string[]).map((mark) => keyToCanon.get(mark) ?? mark)
                }
                return s
            })
        }
        if (markDefs.length) {
            normalized.markDefs = markDefs.map((def, i) => ({ ...(stripKeys(def) as Record<string, unknown>), _key: `md${i}` }))
        }
        return normalized
    })
}

/** Reaches into content[0].props.content[i].props for the nested slot children. */
function slotChildren(doc: DesignDoc): Array<{ type: string; props: Record<string, unknown> }> {
    const section = (doc.puck as unknown as { content: Array<{ props: { content: unknown } }> }).content[0]
    return section.props.content as Array<{ type: string; props: Record<string, unknown> }>
}

describe("designToEditorForm", () => {
    it("converts a rich-text prop nested inside a slot to a ProseMirror document", () => {
        const editor = designToEditorForm(makeDoc(), REGISTRY)
        const richText = slotChildren(editor)[0]
        expect(richText.type).toBe("RichText")
        expect((richText.props.body as { type?: string }).type).toBe("doc")
    })

    it("leaves unknown components untouched", () => {
        const editor = designToEditorForm(makeDoc(), REGISTRY)
        const mystery = slotChildren(editor)[1]
        expect(mystery).toEqual({ type: "Mystery", props: { id: "m-1", note: "leave me untouched" } })
    })

    it("does not mutate the input document", () => {
        const doc = makeDoc()
        designToEditorForm(doc, REGISTRY)
        expect(Array.isArray(slotChildren(doc)[0].props.body)).toBe(true)
        expect(slotChildren(doc)[0].props.body).toEqual(PT_BODY)
    })
})

describe("editorFormToDesign", () => {
    it("converts the ProseMirror working value back to a Portable Text array", () => {
        const design = editorFormToDesign(designToEditorForm(makeDoc(), REGISTRY), REGISTRY)
        expect(Array.isArray(slotChildren(design)[0].props.body)).toBe(true)
    })

    it("returns the whole envelope the editor stores — so the next read can migrate it", () => {
        const design = editorFormToDesign(designToEditorForm(makeDoc(), REGISTRY), REGISTRY)
        expect(design.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
        expect(() => migrateDesign(design)).not.toThrow()
    })
})

describe("editorFormToDesign — Puck's actual richtext value (HTML string)", () => {
    // Puck's richtext field's real onChange value is `editor.getHTML()` — a string, never the
    // `{type: "doc"}` object the field's name suggests. This is what a saved editor session actually
    // hands editorFormToDesign; the ProseMirror-doc fixtures elsewhere in this file are the pre-Puck
    // shape and never caught the regression this guards. See the top-of-file vi.mock for why
    // generateJSON is stubbed rather than exercised for real.
    function docWithHtmlBody(html: string): DesignDoc {
        return {
            schemaVersion: 1,
            puck: { content: [{ type: "RichText", props: { id: "rt-1", body: html } }] } as unknown as PuckData
        }
    }

    it("routes a string body through generateJSON + prosemirrorToPortableText instead of passing it through raw", async () => {
        const { generateJSON } = await import("@tiptap/html")
        const { RICH_TEXT_EXTENSIONS } = await import("../../src/lib/compositor/richtext-extensions")
        const html = "<p>This is a <strong>bold</strong> word.</p>"

        const design = editorFormToDesign(docWithHtmlBody(html), REGISTRY)

        expect(generateJSON).toHaveBeenCalledWith(html, RICH_TEXT_EXTENSIONS)
        const body = (design.puck as unknown as { content: Array<{ props: { body: unknown } }> }).content[0].props.body
        expect(Array.isArray(body)).toBe(true)
        expect((body as Array<Record<string, unknown>>)[0]._type).toBe("block")
    })
})

describe("roundtrip stability", () => {
    it("does not drift across repeated load/save (semantic, ignoring regenerated _keys)", () => {
        const once = editorFormToDesign(designToEditorForm(makeDoc(), REGISTRY), REGISTRY)
        const twice = editorFormToDesign(designToEditorForm(once, REGISTRY), REGISTRY)
        expect(normalizeBody(slotChildren(once)[0].props.body)).toEqual(normalizeBody(slotChildren(twice)[0].props.body))
    })

    it("preserves the body's semantic content through a load/save cycle", () => {
        const design = editorFormToDesign(designToEditorForm(makeDoc(), REGISTRY), REGISTRY)
        const body = stripKeys(slotChildren(design)[0].props.body) as Array<Record<string, unknown>>
        // Block styles and code content survive; keys/defaults aside, the structure is intact.
        expect(body.map((block) => block.style ?? block._type)).toEqual(["normal", "h2", "blockquote", "normal", "normal", "code"])
        expect(body[5].code).toBe("const x = 1")
    })
})
