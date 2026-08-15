/**
 * lib/build/entity-routes.ts
 *
 * Resolves the published default template for each D1-backed entity noun
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
 * Indexes published entity templates by the (at most one) `is_default` per noun
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
 * Resolves every entity noun's default template
 */
export function resolveEntityTemplates(templates: BuildEntityTemplate[]): EntityTemplateResolution[] {
    const defaults = indexDefaults(templates)
    return ENTITY_NOUNS.map((noun) => {
        const template = defaults.get(noun) ?? null
        return { noun, template: template && template.slug !== TEMPLATE_NONE_SLUG ? template : null }
    })
}
