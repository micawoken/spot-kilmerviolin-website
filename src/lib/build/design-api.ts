/**
 * lib/build/design-api.ts
 *
 * Build-time reader for the compositor collections (impl §6.6), the design-page analog of
 * `emdash-api.ts`. It reuses that module's `emdashGet` (config, Access/PAT auth, timeout, fail-soft
 * logging) rather than duplicating it, so both readers authenticate identically.
 *
 * Failure policy is deliberately split:
 *  - With no CONTENT_API_BASE (the bootstrap build) there is nothing to read and the readers return
 *    []/null, so the build still succeeds.
 *  - A *read* failure against a configured CMS THROWS (`CmsReadError`, see emdash-api.ts) — a soft
 *    fallback would drop published pages out of `dist/` and deploy that over the live site.
 *  - A *migration* failure on a published design THROWS and fails the build, naming the page. The design
 *    is present and published; rendering it wrongly, or silently dropping it, would be a regression that
 *    reaches the public site. Loud and early beats a missing page nobody notices.
 *  - A *missing* `design_template` collection (404) is a legitimate state until the setup script creates
 *    it, so that one read alone opts into `allowMissing`.
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

import { migrateDesign } from "../compositor/migrations"
import { isTokenCatalog, type TokenCatalog } from "../compositor/tokens"
import type { DesignDoc } from "../compositor/types"
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

/** The content collections a template can render entries of (pivot §3). */
export type TemplateCollection = "pages" | "posts"

const TEMPLATE_COLLECTIONS: readonly string[] = ["pages", "posts"]

/**
 * The reserved item slug of the "None (plain article)" sentinel template (pivot §3, §7.4). Referencing
 * it — or defaulting a collection to it — means "render this entry bare", i.e. D3's untemplated output.
 * It is the only way to opt one entry out of its collection's default template.
 *
 * The sentinel is exempt from the collection-mismatch check: it holds no layout, so the one item serves
 * every routed collection regardless of which collection its (required) `collection` field names.
 */
export const TEMPLATE_NONE_SLUG = "none"

/** A published design template: a layout that a content entry renders through (pivot D1/D4). */
export interface BuildTemplate {
    /** the EmDash item id — what an entry's `design` reference field points at */
    id: string
    /** the template's identifier slug; never a route (only `design_page` claims URLs) */
    slug: string
    title: string
    /** which collection's entries this template renders; drives outlet field pickers and the lint */
    collection: TemplateCollection
    /** this template is its collection's default, used by entries that name no template */
    isDefault: boolean
    /** the design document, already migrated to CURRENT_SCHEMA_VERSION */
    doc: DesignDoc
}

/**
 * Fetches every published `design_template`, following cursor pagination to completion, and migrates each
 * one's stored `design` envelope — the same envelope, ladder, and version as `design_page` (no fork).
 *
 * Failure policy matches `fetchPublishedDesignPages`: a *read* failure fails soft to [] (every entry then
 * falls back to its untemplated render, per D3), while a published template that cannot be migrated — or
 * that names a collection this build does not route — THROWS, naming it. Such a template is published and
 * live; entries pointing at it would silently lose their layout.
 *
 * @returns {Promise<BuildTemplate[]>} the published templates, in API order
 * @throws {Error} when a published template's design cannot be migrated, or its `collection` is unknown
 */
export async function fetchPublishedTemplates(): Promise<BuildTemplate[]> {
    const templates: BuildTemplate[] = []
    let cursor: string | undefined

    do {
        const query = new URLSearchParams({ status: "published", limit: "100" })
        if (cursor) query.set("cursor", cursor)
        // `allowMissing`: the collection does not exist until the setup script creates it, and a 404 then
        // means "no templates yet" — a legitimate state that must not fail the build. Any OTHER failure
        // (timeout, 5xx, auth) still throws, like every content read.
        const result = await emdashGet<ApiListResult>(`/_emdash/api/content/design_template?${query.toString()}`, {
            allowMissing: true
        })
        if (!result?.items) break

        for (const item of result.items) {
            const data = item.data ?? {}
            const name = normalizeSlug(item.slug) ?? item.id

            const collection = data.collection
            if (typeof collection !== "string" || !TEMPLATE_COLLECTIONS.includes(collection)) {
                throw new Error(
                    `[build/design-api] published design template "${name}" targets the unknown collection ` +
                        `${JSON.stringify(collection)}. Expected one of ${TEMPLATE_COLLECTIONS.join(", ")}; ` +
                        "fix or unpublish the template."
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
                collection: collection as TemplateCollection,
                isDefault: data.isDefault === true,
                doc
            })
        }
        cursor = result.nextCursor
    } while (cursor)

    return templates
}

/**
 * Fetches the published `design_theme` token catalog — the `--dtk-*` values every design draws from.
 *
 * Returns null (with a loud warning) when no theme is published or the stored catalog is invalid: design
 * pages then render structurally intact but with no token custom properties defined, so token-backed
 * declarations fall back to their initial values. That is a visible, recoverable state; failing the whole
 * build over an unpublished theme is not worth it.
 *
 * @returns {Promise<TokenCatalog | null>} the published catalog, or null when unavailable
 */
export async function fetchPublishedTheme(): Promise<TokenCatalog | null> {
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

    return tokens
}
