/**
 * lib/build/route-authority.ts
 *
 * Single authority for what the public catch-all route builds (impl §6.6). Two CMS collections now feed
 * `pages/[...slug].astro` — the Portable-Text `pages` type and the compositor's `design_page` type — and
 * nothing in EmDash stops an author from giving a design page the same slug as an existing page.
 *
 * Two URLs cannot both own one path, and picking a winner silently would mean an author's published page
 * vanishes with no signal. So a duplicate slug **fails the build**, naming every collision at once (not
 * just the first) so one build reveals the full extent of the problem (decision 5).
 *
 * The `home` → `/` mapping is NOT applied here: this module decides slug ownership, and the route file
 * owns the param shape (an undefined rest-param is what Astro routes to "/"). Both sources normalize
 * their slugs through `emdash-api.ts`'s `normalizeSlug`, so the comparison below is apples to apples.
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

import type { DesignDoc } from "../compositor/types"
import type { BuildDesignPage } from "./design-api"
import type { BuildPage } from "./emdash-api"

/**
 * What the route renders for one slug. `kind` is the discriminant the template switches on: a Portable
 * Text article (the pre-compositor behavior, unchanged) or a composed design document.
 */
export type RouteProps =
    | { kind: "portable"; title: string; description: string; published_at: string | null; content: unknown }
    | { kind: "design"; title: string; description: string; doc: DesignDoc }

/** One route the build will emit: the owning slug and the props that render it. */
export interface RouteEntry {
    /** normalized, no leading/trailing slash; "home" is still literal here (the route maps it to "/") */
    slug: string
    props: RouteProps
}

/** The two published route sources, already read and normalized by the build API readers. */
export interface RouteSources {
    pages: BuildPage[]
    designPages: BuildDesignPage[]
}

/** Human name for a source, used only in the duplicate-slug error. */
type SourceName = "pages" | "design_page"

/**
 * Merges the published route sources into one route table, failing the build on any duplicate slug.
 *
 * @param {RouteSources} sources - the published Portable-Text pages and design pages
 * @returns {RouteEntry[]} - one entry per slug: portable pages first, then design pages
 * @throws {Error} when any slug is claimed more than once, listing every collision and its claimants
 */
export function collectRoutes({ pages, designPages }: RouteSources): RouteEntry[] {
    // Track every claimant per slug (not just "seen"), so the error can name who collided with whom.
    const claimants = new Map<string, SourceName[]>()
    const claim = (slug: string, source: SourceName) => {
        const existing = claimants.get(slug)
        if (existing) existing.push(source)
        else claimants.set(slug, [source])
    }

    const routes: RouteEntry[] = []

    for (const page of pages) {
        claim(page.slug, "pages")
        routes.push({
            slug: page.slug,
            props: {
                kind: "portable",
                title: page.title,
                description: page.description,
                published_at: page.published_at,
                content: page.content
            }
        })
    }

    for (const designPage of designPages) {
        claim(designPage.slug, "design_page")
        routes.push({
            slug: designPage.slug,
            props: {
                kind: "design",
                title: designPage.title,
                description: designPage.description,
                doc: designPage.doc
            }
        })
    }

    const duplicates = [...claimants.entries()].filter(([, sources]) => sources.length > 1)
    if (duplicates.length > 0) {
        const detail = duplicates
            .map(([slug, sources]) => `  "${slug || "(home)"}" claimed ${sources.length}× by ${sources.join(", ")}`)
            .join("\n")
        throw new Error(
            `[build/route-authority] ${duplicates.length} duplicate slug(s); a path cannot have two owners:\n` +
                `${detail}\n` +
                "Change or unpublish one of each pair, then rebuild."
        )
    }

    return routes
}
