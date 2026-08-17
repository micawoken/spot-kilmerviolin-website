/**
 * lib/build/route-authority.ts
 *
 * Single authority for what the public catch-all route builds
 *
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

import type { DesignDoc } from "../compositor/types"
import { TEMPLATE_NONE_SLUG, type BuildDesignPage, type BuildTemplate, type TemplateCollection } from "./design-api"
import type { BuildPage } from "./emdash-api"

/**
 * What the route renders for one slug
 */
export type RouteProps =
    | {
          kind: "portable"
          title: string
          description: string
          published_at: string | null
          content: unknown
          /** Raw `featured_image` field value (an EmDash media object), not yet resolved to a URL */
          image: unknown
      }
    | {
          kind: "design"
          title: string
          description: string
          doc: DesignDoc
          /** Entry's field record, read by the design's outlets via config context (D7) */
          entry: Record<string, unknown> | null
          /** Template this entry renders through */
          template: { slug: string; collection: TemplateCollection } | null
          /** Same `featured_image` field as the portable branch - a `design_page` has no entry behind it
           * (no EmDash `fields` record), so this is always `undefined` there. */
          image: unknown
      }

/**
 * One route the build will emit: the owning slug and the props that render it.
 */
export interface RouteEntry {
    /** normalized, no leading/trailing slash; "home" is still literal here (the route maps it to "/") */
    slug: string
    props: RouteProps
}

/** The published route sources and the templates they may render through, as read by the build APIs. */
export interface RouteSources {
    pages: BuildPage[]
    posts: BuildPage[]
    designPages: BuildDesignPage[]
    templates: BuildTemplate[]
}

/**
 * The resolved route table. `warnings` carries fail-soft findings (broken template reference) for the
 * caller to log - module stays pure, unit-testable without a console.
 */
export interface RouteTable {
    routes: RouteEntry[]
    warnings: string[]
}

/** Human name for a source, used only in the duplicate-slug error. */
type SourceName = TemplateCollection | "design_page"

/**
 * Posts route under a `/posts/` prefix
 */
export const POSTS_PREFIX = "posts"

/** The public path a routed entry claims: the post prefix applied, or a page's slug as authored. */
function routedSlug(collection: TemplateCollection, slug: string): string {
    return collection === "posts" ? `${POSTS_PREFIX}/${slug}` : slug
}

/** The sentinel template means "render bare" (D3), not "render through a layout". */
function isNoneSentinel(template: BuildTemplate): boolean {
    return template.slug === TEMPLATE_NONE_SLUG
}

/**
 * Indexes published templates by id, by slug, by each one's defaulted collection
 */
function indexTemplates(templates: BuildTemplate[]): {
    byId: Map<string, BuildTemplate>
    bySlug: Map<string, BuildTemplate>
    defaults: Map<TemplateCollection, BuildTemplate>
} {
    const byId = new Map<string, BuildTemplate>()
    const bySlug = new Map<string, BuildTemplate>()
    const defaults = new Map<TemplateCollection, BuildTemplate>()
    const rivals = new Map<TemplateCollection, string[]>()

    for (const template of templates) {
        byId.set(template.id, template)
        bySlug.set(template.slug, template)
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
                "Clear is_default on all but one of each, then rebuild."
        )
    }

    return { byId, bySlug, defaults }
}

/**
 * Resolves the template one entry renders through
 */
function resolveTemplate(
    entry: BuildPage,
    collection: TemplateCollection,
    slug: string,
    index: ReturnType<typeof indexTemplates>,
    warnings: string[]
): BuildTemplate | null {
    if (entry.designRef) {
        // Pointer holds either the template's slug (what an author types) or its EmDash-native item
        // id - disjoint key spaces, one lookup resolves whichever was stored, no migration needed.
        const named = index.byId.get(entry.designRef) ?? index.bySlug.get(entry.designRef)
        if (!named) {
            // Draft, deleted, or garbage. Fall to D3, NOT the collection default - author chose a
            // specific layout, silently substituting another hides the breakage.
            warnings.push(
                `[build/route-authority] "${slug}" names design template "${entry.designRef}", which is ` +
                    "not published (draft, deleted, or an invalid slug/id reference). The page renders " +
                    "without a design; publish the template or clear the field."
            )
            return null
        }
        if (isNoneSentinel(named)) return null
        if (named.collection !== collection) {
            throw new Error(
                `[build/route-authority] "${slug}" (in ${collection}) names design template ` +
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

/** One crumb in a breadcrumb trail: `href: null` renders as plain (unlinked) text - see {@link breadcrumbAncestors}. */
export interface BreadcrumbAncestor {
    label: string
    href: string | null
}

/**
 * Auto-derives the breadcrumb *ancestor* chain for a routed slug
 */
export function breadcrumbAncestors(routes: RouteEntry[], slug: string): BreadcrumbAncestor[] {
    if (slug.startsWith(`${POSTS_PREFIX}/`)) {
        return [{ label: "Posts", href: null }]
    }
    const titleBySlug = new Map(routes.map((route) => [route.slug, route.props.title]))
    const segments = slug.split("/").filter((segment) => segment.length > 0)
    const ancestors: BreadcrumbAncestor[] = []
    for (let depth = 1; depth < segments.length; depth++) {
        const prefix = segments.slice(0, depth).join("/")
        const title = titleBySlug.get(prefix)
        if (title === undefined) break
        ancestors.push({ label: title, href: `/${prefix}` })
    }
    return ancestors
}

/**
 * Merges the published route sources into one route table
 */
export function collectRoutes({ pages, posts, designPages, templates }: RouteSources): RouteTable {
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

    const routeEntry = (entry: BuildPage, collection: TemplateCollection) => {
        const slug = routedSlug(collection, entry.slug)
        claim(slug, collection)
        const template = resolveTemplate(entry, collection, slug, index, warnings)
        routes.push({
            slug,
            props: template
                ? {
                      kind: "design",
                      title: entry.title,
                      description: entry.description,
                      doc: template.doc,
                      entry: entry.fields,
                      template: { slug: template.slug, collection: template.collection },
                      image: entry.fields.featured_image
                  }
                : {
                      kind: "portable",
                      title: entry.title,
                      description: entry.description,
                      published_at: entry.published_at,
                      content: entry.content,
                      image: entry.fields.featured_image
                  }
        })
    }

    for (const page of pages) routeEntry(page, "pages")
    for (const post of posts) routeEntry(post, "posts")

    for (const designPage of designPages) {
        claim(designPage.slug, "design_page")
        routes.push({
            slug: designPage.slug,
            props: {
                kind: "design",
                title: designPage.title,
                description: designPage.description,
                doc: designPage.doc,
                entry: null,
                template: null,
                image: undefined
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
