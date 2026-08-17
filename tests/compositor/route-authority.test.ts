/**
 * tests/compositor/route-authority.test.ts
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

import { breadcrumbAncestors, collectRoutes } from "../../src/lib/build/route-authority"
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

/**
 * A published `posts` entry. Same {@link BuildPage} shape as a page - the reader normalizes the
 * collections' differing field names - so what distinguishes a post here is purely which source array it
 * arrives in, which is exactly the property these tests exercise.
 */
function post(slug: string, overrides: Partial<BuildPage> = {}): BuildPage {
    return {
        id: `post-${slug}`,
        slug,
        title: `Post ${slug}`,
        description: "",
        content: [],
        published_at: null,
        fields: { title: `Post ${slug}`, content: [] },
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

describe("collectRoutes - merging the two sources", () => {
    it("emits one route per slug, portable pages before design pages", () => {
        const { routes } = collectRoutes({
            pages: [page("about")],
            posts: [],
            designPages: [designPage("gallery")],
            templates: []
        })

        expect(routes.map((route) => route.slug)).toEqual(["about", "gallery"])
        expect(routes[0].props.kind).toBe("portable")
        expect(routes[1].props.kind).toBe("design")
    })

    it("carries the props each kind renders from", () => {
        const { routes } = collectRoutes({
            pages: [page("about")],
            posts: [],
            designPages: [designPage("gallery")],
            templates: []
        })

        const portable = routes[0].props
        if (portable.kind !== "portable") throw new Error("expected a portable route")
        expect(portable.title).toBe("Page about")
        expect(portable.published_at).toBeNull()

        const design = routes[1].props
        if (design.kind !== "design") throw new Error("expected a design route")
        expect(design.title).toBe("Design gallery")
        expect(design.doc.schemaVersion).toBe(1)
    })

    it("gives a design_page a null entry and template - it has no content record behind it", () => {
        const { routes } = collectRoutes({ pages: [], posts: [], designPages: [designPage("gallery")], templates: [] })

        const design = routes[0].props
        if (design.kind !== "design") throw new Error("expected a design route")
        expect(design.entry).toBeNull()
        expect(design.template).toBeNull()
    })

    it("carries a portable entry's featured_image field through as props.image", () => {
        const { routes } = collectRoutes({
            pages: [page("about", { fields: { title: "Page about", content: [], featured_image: "/files/hero.jpg" } })],
            posts: [],
            designPages: [],
            templates: []
        })

        const portable = routes[0].props
        if (portable.kind !== "portable") throw new Error("expected a portable route")
        expect(portable.image).toBe("/files/hero.jpg")
    })

    it("gives a design_page's props.image undefined - no EmDash entry, no featured_image field", () => {
        const { routes } = collectRoutes({ pages: [], posts: [], designPages: [designPage("gallery")], templates: [] })

        const design = routes[0].props
        if (design.kind !== "design") throw new Error("expected a design route")
        expect(design.image).toBeUndefined()
    })

    it("accepts empty sources", () => {
        expect(collectRoutes({ pages: [], posts: [], designPages: [], templates: [] })).toEqual({
            routes: [],
            warnings: []
        })
    })

    it("does not treat distinct slugs as collisions", () => {
        expect(() =>
            collectRoutes({ pages: [page("a"), page("b")], posts: [], designPages: [designPage("c")], templates: [] })
        ).not.toThrow()
    })
})

describe("collectRoutes - D4 template resolution", () => {
    it("renders an entry through the template its design field names", () => {
        const tpl = template("t1")
        const { routes, warnings } = collectRoutes({
            pages: [page("about", { designRef: "t1" })],
            posts: [],
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

    it("carries a templated entry's featured_image field through as props.image", () => {
        const tpl = template("t1")
        const { routes } = collectRoutes({
            pages: [
                page("about", {
                    designRef: "t1",
                    fields: { title: "Page about", content: [], featured_image: "/files/hero.jpg" }
                })
            ],
            posts: [],
            designPages: [],
            templates: [tpl]
        })

        const props = routes[0].props
        if (props.kind !== "design") throw new Error("expected a design route")
        expect(props.image).toBe("/files/hero.jpg")
    })

    it("resolves the design pointer by the template's slug, not only its id", () => {
        // EmDash's reference field is a raw text box, so authors type the readable slug ("tpl-t1"), not
        // the opaque id ("t1"). Both must resolve; this covers the slug path (the id path is above)
        const tpl = template("t1")
        const { routes, warnings } = collectRoutes({
            pages: [page("about", { designRef: tpl.slug })],
            posts: [],
            designPages: [],
            templates: [tpl]
        })

        const props = routes[0].props
        if (props.kind !== "design") throw new Error("expected a design route")
        expect(props.doc).toBe(tpl.doc)
        expect(props.template).toEqual({ slug: tpl.slug, collection: tpl.collection })
        expect(warnings).toEqual([])
    })

    it("falls back to the collection's default template when the entry names none", () => {
        const fallback = template("t-default", { isDefault: true })
        const { routes } = collectRoutes({ pages: [page("about")], posts: [], designPages: [], templates: [fallback] })

        const props = routes[0].props
        if (props.kind !== "design") throw new Error("expected a design route")
        expect(props.doc).toBe(fallback.doc)
    })

    it("prefers the entry's explicit template over the collection default", () => {
        const chosen = template("t-chosen")
        const fallback = template("t-default", { isDefault: true })
        const { routes } = collectRoutes({
            pages: [page("about", { designRef: "t-chosen" })],
            posts: [],
            designPages: [],
            templates: [chosen, fallback]
        })

        const props = routes[0].props
        if (props.kind !== "design") throw new Error("expected a design route")
        expect(props.doc).toBe(chosen.doc)
    })

    it("renders bare (D3) when there is no reference and no default", () => {
        const { routes } = collectRoutes({
            pages: [page("about")],
            posts: [],
            designPages: [],
            templates: [template("t1")]
        })

        expect(routes[0].props.kind).toBe("portable")
    })

    it("ignores a default template belonging to another collection", () => {
        const postsDefault = template("t-posts", { collection: "posts", isDefault: true })
        const { routes } = collectRoutes({
            pages: [page("about")],
            posts: [],
            designPages: [],
            templates: [postsDefault]
        })

        expect(routes[0].props.kind).toBe("portable")
    })
})

describe("collectRoutes - a broken reference falls soft to D3", () => {
    it("renders bare and warns when the named template is not published", () => {
        const { routes, warnings } = collectRoutes({
            pages: [page("about", { designRef: "ghost" })],
            posts: [],
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
            posts: [],
            designPages: [],
            templates: [fallback]
        })

        // The author chose a specific layout; quietly rendering a different one hides the breakage.
        expect(routes[0].props.kind).toBe("portable")
        expect(warnings).toHaveLength(1)
    })
})

describe("collectRoutes - the None sentinel opts an entry out", () => {
    it("renders bare when the entry references the sentinel", () => {
        const fallback = template("t-default", { isDefault: true })
        const { routes, warnings } = collectRoutes({
            pages: [page("about", { designRef: NONE.id })],
            posts: [],
            designPages: [],
            templates: [NONE, fallback]
        })

        expect(routes[0].props.kind).toBe("portable")
        expect(warnings).toEqual([])
    })

    it("renders bare when the sentinel is itself the collection default", () => {
        const { routes } = collectRoutes({
            pages: [page("about")],
            posts: [],
            designPages: [],
            templates: [template(NONE.id, { slug: TEMPLATE_NONE_SLUG, isDefault: true })]
        })

        expect(routes[0].props.kind).toBe("portable")
    })

    it("is exempt from the collection-mismatch check - one sentinel serves every collection", () => {
        const sentinel = template("none-id", { slug: TEMPLATE_NONE_SLUG, collection: "posts" })
        expect(() =>
            collectRoutes({
                pages: [page("about", { designRef: "none-id" })],
                posts: [],
                designPages: [],
                templates: [sentinel]
            })
        ).not.toThrow()
    })
})

describe("collectRoutes - authored-wrong pairings fail the build", () => {
    it("throws when an entry names a template that renders another collection", () => {
        const postsTemplate = template("t-posts", { collection: "posts" })
        expect(() =>
            collectRoutes({
                pages: [page("about", { designRef: "t-posts" })],
                posts: [],
                designPages: [],
                templates: [postsTemplate]
            })
        ).toThrow(/renders posts entries/)
    })

    it("throws when two published templates default the same collection", () => {
        expect(() =>
            collectRoutes({
                pages: [],
                posts: [],
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
                posts: [],
                designPages: [],
                templates: [
                    template("t1", { isDefault: true }),
                    template("t2", { collection: "posts", isDefault: true })
                ]
            })
        ).not.toThrow()
    })
})

describe("collectRoutes - duplicate slugs fail the build", () => {
    it("throws when a design page claims a slug an existing page owns", () => {
        expect(() =>
            collectRoutes({ pages: [page("about")], posts: [], designPages: [designPage("about")], templates: [] })
        ).toThrow(/duplicate slug/i)
    })

    it("names the offending slug and both claimants", () => {
        expect(() =>
            collectRoutes({ pages: [page("about")], posts: [], designPages: [designPage("about")], templates: [] })
        ).toThrow(/"about" claimed 2× by pages, design_page/)
    })

    it("catches a collision within a single source", () => {
        expect(() =>
            collectRoutes({ pages: [], posts: [], designPages: [designPage("dup"), designPage("dup")], templates: [] })
        ).toThrow(/"dup" claimed 2× by design_page, design_page/)
    })

    it("reports every collision at once, not just the first", () => {
        let message = ""
        try {
            collectRoutes({
                pages: [page("one"), page("two"), page("ok")],
                posts: [],
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

describe("collectRoutes - posts are routed under the /posts/ prefix", () => {
    it("prefixes a post's slug, and leaves a page's alone", () => {
        const { routes } = collectRoutes({
            pages: [page("about")],
            posts: [post("first")],
            designPages: [],
            templates: []
        })

        expect(routes.map((route) => route.slug)).toEqual(["about", "posts/first"])
    })

    it("renders an unpointed post bare (D3), like any other entry", () => {
        const { routes } = collectRoutes({ pages: [], posts: [post("first")], designPages: [], templates: [] })

        expect(routes[0].props.kind).toBe("portable")
    })

    it("renders a post through the posts template it names", () => {
        const tpl = template("t-posts", { collection: "posts" })
        const { routes, warnings } = collectRoutes({
            pages: [],
            posts: [post("first", { designRef: "t-posts" })],
            designPages: [],
            templates: [tpl]
        })

        const props = routes[0].props
        if (props.kind !== "design") throw new Error("expected a design route")
        expect(routes[0].slug).toBe("posts/first")
        expect(props.doc).toBe(tpl.doc)
        expect(props.template).toEqual({ slug: tpl.slug, collection: "posts" })
        expect(warnings).toEqual([])
    })

    it("renders a post through the posts collection default", () => {
        const fallback = template("t-posts", { collection: "posts", isDefault: true })
        const { routes } = collectRoutes({ pages: [], posts: [post("first")], designPages: [], templates: [fallback] })

        const props = routes[0].props
        if (props.kind !== "design") throw new Error("expected a design route")
        expect(props.doc).toBe(fallback.doc)
    })

    it("does not apply the pages default to a post", () => {
        const pagesDefault = template("t-pages", { collection: "pages", isDefault: true })
        const { routes } = collectRoutes({
            pages: [],
            posts: [post("first")],
            designPages: [],
            templates: [pagesDefault]
        })

        expect(routes[0].props.kind).toBe("portable")
    })

    it("throws when a post names a template that renders pages", () => {
        const pagesTemplate = template("t-pages", { collection: "pages" })
        expect(() =>
            collectRoutes({
                pages: [],
                posts: [post("first", { designRef: "t-pages" })],
                designPages: [],
                templates: [pagesTemplate]
            })
        ).toThrow(/renders pages entries/)
    })

    it("names the ROUTED slug in a broken-reference warning, not the bare one", () => {
        // "first" is not findable in the site; /posts/first is. The warning has to name the URL.
        const { warnings } = collectRoutes({
            pages: [],
            posts: [post("first", { designRef: "ghost" })],
            designPages: [],
            templates: []
        })

        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toContain("posts/first")
    })

    it("does not route a post named 'home' to /, which only a page may claim", () => {
        const { routes } = collectRoutes({ pages: [], posts: [post("home")], designPages: [], templates: [] })

        expect(routes[0].slug).toBe("posts/home")
    })
})

describe("breadcrumbAncestors - auto-derives the trail's ancestor crumbs", () => {
    it("gives a post the fixed, unlinked Posts ancestor regardless of the route table", () => {
        const { routes } = collectRoutes({ pages: [], posts: [post("first")], designPages: [], templates: [] })
        expect(breadcrumbAncestors(routes, "posts/first")).toEqual([{ label: "Posts", href: null }])
    })

    it("returns no ancestors for a top-level slug", () => {
        const { routes } = collectRoutes({ pages: [page("about")], posts: [], designPages: [], templates: [] })
        expect(breadcrumbAncestors(routes, "about")).toEqual([])
    })

    it("walks each prefix that resolves to a real published route", () => {
        const { routes } = collectRoutes({
            pages: [page("about"), page("about/team")],
            posts: [],
            designPages: [],
            templates: []
        })
        expect(breadcrumbAncestors(routes, "about/team")).toEqual([{ label: "Page about", href: "/about" }])
    })

    it("stops at the first prefix that does not resolve, rather than skipping the gap", () => {
        const { routes } = collectRoutes({
            pages: [page("a/b/c")],
            posts: [],
            designPages: [designPage("a/b")], // "a" itself is not published, only "a/b"
            templates: []
        })
        expect(breadcrumbAncestors(routes, "a/b/c")).toEqual([])
    })

    it("includes a deeper valid prefix once the shallower one resolves", () => {
        const { routes } = collectRoutes({
            pages: [page("a")],
            posts: [],
            designPages: [designPage("a/b"), designPage("a/b/c")],
            templates: []
        })
        expect(breadcrumbAncestors(routes, "a/b/c")).toEqual([
            { label: "Page a", href: "/a" },
            { label: "Design a/b", href: "/a/b" }
        ])
    })
})

describe("collectRoutes - the prefix keeps the collision check meaningful", () => {
    it("catches a page that claims a post's prefixed path", () => {
        // The whole reason the prefix is applied at route collection: both sources are compared on the
        // path they really own, so this is a collision rather than two silent claimants on one URL.
        expect(() =>
            collectRoutes({ pages: [page("posts/first")], posts: [post("first")], designPages: [], templates: [] })
        ).toThrow(/"posts\/first" claimed 2× by pages, posts/)
    })

    it("does not collide a post with a same-named page", () => {
        expect(() =>
            collectRoutes({ pages: [page("first")], posts: [post("first")], designPages: [], templates: [] })
        ).not.toThrow()
    })

    it("catches a collision between two posts", () => {
        expect(() =>
            collectRoutes({ pages: [], posts: [post("dup"), post("dup")], designPages: [], templates: [] })
        ).toThrow(/"posts\/dup" claimed 2× by posts, posts/)
    })
})
