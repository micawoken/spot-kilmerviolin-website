/**
 * lib/build/entity-routes.ts
 *
 * Resolves the published default template for each D1-backed entity noun (composer, composition,
 * contributor) — the entity analog of `route-authority.ts`'s `resolveTemplate`, but simpler: a D1 entity
 * record has no per-record template pointer (there is no `design` reference field on a D1 schema —
 * `entity-fields.ts`'s catalog is fixed, not authorable in EmDash), so every record of one noun renders
 * through exactly one layout, that noun's published `is_default` design_template. There is no D3
 * "render bare" fallback for entities the way there is for pages/posts: a noun with no resolved default
 * simply gets no public pages this build (impl plan Step 6: "skip entity pages predictably").
 *
 * Deliberately kept OUT of `route-authority.ts` (impl plan Step 5): that module owns the EmDash
 * `pages`/`posts`/`design_page` slug space and its duplicate-slug collision rules, which entity records
 * never participate in — an entity's route is `/entity/{noun}/{id}`, never authored, never collidable
 * with a CMS-authored slug. This module is pure (no network calls), the same way `route-authority.ts`
 * stays pure, so it can be unit-tested without a console and without a CMS.
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

import { ENTITY_NOUNS, type EntityNoun } from "../compositor/entity-fields"
import { TEMPLATE_NONE_SLUG, type BuildEntityTemplate } from "./design-api"

/** The resolved outcome for one entity noun: the template every record of it renders through, or none. */
export interface EntityTemplateResolution {
    noun: EntityNoun
    /** null when this noun has no public pages this build — no default template, or the default is "None" */
    template: BuildEntityTemplate | null
}

/**
 * Indexes the published entity templates by the (at most one) `is_default` per noun, rejecting an
 * ambiguous default the same way `route-authority.ts`'s `indexTemplates` does for pages/posts: if two
 * published templates both claim `is_default` for one noun, no rule can choose between them.
 *
 * @throws {Error} when a noun has two or more published default templates
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
 * Resolves every entity noun's default template. A noun resolves to a null template when it has no
 * published default (not yet authored — Step 6 skips SSG for it) or when its default is the "None"
 * sentinel (the same reserved slug pages/posts use to opt an entry out of its collection default;
 * authoring it here is an explicit "no public pages for this noun").
 *
 * @param {BuildEntityTemplate[]} templates - the published entity templates
 *   (`design-api.ts`'s `fetchPublishedEntityTemplates`), already migrated
 * @returns {EntityTemplateResolution[]} one resolution per entity noun, in `ENTITY_NOUNS` order
 * @throws {Error} when one noun has two or more published default templates
 */
export function resolveEntityTemplates(templates: BuildEntityTemplate[]): EntityTemplateResolution[] {
    const defaults = indexDefaults(templates)
    return ENTITY_NOUNS.map((noun) => {
        const template = defaults.get(noun) ?? null
        return { noun, template: template && template.slug !== TEMPLATE_NONE_SLUG ? template : null }
    })
}
