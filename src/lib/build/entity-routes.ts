/**
 * lib/build/entity-routes.ts
 *
 * Resolves the published default template for each D1-backed entity noun (composer, composition,
 * contributor) — entity analog of `route-authority.ts`'s `resolveTemplate`, simpler: no per-record
 * template pointer (no `design` reference field on a D1 schema — `entity-fields.ts`'s catalog is
 * fixed, not authorable in EmDash), so every record of one noun renders through exactly one layout,
 * that noun's published `is_default` design_template. No D3 "render bare" fallback like pages/posts —
 * a noun with no resolved default just gets no public pages this build (impl plan Step 6).
 *
 * Deliberately OUT of `route-authority.ts` (impl plan Step 5): that module owns the EmDash
 * `pages`/`posts`/`design_page` slug space and duplicate-slug rules, which entity records never enter
 * — an entity's route is `/entity/{noun}/{id}`, never authored, never collidable with a CMS slug.
 * Pure module (no network calls), like `route-authority.ts` — unit-testable without a console or CMS.
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

import { ENTITY_NOUNS, type EntityNoun } from "../compositor/entity-fields"
import { TEMPLATE_NONE_SLUG, type BuildEntityTemplate } from "./design-api"

/** The resolved outcome for one entity noun: the template every record of it renders through, or none. */
export interface EntityTemplateResolution {
    noun: EntityNoun
    /** null when this noun has no public pages this build — no default template, or the default is "None" */
    template: BuildEntityTemplate | null
}

/**
 * Indexes published entity templates by the (at most one) `is_default` per noun — same ambiguous-default
 * rejection as `route-authority.ts`'s `indexTemplates` for pages/posts. Throws when a noun has two or
 * more published default templates.
 */
function indexDefaults(templates: BuildEntityTemplate[]): Map<EntityNoun, BuildEntityTemplate> {
    const defaults = new Map<EntityNoun, BuildEntityTemplate>()
    const rivals = new Map<EntityNoun, string[]>()

    for (const template of templates) {
        if (!template.isDefault) continue
        const claimed = rivals.get(template.collection) ?? []
        claimed.push(template.slug)
        rivals.set(template.collection, claimed)
        if (!defaults.has(template.collection)) defaults.set(template.collection, template)
    }

    const ambiguous = [...rivals.entries()].filter(([, slugs]) => slugs.length > 1)
    if (ambiguous.length > 0) {
        const detail = ambiguous
            .map(([noun, slugs]) => `  "${noun}" defaulted by ${slugs.length}×: ${slugs.join(", ")}`)
            .join("\n")
        throw new Error(
            "[build/entity-routes] an entity noun cannot have two default templates:\n" +
                `${detail}\n` +
                "Clear is_default on all but one of each, then rebuild."
        )
    }

    return defaults
}

/**
 * Resolves every entity noun's default template. Null when a noun has no published default (not yet
 * authored — Step 6 skips SSG for it) or its default is the "None" sentinel (same reserved slug
 * pages/posts use — an explicit "no public pages for this noun").
 */
export function resolveEntityTemplates(templates: BuildEntityTemplate[]): EntityTemplateResolution[] {
    const defaults = indexDefaults(templates)
    return ENTITY_NOUNS.map((noun) => {
        const template = defaults.get(noun) ?? null
        return { noun, template: template && template.slug !== TEMPLATE_NONE_SLUG ? template : null }
    })
}
