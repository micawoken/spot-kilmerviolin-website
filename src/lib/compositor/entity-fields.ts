/**
 * lib/compositor/entity-fields.ts
 *
 * Static outlet field catalog for the three D1-backed entity types (composers, compositions,
 * contributors) — the entity analog of `design-api.ts`'s `fetchCollectionFields`, but synchronous and
 * hand-authored rather than read live from EmDash: entities are not an EmDash collection, so there is
 * no schema endpoint to ask. Field `type` values are drawn from the same vocabulary `OUTLET_PROPS`
 * (catalog.tsx) already accepts ("string"/"text" → ContentText, "image" → ContentImage), so no catalog
 * change is needed to make these fields bindable — only a picker-side source swap (DesignEditor.tsx).
 *
 * Scope (impl plan Step 3): composer and contributor expose name/bio/image as free-form outlets.
 * Composition deliberately exposes only name/image here — its other ~25 fields render through the
 * dedicated `CompositionDetail` block (Step 4), not loose outlets (hybrid template model, plan decision
 * 3): dragging that many individual outlets is bad authoring, and D1 reference resolution
 * (composer/contributor names) only happens for the block's pre-resolved `context.entryNames`, not for
 * a bare outlet reading `entry[field]`.
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

import type { CollectionField } from "../build/design-api"

/** The three D1-backed object types a template can render one record of, once Step 5 wires them in. */
export type EntityNoun = "composer" | "composition" | "contributor"

export const ENTITY_NOUNS: readonly EntityNoun[] = ["composer", "composition", "contributor"]

/** Whether a string names an entity noun (as opposed to an EmDash collection slug). */
export function isEntityNoun(value: string): value is EntityNoun {
    return (ENTITY_NOUNS as readonly string[]).includes(value)
}

const ENTITY_FIELDS: Record<EntityNoun, readonly CollectionField[]> = {
    composer: [
        { slug: "name", label: "Name", type: "string" },
        { slug: "bio", label: "Bio", type: "text" },
        { slug: "image", label: "Image", type: "image" }
    ],
    contributor: [
        { slug: "name", label: "Name", type: "string" },
        { slug: "bio", label: "Bio", type: "text" },
        { slug: "image", label: "Image", type: "image" }
    ],
    composition: [
        { slug: "name", label: "Name", type: "string" },
        { slug: "image", label: "Image", type: "image" }
    ]
}

/**
 * The outlet-eligible fields for one entity noun. Always returns synchronously (no fetch) — entity
 * fields are fixed by the D1 schema, not a live EmDash read.
 *
 * @param {EntityNoun} noun - the entity type
 * @returns {readonly CollectionField[]} that noun's outlet-eligible fields
 */
export function entityFields(noun: EntityNoun): readonly CollectionField[] {
    return ENTITY_FIELDS[noun]
}
