/**
 * lib/build/design-api.ts
 *
 * Build-time reader for the compositor collections (impl §6.6), the design-page analog of
 * `emdash-api.ts`. It reuses that module's `emdashGet` (config, auth, timeout, failure policy) rather
 * than duplicating it, so both readers authenticate and fail identically.
 *
 * Failure policy is deliberately split:
 *  - With no CONTENT_API_BASE (the bootstrap build) there is nothing to read; the readers return []/null
 *    and the build still succeeds.
 *  - A *read* failure against a CONFIGURED CMS throws (`CmsReadError`, see emdash-api.ts) — falling soft
 *    there would drop published pages out of `dist/` and deploy that over the live site.
 *  - A *migration* failure on a published design THROWS and fails the build, naming the page. The design
 *    is present and published; rendering it wrongly, or silently dropping it, would be a regression that
 *    reaches the public site. Loud and early beats a missing page nobody notices.
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
import { isTokenCatalog, lintTokenCatalog, type TokenCatalog } from "../compositor/tokens"
import { cmsBoolean, isTemplateCollection, TEMPLATE_COLLECTIONS, type DesignDoc, type TemplateCollection } from "../compositor/types"
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
 * Fetches every published `design_page`, following cursor pagination to completion, and migrates each
 * one's stored `design` envelope to the current schema version.
 *
 * A read failure returns [] (fail-soft, see the module header). A design that fails to migrate throws,
 * failing the build with the offending page named — it is published, so it cannot be quietly skipped.
 *
 * @returns {Promise<BuildDesignPage[]>} the published design pages to prerender, in API order
 * @throws {Error} when a published design's `design` field cannot be migrated to the current version
 */
export async function fetchPublishedDesignPages(): Promise<BuildDesignPage[]> {
    const designPages: BuildDesignPage[] = []
    let cursor: string | undefined

    do {
        const query = new URLSearchParams({ status: "published", limit: "100" })
        if (cursor) query.set("cursor", cursor)
        const result = await emdashGet<ApiListResult>(`/_emdash/api/content/design_page?${query.toString()}`)
        if (!result?.items) break

        for (const item of result.items) {
            const slug = normalizeSlug(item.slug)
            // An unroutable item cannot be reached by any URL, so it is skipped rather than fatal.
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

// Re-exported so the build's existing importers (route-authority) keep their import site; the list itself
// is owned by lib/compositor/types, which the /_emdash gate can import without dragging build code in.
export type { TemplateCollection }

/**
 * The reserved item slug of the "None (plain article)" sentinel template (pivot §3, §7.4). Referencing
 * it — or defaulting a collection to it — means "render this entry bare", i.e. D3's untemplated output.
 * It is the only way to opt one entry out of its collection's default template.
 *
 * The sentinel is exempt from the collection-mismatch check: it holds no layout, so the one item serves
 * every routed collection regardless of which collection its (required) `collection` field names.
 */
export const TEMPLATE_NONE_SLUG = "none"

/**
 * What a `design_template.collection` field may legitimately target across the whole system: an EmDash
 * collection routed by `route-authority.ts` (`TemplateCollection`), or a D1-backed entity noun routed by
 * `entity-routes.ts` (`EntityNoun`). Deliberately wider than `TemplateCollection` alone, and deliberately
 * NOT folded into `TEMPLATE_COLLECTIONS`/`isTemplateCollection` — those also gate
 * `emdash_design_access.ts`'s `design_editor` read allowlist, which must stay scoped to collections
 * EmDash actually has. Entities are never read through `/_emdash` (see d1-api.ts); widening that allowlist
 * to a collection name EmDash doesn't serve would be a scope leak, not a routing concern.
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
 * Fetches every published `design_template`, following cursor pagination to completion, and migrates each
 * one's stored `design` envelope — the same envelope, ladder, and version as `design_page` (no fork).
 *
 * The collection's ABSENCE is a legitimate state — it does not exist until the setup tooling creates it —
 * so a 404 reads as "no templates yet" ({ allowMissing: true }) and every entry falls back to its
 * untemplated render (D3). Any other read failure throws (`CmsReadError`), as everywhere else.
 *
 * A published template that cannot be migrated — or that names a collection this build does not route at
 * all (neither an EmDash collection nor a D1 entity noun) — also THROWS, naming it. Such a template is
 * published and live; whatever it renders would otherwise silently lose its layout.
 *
 * Not exported: callers want one of the two typed views below (`fetchPublishedTemplates` for pages/posts,
 * `fetchPublishedEntityTemplates` for entity nouns), never the undifferentiated raw list.
 *
 * @returns {Promise<RawBuildTemplate[]>} the published templates, in API order
 * @throws {Error} when a published template's design cannot be migrated, or its `collection` is unknown
 * @throws {CmsReadError} when a configured CMS fails the read for any reason other than a 404
 */
async function fetchAllPublishedTemplates(): Promise<RawBuildTemplate[]> {
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
 * The published templates that render `pages`/`posts` entries — the view `route-authority.ts` consumes.
 * Entity-noun templates are filtered out here, not routed through `route-authority.ts`'s slug/collision
 * rules, which entity records never participate in (see entity-routes.ts).
 *
 * @returns {Promise<BuildTemplate[]>} the published pages/posts templates, in API order
 * @throws {Error} when a published template's design cannot be migrated, or its `collection` is unknown
 * @throws {CmsReadError} when a configured CMS fails the read for any reason other than a 404
 */
export async function fetchPublishedTemplates(): Promise<BuildTemplate[]> {
    const all = await fetchAllPublishedTemplates()
    return all.filter((template): template is BuildTemplate => isTemplateCollection(template.collection))
}

/**
 * The published templates that render a D1-backed entity noun's records — the view `entity-routes.ts`
 * consumes to resolve each noun's default layout (Step 6).
 *
 * @returns {Promise<BuildEntityTemplate[]>} the published entity templates, in API order
 * @throws {Error} when a published template's design cannot be migrated, or its `collection` is unknown
 * @throws {CmsReadError} when a configured CMS fails the read for any reason other than a 404
 */
export async function fetchPublishedEntityTemplates(): Promise<BuildEntityTemplate[]> {
    const all = await fetchAllPublishedTemplates()
    return all.filter((template): template is BuildEntityTemplate => isEntityNoun(template.collection))
}

/**
 * One field of a collection's live schema, as the outlet field pickers and the pairing lint consume it
 * (pivot §5.2): the slug an outlet binds, the label a picker shows, and the type that gates which
 * outlets accept it. A subset of EmDash's schema payload; the live schema endpoint is the only ground
 * truth for fields (pivot §1.10 — the generated emdash-env.d.ts tracks the local dev DB, not prod).
 */
export interface CollectionField {
    slug: string
    label: string
    type: string
}

/**
 * Fetches the live field schema of one collection, for the dangling-outlet-field lint.
 *
 * Fails SOFT to null — a schema-read hiccup must not fail the build; the caller skips that lint rule
 * for the build with a loud warning instead (pivot §5.2). This is deliberately weaker than content
 * reads (which throw): losing one advisory check for a build is recoverable, losing pages is not.
 *
 * @param {string} collection - the collection slug (e.g. "pages")
 * @returns {Promise<CollectionField[] | null>} the fields, or null when the schema could not be read
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
 * Returns null (with a loud warning) when no theme is published or the stored catalog is invalid: design
 * pages then render structurally intact but with no token custom properties defined, so token-backed
 * declarations fall back to their initial values. That is a visible, recoverable state; failing the whole
 * build over an unpublished theme is not worth it.
 *
 * Cached for the life of one build process, the same rationale as `emdash-api.ts`'s `pageHrefCache`:
 * every design page's render would otherwise re-read and re-lint the same published theme once per page.
 *
 * @returns {Promise<TokenCatalog | null>} the published catalog, or null when unavailable
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
    const result = await emdashGet<ApiListResult>(
        "/_emdash/api/content/design_theme?status=published&limit=1"
    )
    const item = result?.items?.[0]
    if (!item) {
        console.warn(
            "[build/design-api] no PUBLISHED design_theme found — design pages will render without any " +
                "design tokens. Publish the theme in /admin/designs/theme, then rebuild."
        )
        return null
    }

    const tokens = item.data?.tokens
    if (!isTokenCatalog(tokens)) {
        console.warn(
            "[build/design-api] the published design_theme is not a valid token catalog — design pages " +
                "will render without any design tokens. Re-save the theme in /admin/designs/theme."
        )
        return null
    }

    // A button variant whose reference names a deleted token is an authoring bug the owner should see —
    // but the emitted var() already fails soft (renders the CSS fallback), so warn, do not throw. This is
    // narrower than the design-level unknown-token rule (DD2): that fails the build on a DESIGN referencing
    // a missing token; this is a cosmetic THEME-internal dangle.
    for (const finding of lintTokenCatalog(tokens)) {
        console.warn(
            `[build/design-api] button variant "${finding.variant}" ${finding.field} references ` +
                `${finding.kind} token "${finding.ref}", which is not in the theme — it will render its CSS fallback.`
        )
    }

    return tokens
}
