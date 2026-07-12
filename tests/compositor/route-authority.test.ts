/**
 * tests/compositor/route-authority.test.ts
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

import { collectRoutes } from "../../src/lib/build/route-authority"
import { TEMPLATE_NONE_SLUG, type BuildDesignPage, type BuildTemplate } from "../../src/lib/build/design-api"
import type { BuildPage } from "../../src/lib/build/emdash-api"
import type { DesignDoc } from "../../src/lib/compositor/types"

function doc(): DesignDoc {
    return { schemaVersion: 1, puck: { root: { props: {} }, content: [] } }
}

function page(slug: string, overrides: Partial<BuildPage> = {}): BuildPage {
    return {
        id: `page-${slug}`,
        slug,
        title: `Page ${slug}`,
        description: "",
        content: [],
        published_at: null,
        fields: { title: `Page ${slug}`, content: [] },
        designRef: null,
        ...overrides
    }
}

function designPage(slug: string): BuildDesignPage {
    return { slug, title: `Design ${slug}`, description: "", doc: doc() }
}

function template(id: string, overrides: Partial<BuildTemplate> = {}): BuildTemplate {
    return { id, slug: `tpl-${id}`, title: `Template ${id}`, collection: "pages", isDefault: false, doc: doc(), ...overrides }
}

const NONE = template("none-id", { slug: TEMPLATE_NONE_SLUG, title: "None (plain article)" })

describe("collectRoutes — merging the two sources", () => {
    it("emits one route per slug, portable pages before design pages", () => {
        const { routes } = collectRoutes({ pages: [page("about")], designPages: [designPage("gallery")], templates: [] })

        expect(routes.map((route) => route.slug)).toEqual(["about", "gallery"])
        expect(routes[0].props.kind).toBe("portable")
        expect(routes[1].props.kind).toBe("design")
    })

    it("carries the props each kind renders from", () => {
        const { routes } = collectRoutes({ pages: [page("about")], designPages: [designPage("gallery")], templates: [] })

        const portable = routes[0].props
        if (portable.kind !== "portable") throw new Error("expected a portable route")
        expect(portable.title).toBe("Page about")
        expect(portable.published_at).toBeNull()

        const design = routes[1].props
        if (design.kind !== "design") throw new Error("expected a design route")
        expect(design.title).toBe("Design gallery")
        expect(design.doc.schemaVersion).toBe(1)
    })

    it("gives a design_page a null entry and template — it has no content record behind it", () => {
        const { routes } = collectRoutes({ pages: [], designPages: [designPage("gallery")], templates: [] })

        const design = routes[0].props
        if (design.kind !== "design") throw new Error("expected a design route")
        expect(design.entry).toBeNull()
        expect(design.template).toBeNull()
    })

    it("accepts empty sources", () => {
        expect(collectRoutes({ pages: [], designPages: [], templates: [] })).toEqual({ routes: [], warnings: [] })
    })

    it("does not treat distinct slugs as collisions", () => {
        expect(() =>
            collectRoutes({ pages: [page("a"), page("b")], designPages: [designPage("c")], templates: [] })
        ).not.toThrow()
    })
})

describe("collectRoutes — D4 template resolution", () => {
    it("renders an entry through the template its design field names", () => {
        const tpl = template("t1")
        const { routes, warnings } = collectRoutes({
            pages: [page("about", { designRef: "t1" })],
            designPages: [],
            templates: [tpl]
        })

        const props = routes[0].props
        if (props.kind !== "design") throw new Error("expected a design route")
        expect(props.doc).toBe(tpl.doc)
        expect(props.entry).toEqual({ title: "Page about", content: [] })
        expect(props.template).toEqual({ slug: tpl.slug, collection: tpl.collection })
        expect(warnings).toEqual([])
    })

    it("falls back to the collection's default template when the entry names none", () => {
        const fallback = template("t-default", { isDefault: true })
        const { routes } = collectRoutes({ pages: [page("about")], designPages: [], templates: [fallback] })

        const props = routes[0].props
        if (props.kind !== "design") throw new Error("expected a design route")
        expect(props.doc).toBe(fallback.doc)
    })

    it("prefers the entry's explicit template over the collection default", () => {
        const chosen = template("t-chosen")
        const fallback = template("t-default", { isDefault: true })
        const { routes } = collectRoutes({
            pages: [page("about", { designRef: "t-chosen" })],
            designPages: [],
            templates: [chosen, fallback]
        })

        const props = routes[0].props
        if (props.kind !== "design") throw new Error("expected a design route")
        expect(props.doc).toBe(chosen.doc)
    })

    it("renders bare (D3) when there is no reference and no default", () => {
        const { routes } = collectRoutes({ pages: [page("about")], designPages: [], templates: [template("t1")] })

        expect(routes[0].props.kind).toBe("portable")
    })

    it("ignores a default template belonging to another collection", () => {
        const postsDefault = template("t-posts", { collection: "posts", isDefault: true })
        const { routes } = collectRoutes({ pages: [page("about")], designPages: [], templates: [postsDefault] })

        expect(routes[0].props.kind).toBe("portable")
    })
})

describe("collectRoutes — a broken reference falls soft to D3", () => {
    it("renders bare and warns when the named template is not published", () => {
        const { routes, warnings } = collectRoutes({
            pages: [page("about", { designRef: "ghost" })],
            designPages: [],
            templates: []
        })

        expect(routes[0].props.kind).toBe("portable")
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toContain("about")
        expect(warnings[0]).toContain("ghost")
    })

    it("does NOT silently substitute the collection default for a broken reference", () => {
        const fallback = template("t-default", { isDefault: true })
        const { routes, warnings } = collectRoutes({
            pages: [page("about", { designRef: "ghost" })],
            designPages: [],
            templates: [fallback]
        })

        // The author chose a specific layout; quietly rendering a different one hides the breakage.
        expect(routes[0].props.kind).toBe("portable")
        expect(warnings).toHaveLength(1)
    })
})

describe("collectRoutes — the None sentinel opts an entry out", () => {
    it("renders bare when the entry references the sentinel", () => {
        const fallback = template("t-default", { isDefault: true })
        const { routes, warnings } = collectRoutes({
            pages: [page("about", { designRef: NONE.id })],
            designPages: [],
            templates: [NONE, fallback]
        })

        expect(routes[0].props.kind).toBe("portable")
        expect(warnings).toEqual([])
    })

    it("renders bare when the sentinel is itself the collection default", () => {
        const { routes } = collectRoutes({
            pages: [page("about")],
            designPages: [],
            templates: [template(NONE.id, { slug: TEMPLATE_NONE_SLUG, isDefault: true })]
        })

        expect(routes[0].props.kind).toBe("portable")
    })

    it("is exempt from the collection-mismatch check — one sentinel serves every collection", () => {
        const sentinel = template("none-id", { slug: TEMPLATE_NONE_SLUG, collection: "posts" })
        expect(() =>
            collectRoutes({ pages: [page("about", { designRef: "none-id" })], designPages: [], templates: [sentinel] })
        ).not.toThrow()
    })
})

describe("collectRoutes — authored-wrong pairings fail the build", () => {
    it("throws when an entry names a template that renders another collection", () => {
        const postsTemplate = template("t-posts", { collection: "posts" })
        expect(() =>
            collectRoutes({
                pages: [page("about", { designRef: "t-posts" })],
                designPages: [],
                templates: [postsTemplate]
            })
        ).toThrow(/renders posts entries/)
    })

    it("throws when two published templates default the same collection", () => {
        expect(() =>
            collectRoutes({
                pages: [],
                designPages: [],
                templates: [
                    template("t1", { isDefault: true }),
                    template("t2", { isDefault: true })
                ]
            })
        ).toThrow(/two default templates/)
    })

    it("allows one default per collection", () => {
        expect(() =>
            collectRoutes({
                pages: [],
                designPages: [],
                templates: [
                    template("t1", { isDefault: true }),
                    template("t2", { collection: "posts", isDefault: true })
                ]
            })
        ).not.toThrow()
    })
})

describe("collectRoutes — duplicate slugs fail the build", () => {
    it("throws when a design page claims a slug an existing page owns", () => {
        expect(() =>
            collectRoutes({ pages: [page("about")], designPages: [designPage("about")], templates: [] })
        ).toThrow(/duplicate slug/i)
    })

    it("names the offending slug and both claimants", () => {
        expect(() =>
            collectRoutes({ pages: [page("about")], designPages: [designPage("about")], templates: [] })
        ).toThrow(/"about" claimed 2× by pages, design_page/)
    })

    it("catches a collision within a single source", () => {
        expect(() =>
            collectRoutes({ pages: [], designPages: [designPage("dup"), designPage("dup")], templates: [] })
        ).toThrow(/"dup" claimed 2× by design_page, design_page/)
    })

    it("reports every collision at once, not just the first", () => {
        let message = ""
        try {
            collectRoutes({
                pages: [page("one"), page("two"), page("ok")],
                designPages: [designPage("one"), designPage("two")],
                templates: []
            })
        } catch (error) {
            message = error instanceof Error ? error.message : String(error)
        }

        expect(message).toMatch(/2 duplicate slug/)
        expect(message).toContain('"one"')
        expect(message).toContain('"two"')
        expect(message).not.toContain('"ok"')
    })
})
