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
import type { BuildDesignPage } from "../../src/lib/build/design-api"
import type { BuildPage } from "../../src/lib/build/emdash-api"

function page(slug: string): BuildPage {
    return { slug, title: `Page ${slug}`, description: "", content: [], published_at: null }
}

function designPage(slug: string): BuildDesignPage {
    return {
        slug,
        title: `Design ${slug}`,
        description: "",
        doc: { schemaVersion: 1, puck: { root: { props: {} }, content: [] } }
    }
}

describe("collectRoutes — merging the two sources", () => {
    it("emits one route per slug, portable pages before design pages", () => {
        const routes = collectRoutes({ pages: [page("about")], designPages: [designPage("gallery")] })

        expect(routes.map((route) => route.slug)).toEqual(["about", "gallery"])
        expect(routes[0].props.kind).toBe("portable")
        expect(routes[1].props.kind).toBe("design")
    })

    it("carries the props each kind renders from", () => {
        const routes = collectRoutes({ pages: [page("about")], designPages: [designPage("gallery")] })

        const portable = routes[0].props
        if (portable.kind !== "portable") throw new Error("expected a portable route")
        expect(portable.title).toBe("Page about")
        expect(portable.published_at).toBeNull()

        const design = routes[1].props
        if (design.kind !== "design") throw new Error("expected a design route")
        expect(design.title).toBe("Design gallery")
        expect(design.doc.schemaVersion).toBe(1)
    })

    it("accepts empty sources", () => {
        expect(collectRoutes({ pages: [], designPages: [] })).toEqual([])
    })

    it("does not treat distinct slugs as collisions", () => {
        expect(() =>
            collectRoutes({ pages: [page("a"), page("b")], designPages: [designPage("c")] })
        ).not.toThrow()
    })
})

describe("collectRoutes — duplicate slugs fail the build", () => {
    it("throws when a design page claims a slug an existing page owns", () => {
        expect(() => collectRoutes({ pages: [page("about")], designPages: [designPage("about")] })).toThrow(
            /duplicate slug/i
        )
    })

    it("names the offending slug and both claimants", () => {
        expect(() =>
            collectRoutes({ pages: [page("about")], designPages: [designPage("about")] })
        ).toThrow(/"about" claimed 2× by pages, design_page/)
    })

    it("catches a collision within a single source", () => {
        expect(() =>
            collectRoutes({ pages: [], designPages: [designPage("dup"), designPage("dup")] })
        ).toThrow(/"dup" claimed 2× by design_page, design_page/)
    })

    it("reports every collision at once, not just the first", () => {
        let message = ""
        try {
            collectRoutes({
                pages: [page("one"), page("two"), page("ok")],
                designPages: [designPage("one"), designPage("two")]
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
