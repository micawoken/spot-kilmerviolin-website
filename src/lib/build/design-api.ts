/**
 * lib/build/design-api.ts
 *
 * Build-time reader for the compositor collections (impl §6.6), design-page analog of
 * `emdash-api.ts`. Reuses that module's `emdashGet` (config/auth/timeout/failure policy) instead
 * of duplicating it — both readers authenticate and fail identically.
 *
 * Failure policy, three-way split:
 *  - No CONTENT_API_BASE (bootstrap build): nothing to read, readers return []/null, build succeeds.
 *  - Read failure against a CONFIGURED CMS: throws (`CmsReadError`) — soft fallback would drop
 *    published pages from `dist/` and deploy that over the live site.
 *  - Migration failure on a published design: THROWS, names the page. It's published — rendering
 *    it wrong or dropping it silently would regress the public site. Loud and early beats a missing
 *    page nobody notices.
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

import { ENTITY_NOUNS, isEntityNoun, type EntityNoun } from "../compositor/entity-fields"
import { migrateDesign } from "../compositor/migrations"
import { isTokenCatalog, lintTokenCatalog, lintTokenValues, type TokenCatalog } from "../compositor/tokens"
import {
    cmsBoolean,
    isTemplateCollection,
    TEMPLATE_COLLECTIONS,
    type DesignDoc,
    type TemplateCollection
} from "../compositor/types"
import { emdashGet, normalizeSlug, type ApiListResult } from "./emdash-api"

/** A published design page, flattened to what the public route needs to render it. */
export interface BuildDesignPage {
    /** the on-site path segment(s), without a leading or trailing slash (e.g. "about") */
    slug: string
    title: string
    description: string
    /** the design document, already migrated to CURRENT_SCHEMA_VERSION */
    doc: DesignDoc
}

/**
 * Fetches every published `design_page` (cursor-paginated to completion), migrating each's stored
 * `design` envelope to the current schema version.
 *
 * Read failure: returns [] (fail-soft, see module header). Migration failure: throws, names the
 * offending page — published, so it can't be quietly skipped.
 *
 * Cached for the build's lifetime, same rationale as {@link fetchPublishedTheme}: both `[...slug].astro`'s
 * `getStaticPaths` and `pages/404.astro`'s frontmatter call this, so a build would otherwise pay the
 * cursor-paginated read twice.
 */
export function fetchPublishedDesignPages(): Promise<BuildDesignPage[]> {
    if (!designPagesCache) designPagesCache = readPublishedDesignPages()
    return designPagesCache
}

/** Build-time cache backing {@link fetchPublishedDesignPages}. */
let designPagesCache: Promise<BuildDesignPage[]> | null = null

async function readPublishedDesignPages(): Promise<BuildDesignPage[]> {
    const designPages: BuildDesignPage[] = []
    let cursor: string | undefined

    do {
        const query = new URLSearchParams({ status: "published", limit: "100" })
        if (cursor) query.set("cursor", cursor)
        const result = await emdashGet<ApiListResult>(`/_emdash/api/content/design_page?${query.toString()}`)
        if (!result?.items) break

        for (const item of result.items) {
            const slug = normalizeSlug(item.slug)
            // Unroutable item, unreachable by any URL — skip, not fatal.
            if (!slug) continue
            const data = item.data ?? {}

            let doc: DesignDoc
            try {
                doc = migrateDesign(data.design)
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error)
                throw new Error(
                    `[build/design-api] published design page "${slug}" has an unreadable design document: ` +
                        `${reason}. Fix or unpublish the page; the build will not silently drop it.`
                )
            }

            designPages.push({
                slug,
                title: typeof data.title === "string" ? data.title : "",
                description: typeof data.description === "string" ? data.description : "",
                doc
            })
        }
        cursor = result.nextCursor
    } while (cursor)

    return designPages
}

// Re-exported so existing importers (route-authority) keep their import site; owned by
// lib/compositor/types so the /_emdash gate can import it without dragging build code in.
export type { TemplateCollection }

/**
 * Reserved slug of the "None (plain article)" sentinel template (pivot §3, §7.4). Referencing it —
 * or defaulting a collection to it — means "render bare" (D3). Only way to opt one entry out of its
 * collection's default template.
 *
 * Exempt from the collection-mismatch check: holds no layout, so one item serves every routed
 * collection regardless of its `collection` field.
 */
export const TEMPLATE_NONE_SLUG = "none"

/**
 * Reserved slug designating a `design_page` as the site's Not Found page (8-task plan #8). Owner
 * authors the 404 page through the compositor like any other design page, giving it this slug.
 * `pages/404.astro` looks it up directly, renders via the same Puck path `[...slug].astro` uses for
 * an untemplated design page (kind "design", `entry: null`).
 *
 * Deliberately EXCLUDED from `[...slug].astro`'s route table: claiming a real "/404" URL would be
 * redundant with Cloudflare's static `dist/404.html` fallback, and unlike "home" → "/", no second
 * path this slug should also own.
 */
export const NOT_FOUND_PAGE_SLUG = "404"

/**
 * Splits fetched `design_page`s into the routable set `[...slug].astro` builds a route table from
 * and the reserved 404 page (if published) — one definition so the two callers (catch-all route,
 * `pages/404.astro`) can't drift apart. EmDash enforces per-collection slug uniqueness: at most one
 * match.
 */
export function partitionDesignPages(designPages: BuildDesignPage[]): {
    routable: BuildDesignPage[]
    notFoundPage: BuildDesignPage | null
} {
    const routable: BuildDesignPage[] = []
    let notFoundPage: BuildDesignPage | null = null
    for (const designPage of designPages) {
        if (designPage.slug === NOT_FOUND_PAGE_SLUG) notFoundPage = designPage
        else routable.push(designPage)
    }
    return { routable, notFoundPage }
}

/**
 * What `design_template.collection` may legitimately target system-wide: an EmDash collection routed
 * by `route-authority.ts` (`TemplateCollection`), or a D1-backed entity noun routed by
 * `entity-routes.ts` (`EntityNoun`). Deliberately NOT folded into `TEMPLATE_COLLECTIONS`/
 * `isTemplateCollection` — those also gate `emdash_design_access.ts`'s `design_editor` allowlist,
 * scoped to collections EmDash actually has. Entities never read through `/_emdash` (see d1-api.ts);
 * widening that allowlist to an EmDash-unserved name would be a scope leak, not a routing concern.
 */
export type DesignTemplateCollection = TemplateCollection | EntityNoun

function isDesignTemplateCollection(value: string): value is DesignTemplateCollection {
    return isTemplateCollection(value) || isEntityNoun(value)
}

/** A published design template, before it is known which routing module (pages/posts vs. entity) owns it. */
interface RawBuildTemplate {
    /** the EmDash item id — what an entry's `design` reference field points at */
    id: string
    /** the template's identifier slug; never a route (only `design_page` claims URLs) */
    slug: string
    title: string
    collection: DesignTemplateCollection
    /** this template is its target's default, used when nothing names a more specific template */
    isDefault: boolean
    /** the design document, already migrated to CURRENT_SCHEMA_VERSION */
    doc: DesignDoc
}

/** A published design template that renders `pages`/`posts` entries (pivot D1/D4; route-authority.ts). */
export interface BuildTemplate {
    id: string
    slug: string
    title: string
    /** which collection's entries this template renders; drives outlet field pickers and the lint */
    collection: TemplateCollection
    /** this template is its collection's default, used by entries that name no template */
    isDefault: boolean
    doc: DesignDoc
}

/** A published design template that renders one D1-backed entity noun's records (entity-routes.ts). */
export interface BuildEntityTemplate {
    id: string
    slug: string
    title: string
    /** which entity noun's records this template renders — every record of that noun uses it (no per-record pointer) */
    collection: EntityNoun
    /** this template is its noun's default; a noun with no default gets no public pages (entity-routes.ts) */
    isDefault: boolean
    doc: DesignDoc
}

/**
 * Fetches every published `design_template` (cursor-paginated), migrating each's stored `design`
 * envelope — same envelope/ladder/version as `design_page`, no fork.
 *
 * Collection ABSENCE is legitimate (doesn't exist until setup tooling creates it) — 404 reads as "no
 * templates yet" (`allowMissing: true`), every entry falls back to untemplated render (D3). Any other
 * read failure throws (`CmsReadError`). An unmigratable design, or one naming a collection this build
 * doesn't route at all, also THROWS, naming it — published and live, would otherwise silently lose
 * its layout.
 *
 * Not exported: callers want `fetchPublishedTemplates` (pages/posts) or
 * `fetchPublishedEntityTemplates` (entity nouns), never the undifferentiated raw list.
 *
 * Cached for the build's lifetime, same rationale as {@link fetchPublishedTheme}: `[...slug].astro`,
 * `DatabaseRoot.astro` (rendered at both /entity and /database), `database-facets.json.ts`, and every
 * entity route's `getStaticPaths` all resolve templates through this one way or another — without a
 * cache, one build fires that many redundant cursor-paginated reads of the same collection.
 */
function fetchAllPublishedTemplates(): Promise<RawBuildTemplate[]> {
    if (!allTemplatesCache) allTemplatesCache = readAllPublishedTemplates()
    return allTemplatesCache
}

/** Build-time cache backing {@link fetchAllPublishedTemplates}. */
let allTemplatesCache: Promise<RawBuildTemplate[]> | null = null

async function readAllPublishedTemplates(): Promise<RawBuildTemplate[]> {
    const templates: RawBuildTemplate[] = []
    let cursor: string | undefined

    do {
        const query = new URLSearchParams({ status: "published", limit: "100" })
        if (cursor) query.set("cursor", cursor)
        const result = await emdashGet<ApiListResult>(`/_emdash/api/content/design_template?${query.toString()}`, {
            allowMissing: true
        })
        if (!result?.items) break

        for (const item of result.items) {
            const data = item.data ?? {}
            const name = normalizeSlug(item.slug) ?? item.id

            const collection = data.collection
            if (typeof collection !== "string" || !isDesignTemplateCollection(collection)) {
                throw new Error(
                    `[build/design-api] published design template "${name}" targets the unknown collection ` +
                        `${JSON.stringify(collection)}. Expected one of ` +
                        `${[...TEMPLATE_COLLECTIONS, ...ENTITY_NOUNS].join(", ")}; fix or unpublish the template.`
                )
            }

            let doc: DesignDoc
            try {
                doc = migrateDesign(data.design)
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error)
                throw new Error(
                    `[build/design-api] published design template "${name}" has an unreadable design ` +
                        `document: ${reason}. Fix or unpublish the template; entries rendering through it ` +
                        "would silently lose their layout."
                )
            }

            templates.push({
                id: item.id,
                slug: name,
                title: typeof data.title === "string" ? data.title : "",
                collection,
                isDefault: cmsBoolean(data.is_default),
                doc
            })
        }
        cursor = result.nextCursor
    } while (cursor)

    return templates
}

/**
 * Published templates rendering `pages`/`posts` entries — the view `route-authority.ts` consumes.
 * Entity-noun templates filtered out here; entity records never enter `route-authority.ts`'s
 * slug/collision rules (see entity-routes.ts).
 */
export async function fetchPublishedTemplates(): Promise<BuildTemplate[]> {
    const all = await fetchAllPublishedTemplates()
    return all.filter((template): template is BuildTemplate => isTemplateCollection(template.collection))
}

/**
 * Published templates rendering a D1-backed entity noun's records — the view `entity-routes.ts`
 * consumes to resolve each noun's default layout (Step 6).
 */
export async function fetchPublishedEntityTemplates(): Promise<BuildEntityTemplate[]> {
    const all = await fetchAllPublishedTemplates()
    return all.filter((template): template is BuildEntityTemplate => isEntityNoun(template.collection))
}

/**
 * One field of a collection's live schema, as outlet field pickers and the pairing lint consume it
 * (pivot §5.2): outlet-bindable slug, picker label, type gating which outlets accept it. Subset of
 * EmDash's schema payload — the live endpoint is the only ground truth for fields (pivot §1.10:
 * generated emdash-env.d.ts tracks the local dev DB, not prod).
 */
export interface CollectionField {
    slug: string
    label: string
    type: string
}

/**
 * Fetches one collection's live field schema, for the dangling-outlet-field lint.
 *
 * Fails SOFT to null — a schema-read hiccup must not fail the build; caller skips that lint rule with
 * a loud warning instead (pivot §5.2). Deliberately weaker than content reads (which throw): losing
 * one advisory check is recoverable, losing pages is not.
 */
export async function fetchCollectionFields(collection: string): Promise<CollectionField[] | null> {
    let result: { items?: Array<Record<string, unknown>> } | null
    try {
        result = await emdashGet<{ items?: Array<Record<string, unknown>> }>(
            `/_emdash/api/schema/collections/${encodeURIComponent(collection)}/fields`
        )
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        console.warn(
            `[build/design-api] could not read the "${collection}" field schema (${reason}) — the ` +
                "dangling-outlet-field lint is SKIPPED for this build."
        )
        return null
    }
    if (!result?.items) return null

    const fields: CollectionField[] = []
    for (const item of result.items) {
        if (typeof item.slug !== "string" || typeof item.type !== "string") continue
        fields.push({
            slug: item.slug,
            label: typeof item.label === "string" ? item.label : item.slug,
            type: item.type
        })
    }
    return fields
}

/**
 * Fetches the published `design_theme` token catalog — the `--dtk-*` values every design draws from.
 *
 * Null (+ loud warning) when no theme published or the stored catalog is invalid: pages render
 * structurally intact, token-backed declarations just fall back to initial values — visible and
 * recoverable, not worth failing the build over.
 *
 * Cached for the build's lifetime, same rationale as `emdash-api.ts`'s `pageHrefCache` — otherwise
 * every design page's render re-reads and re-lints the same published theme.
 */
export function fetchPublishedTheme(): Promise<TokenCatalog | null> {
    if (!themeCache) {
        themeCache = resolvePublishedTheme()
    }
    return themeCache
}

/** Build-time cache backing {@link fetchPublishedTheme}. */
let themeCache: Promise<TokenCatalog | null> | null = null

async function resolvePublishedTheme(): Promise<TokenCatalog | null> {
    const result = await emdashGet<ApiListResult>("/_emdash/api/content/design_theme?status=published&limit=1")
    const item = result?.items?.[0]
    if (!item) {
        console.warn(
            "[build/design-api] no PUBLISHED design_theme found — design pages will render without any " +
                "design tokens. Publish the theme in /admin/advanced/designs/theme, then rebuild."
        )
        return null
    }

    const tokens = item.data?.tokens
    if (!isTokenCatalog(tokens)) {
        console.warn(
            "[build/design-api] the published design_theme is not a valid token catalog — design pages " +
                "will render without any design tokens. Re-save the theme in /admin/advanced/designs/theme."
        )
        return null
    }

    // Button variant referencing a deleted token: authoring bug, but emitted var() already fails soft
    // (CSS fallback) — warn, don't throw. Narrower than DD2 (design referencing a missing token, which
    // throws); this is a cosmetic theme-internal dangle.
    for (const finding of lintTokenCatalog(tokens)) {
        console.warn(
            `[build/design-api] button variant "${finding.variant}" ${finding.field} references ` +
                `${finding.kind} token "${finding.ref}", which is not in the theme — it will render its CSS fallback.`
        )
    }

    // A value the emitter refuses (tokens.ts's isSafeTokenValue) is dropped silently, so the theme owner
    // would otherwise see a styling change with no cause. Warn rather than throw: dropping the one token
    // is already the safe outcome, and failing the build over it would let a bad value block every deploy.
    for (const finding of lintTokenValues(tokens)) {
        console.warn(
            `[build/design-api] ${finding.kind} token "${finding.name}" has an unusable ${finding.field} — ` +
                "it will not be emitted, and its consumers fall back. Values may not contain < > ; { } @ or \\."
        )
    }

    return tokens
}
