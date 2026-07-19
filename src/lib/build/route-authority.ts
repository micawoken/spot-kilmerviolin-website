/**
 * lib/build/route-authority.ts
 *
 * Single authority for what the public catch-all route builds (impl §6.6, amended by the content-routing
 * pivot). It answers two questions for every published slug: **who owns this path**, and **what layout
 * does it render through**.
 *
 * Ownership. Three CMS collections claim routes — the content types `pages` and `posts` (the latter under
 * a `/posts/` prefix, pivot §7.2) and the compositor's `design_page` — and nothing in EmDash stops an
 * author from giving a design page the same slug as an existing page. Two URLs cannot both own one path,
 * and picking a winner silently would mean an author's published page vanishes with no signal. So a
 * duplicate slug **fails the build**, naming every collision at once (not just the first) so one build
 * reveals the full extent of the problem.
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
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
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
          /**
           * The template this entry renders through — what the per-pairing lint names in its errors and
           * whose collection selects the schema it checks against (§5.5). Null for a `design_page`,
           * which is its own layout and is linted standalone before routes are collected.
           */
          template: { slug: string; collection: TemplateCollection } | null
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
    posts: BuildPage[]
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
type SourceName = TemplateCollection | "design_page"

/**
 * Posts are routed under a `/posts/` prefix (pivot §7.2, owner-decided), and the prefix is applied HERE —
 * at route collection — not in the reader and not in the route file. That placement is the whole point:
 * the slug this module compares is the one the URL actually has, so a `pages` entry authored with the
 * slug "posts/x" still collides with the post "x" and fails the build, instead of two sources silently
 * claiming one path.
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
 * Indexes the published templates by id, by slug, and by the collection each one defaults, rejecting an
 * ambiguous default: if two published templates both claim `isDefault` for one collection, no rule can
 * choose between them, and every entry of that collection would render through a coin-flip.
 *
 * A template is indexed by both id and slug because an entry's `design` pointer may hold either (§ D4):
 * EmDash's reference field is a raw text box, so an author types the human-readable slug ("article"),
 * while a value stored the EmDash-native way is the item id. Slugs are unique within the single
 * `design_template` collection (EmDash enforces per-collection slug uniqueness), so `bySlug` is
 * unambiguous, and the id and slug key spaces do not overlap (ids are opaque, slugs are words).
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
 * Resolves the template one entry renders through, per D4. Returns null when the entry renders bare —
 * because it names no template, because its collection has no default, or because either resolves to the
 * "None" sentinel.
 *
 * @param {BuildPage} entry - the published entry being routed
 * @param {TemplateCollection} collection - the collection it came from (which templates may render it)
 * @param {string} slug - the entry's routed slug, so a message names the URL an author can actually find
 * @throws {Error} when the entry's named template renders a different collection (authored wrong)
 */
function resolveTemplate(
    entry: BuildPage,
    collection: TemplateCollection,
    slug: string,
    index: ReturnType<typeof indexTemplates>,
    warnings: string[]
): BuildTemplate | null {
    if (entry.designRef) {
        // The pointer holds either the template's slug (what an author types into EmDash's reference text
        // box) or its EmDash-native item id. The two key spaces are disjoint, so a single lookup by both
        // resolves whichever was stored, without a migration of existing id-valued pointers.
        const named = index.byId.get(entry.designRef) ?? index.bySlug.get(entry.designRef)
        if (!named) {
            // Draft, deleted, or garbage. Fall to D3 — NOT to the collection default: the author chose a
            // specific layout, and silently substituting another one hides the breakage.
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

/** One crumb in a breadcrumb trail: `href: null` renders as plain (unlinked) text — see {@link breadcrumbAncestors}. */
export interface BreadcrumbAncestor {
    label: string
    href: string | null
}

/**
 * Auto-derives the breadcrumb *ancestor* chain for a routed slug (docs/dev/miscellaneous.txt "puck
 * components to add"): Home is always implicit (the Breadcrumbs component itself prepends it, never
 * listed here) and the current page's own title is the trail's final, unlinked crumb (the component
 * appends its own `pageTitle`, also not listed here) — so this returns only what comes in between.
 *
 * A post's one ancestor is always the fixed, unlinked "Posts" crumb: the `/posts/` prefix (`POSTS_PREFIX`)
 * is a routing convention with no actual index page behind it to link to (posts are a latent capability —
 * none are published yet — but the prefix is real and permanent, so this case is handled regardless).
 *
 * Every other slug is walked path-segment by path-segment from its start ("a/b/c" checks "a", then
 * "a/b" — never the full slug itself, which is the current page): each prefix that resolves to a real
 * published route contributes a linked crumb using THAT route's own title. The walk stops at the FIRST
 * prefix that does not resolve — "the initial valid paths" — rather than skipping the gap and checking
 * deeper prefixes, since a path segment that is not itself a real page has no meaningful crumb to show.
 *
 * @param routes - the full resolved route table (`collectRoutes`'s output), used to look up each
 *   candidate ancestor prefix's own title
 * @param slug - the current route's own slug (as `collectRoutes` returns it — already `posts/`-prefixed
 *   when applicable), excluded from the walk
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
 * Merges the published route sources into one route table: every entry resolved to the layout it renders
 * through (D4), with duplicate slugs failing the build.
 *
 * Pages and posts differ only in the slug they claim (posts take the `/posts/` prefix) and the collection
 * a template must declare to render them. Everything else — D4 resolution, the collision check, the
 * design/portable split — is collection-agnostic, which is what makes adding a routed collection cheap.
 *
 * @param {RouteSources} sources - the published pages, posts, design pages, and design templates
 * @returns {RouteTable} - one route per slug (entries first, then design pages) plus fail-soft warnings
 * @throws {Error} when a slug is claimed twice, a collection has two default templates, or an entry names
 *   a template belonging to another collection
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
                      template: { slug: template.slug, collection: template.collection }
                  }
                : {
                      kind: "portable",
                      title: entry.title,
                      description: entry.description,
                      published_at: entry.published_at,
                      content: entry.content
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
                template: null
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
