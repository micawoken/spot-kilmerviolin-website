/**
 * lib/build/route-authority.ts
 *
 * Single authority for what the public catch-all route builds (impl §6.6, amended by the content-routing
 * pivot). It answers two questions for every published slug: **who owns this path**, and **what layout
 * does it render through**.
 *
 * Ownership. Two CMS collections claim routes — the Portable-Text `pages` type and the compositor's
 * `design_page` type — and nothing in EmDash stops an author from giving a design page the same slug as
 * an existing page. Two URLs cannot both own one path, and picking a winner silently would mean an
 * author's published page vanishes with no signal. So a duplicate slug **fails the build**, naming every
 * collision at once (not just the first) so one build reveals the full extent of the problem.
 *
 * Layout (the pivot's D4). Content owns the URL; a `design_template` is a layout that content flows
 * *through*. Per entry, in order:
 *
 *   1. the template its `design` reference names (`designRef`, an item id), else
 *   2. the published template that is its collection's `isDefault`, else
 *   3. no template — the entry renders exactly as it does today (D3: article, auto <h1>, Portable Text).
 *
 * Fail-soft vs fail-loud is split deliberately. A *publication-state* problem (the named template is a
 * draft, or was deleted) falls back to D3 with a warning — never to the collection default, because the
 * author chose a specific layout and quietly substituting a different one is worse than rendering bare.
 * An *authored-wrong* problem (a template pointed at another collection's entries; two templates
 * defaulting one collection) fails the build: no fallback can be right.
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
import { TEMPLATE_NONE_SLUG, type BuildDesignPage, type BuildTemplate, type TemplateCollection } from "./design-api"
import type { BuildPage } from "./emdash-api"

/**
 * What the route renders for one slug. `kind` is the discriminant the template switches on: a Portable
 * Text article (the pre-compositor behavior, unchanged) or a composed design document.
 */
export type RouteProps =
    | { kind: "portable"; title: string; description: string; published_at: string | null; content: unknown }
    | {
          kind: "design"
          title: string
          description: string
          doc: DesignDoc
          /**
           * The routed entry's field record, which the design's outlets read through the config context
           * (D7). Null for a `design_page`, whose content is inline: it has no entry behind it, and an
           * outlet placed in one is a lint error rather than a render-time concern.
           */
          entry: Record<string, unknown> | null
      }

/** One route the build will emit: the owning slug and the props that render it. */
export interface RouteEntry {
    /** normalized, no leading/trailing slash; "home" is still literal here (the route maps it to "/") */
    slug: string
    props: RouteProps
}

/** The published route sources and the templates they may render through, as read by the build APIs. */
export interface RouteSources {
    pages: BuildPage[]
    designPages: BuildDesignPage[]
    templates: BuildTemplate[]
}

/**
 * The resolved route table. `warnings` carries the fail-soft findings (a broken template reference) for
 * the caller to log — this module stays pure so it can be unit-tested without a console.
 */
export interface RouteTable {
    routes: RouteEntry[]
    warnings: string[]
}

/** Human name for a source, used only in the duplicate-slug error. */
type SourceName = "pages" | "design_page"

/** The sentinel template means "render bare" (D3), not "render through a layout". */
function isNoneSentinel(template: BuildTemplate): boolean {
    return template.slug === TEMPLATE_NONE_SLUG
}

/**
 * Indexes the published templates by id and by the collection each one defaults, rejecting an ambiguous
 * default: if two published templates both claim `isDefault` for one collection, no rule can choose
 * between them, and every entry of that collection would render through a coin-flip.
 */
function indexTemplates(templates: BuildTemplate[]): {
    byId: Map<string, BuildTemplate>
    defaults: Map<TemplateCollection, BuildTemplate>
} {
    const byId = new Map<string, BuildTemplate>()
    const defaults = new Map<TemplateCollection, BuildTemplate>()
    const rivals = new Map<TemplateCollection, string[]>()

    for (const template of templates) {
        byId.set(template.id, template)
        if (!template.isDefault) continue
        const claimed = rivals.get(template.collection) ?? []
        claimed.push(template.slug)
        rivals.set(template.collection, claimed)
        if (!defaults.has(template.collection)) defaults.set(template.collection, template)
    }

    const ambiguous = [...rivals.entries()].filter(([, slugs]) => slugs.length > 1)
    if (ambiguous.length > 0) {
        const detail = ambiguous
            .map(([collection, slugs]) => `  "${collection}" defaulted by ${slugs.length}×: ${slugs.join(", ")}`)
            .join("\n")
        throw new Error(
            "[build/route-authority] a collection cannot have two default templates:\n" +
                `${detail}\n` +
                "Clear isDefault on all but one of each, then rebuild."
        )
    }

    return { byId, defaults }
}

/**
 * Resolves the template one entry renders through, per D4. Returns null when the entry renders bare —
 * because it names no template, because its collection has no default, or because either resolves to the
 * "None" sentinel.
 *
 * @throws {Error} when the entry's named template renders a different collection (authored wrong)
 */
function resolveTemplate(
    entry: BuildPage,
    collection: TemplateCollection,
    index: ReturnType<typeof indexTemplates>,
    warnings: string[]
): BuildTemplate | null {
    if (entry.designRef) {
        const named = index.byId.get(entry.designRef)
        if (!named) {
            // Draft, deleted, or garbage. Fall to D3 — NOT to the collection default: the author chose a
            // specific layout, and silently substituting another one hides the breakage.
            warnings.push(
                `[build/route-authority] "${entry.slug}" names design template ${entry.designRef}, which is ` +
                    "not published (draft, deleted, or an invalid reference). The page renders without a " +
                    "design; publish the template or clear the field."
            )
            return null
        }
        if (isNoneSentinel(named)) return null
        if (named.collection !== collection) {
            throw new Error(
                `[build/route-authority] "${entry.slug}" (in ${collection}) names design template ` +
                    `"${named.slug}", which renders ${named.collection} entries. A template's outlets bind ` +
                    "to its own collection's fields, so it cannot render this entry. Point the page at a " +
                    `${collection} template, or change the template's collection.`
            )
        }
        return named
    }

    const fallback = index.defaults.get(collection)
    if (!fallback || isNoneSentinel(fallback)) return null
    return fallback
}

/**
 * Merges the published route sources into one route table: every entry resolved to the layout it renders
 * through (D4), with duplicate slugs failing the build.
 *
 * @param {RouteSources} sources - the published pages, design pages, and design templates
 * @returns {RouteTable} - one route per slug (pages first, then design pages) plus fail-soft warnings
 * @throws {Error} when a slug is claimed twice, a collection has two default templates, or an entry names
 *   a template belonging to another collection
 */
export function collectRoutes({ pages, designPages, templates }: RouteSources): RouteTable {
    const index = indexTemplates(templates)
    const warnings: string[] = []

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
        const template = resolveTemplate(page, "pages", index, warnings)
        routes.push({
            slug: page.slug,
            props: template
                ? {
                      kind: "design",
                      title: page.title,
                      description: page.description,
                      doc: template.doc,
                      entry: page.fields
                  }
                : {
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
                doc: designPage.doc,
                entry: null
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

    return { routes, warnings }
}
