/**
 * lib/build/route-authority.ts
 *
 * Single authority for what the public catch-all route builds (impl §6.6, amended by content-routing
 * pivot). Answers two questions per published slug: who owns this path, what layout it renders through.
 *
 * Ownership: three CMS collections claim routes — `pages`, `posts` (`/posts/` prefix, pivot §7.2),
 * compositor's `design_page`. Nothing in EmDash stops an author giving a design page an existing
 * page's slug. Two URLs can't own one path; silently picking a winner means a published page vanishes
 * with no signal — so a duplicate slug **fails the build**, naming every collision at once, not just
 * the first.
 *
 * Layout (pivot D4): content owns the URL, a `design_template` is a layout content flows through. Per
 * entry, in order: 1) the template its `design` reference names (`designRef`, an item id), else 2) the
 * published template that's its collection's `isDefault`, else 3) no template — renders as today (D3:
 * article, auto `<h1>`, Portable Text).
 *
 * Fail-soft vs fail-loud, deliberate split. Publication-state problem (named template draft/deleted):
 * falls back to D3 with a warning — never to the collection default, since the author chose a specific
 * layout and silently substituting another is worse than bare. Authored-wrong problem (template points
 * at another collection; two templates defaulting one collection): fails the build, no fallback right.
 *
 * `home` → `/` mapping NOT applied here — this module decides slug ownership, the route file owns the
 * param shape (undefined rest-param is what Astro routes to "/"). Both sources normalize slugs through
 * `emdash-api.ts`'s `normalizeSlug`, so the comparison is apples to apples.
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
 * What the route renders for one slug. `kind` discriminates: Portable Text article (pre-compositor
 * behavior, unchanged) or a composed design document.
 */
export type RouteProps =
    | {
          kind: "portable"
          title: string
          description: string
          published_at: string | null
          content: unknown
          /** Raw `featured_image` field value (an EmDash media object), not yet resolved to a URL — the
           * route file resolves it against the build's media/files origins. `undefined` when the entry
           * defines no such field. */
          image: unknown
      }
    | {
          kind: "design"
          title: string
          description: string
          doc: DesignDoc
          /** Entry's field record, read by the design's outlets via config context (D7). Null for a
           * `design_page` — no entry behind it, an outlet there is a lint error, not a render concern. */
          entry: Record<string, unknown> | null
          /** Template this entry renders through — named in per-pairing lint errors, its collection
           * selects the checked schema (§5.5). Null for a `design_page` — its own layout, linted
           * standalone before routes are collected. */
          template: { slug: string; collection: TemplateCollection } | null
          /** Same `featured_image` field as the portable branch — a `design_page` has no entry behind it
           * (no EmDash `fields` record), so this is always `undefined` there. */
          image: unknown
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
 * The resolved route table. `warnings` carries fail-soft findings (broken template reference) for the
 * caller to log — module stays pure, unit-testable without a console.
 */
export interface RouteTable {
    routes: RouteEntry[]
    warnings: string[]
}

/** Human name for a source, used only in the duplicate-slug error. */
type SourceName = TemplateCollection | "design_page"

/**
 * Posts route under a `/posts/` prefix (pivot §7.2, owner-decided), applied HERE — at route
 * collection, not in the reader or the route file. The point: the slug this module compares is the
 * one the URL actually has, so a `pages` entry authored as "posts/x" still collides with post "x" and
 * fails the build, instead of two sources silently claiming one path.
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
 * Indexes published templates by id, by slug, by each one's defaulted collection — rejects an
 * ambiguous default: two templates both claiming `isDefault` for one collection means no rule picks
 * between them, every entry of that collection renders through a coin-flip.
 *
 * Indexed by both id and slug because an entry's `design` pointer may hold either (§ D4): EmDash's
 * reference field is a raw text box, an author may type the slug ("article") or store the item id.
 * `bySlug` is unambiguous (EmDash enforces per-collection slug uniqueness); id and slug key spaces
 * don't overlap (ids opaque, slugs words).
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
 * Resolves the template one entry renders through, per D4. Null when the entry renders bare — no
 * named template, no collection default, or either resolves to the "None" sentinel. `slug` is the
 * entry's routed slug, so error/warning messages name a URL an author can find. Throws when the
 * entry's named template renders a different collection (authored wrong).
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
        // id — disjoint key spaces, one lookup resolves whichever was stored, no migration needed.
        const named = index.byId.get(entry.designRef) ?? index.bySlug.get(entry.designRef)
        if (!named) {
            // Draft, deleted, or garbage. Fall to D3, NOT the collection default — author chose a
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

/** One crumb in a breadcrumb trail: `href: null` renders as plain (unlinked) text — see {@link breadcrumbAncestors}. */
export interface BreadcrumbAncestor {
    label: string
    href: string | null
}

/**
 * Auto-derives the breadcrumb *ancestor* chain for a routed slug — Home always implicit (Breadcrumbs
 * component prepends it), current page's own
 * title is the final unlinked crumb (component appends its own `pageTitle`) — returns only what's
 * between.
 *
 * A post's one ancestor is always the fixed, unlinked "Posts" crumb: `/posts/` (`POSTS_PREFIX`) is a
 * routing convention with no index page to link to (posts are latent — none published yet — but the
 * prefix is real and permanent).
 *
 * Every other slug walked segment by segment from the start ("a/b/c" checks "a", then "a/b" — never
 * the full slug, the current page): each prefix resolving to a real published route contributes a
 * linked crumb using that route's own title. Stops at the FIRST unresolved prefix rather than
 * skipping the gap — a segment that isn't itself a real page has no meaningful crumb.
 *
 * `slug` is the current route's own slug (already `posts/`-prefixed when applicable), excluded from
 * the walk.
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
 * Merges the published route sources into one route table: every entry resolved to the layout it
 * renders through (D4), duplicate slugs fail the build.
 *
 * Pages and posts differ only in the slug they claim (posts take `/posts/`) and the collection a
 * template must declare to render them — everything else (D4 resolution, collision check,
 * design/portable split) is collection-agnostic, which is what makes adding a routed collection cheap.
 *
 * Throws when a slug is claimed twice, a collection has two default templates, or an entry names a
 * template belonging to another collection.
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
