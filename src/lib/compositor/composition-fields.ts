/**
 * lib/compositor/composition-fields.ts
 *
 * Shared field labels, placeholder copy, and the public entity-reference href builder for a
 * composition's detail view
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

import { ENTITY_NOUN_SLUGS, type EntityNoun } from "./entity-fields"

/** Field labels shown beside a composition's values. Mirrors `CompositionInfo.astro`'s `<strong>` text. */
export const COMPOSITION_LABELS = {
    composer: "Composer",
    composerId: "Composer ID",
    secondaryAuthors: "Secondary Authors",
    secondaryAuthorIds: "Secondary Author IDs",
    primaryContributor: "Primary Contributor ID",
    additionalPrimaryContributor: "Additional Primary Contributor ID",
    additionalContributors: "Additional Contributor IDs",
    phases: "Phases",
    key: "Key",
    range: "Range",
    highestPosition: "Highest Position",
    suzukiRating: "Suzuki Rating",
    nyssmaRating: "NYSSMA Rating",
    publisherName: "Publisher Name",
    publicationLocation: "Publication Location",
    publicationYear: "Publication Year",
    publicationUri: "Publication URI",
    notesHistorical: "Historical Notes",
    notesPedagogical: "Pedagogical Notes",
    notesOther: "Other Notes",
    tags: "Tags",
    citations: "Citations"
} as const

/** "Not supplied" copy for each field. Mirrors `CompositionInfo.astro`'s `disp()`/anchor placeholder args. */
export const COMPOSITION_PLACEHOLDERS = {
    type: "(no type specified)",
    part: "(no part specified)",
    composerNameError: "(error in composer name)",
    secondaryAuthors: "(no secondary authors)",
    secondaryAuthorIds: "(no secondary author IDs)",
    additionalPrimaryContributor: "(no additional primary contributor specified)",
    additionalContributors: "(no additional contributors specified)",
    phases: "(no phases specified)",
    key: "(no key specified)",
    range: "(no range specified)",
    highestPosition: "(no position specified)",
    publisherName: "(no publisher name specified)",
    publicationLocation: "(no publication location specified)",
    publicationYear: "(no publication year specified)",
    publicationUri: "(no publication URI specified)",
    notesHistorical: "(no historical notes)",
    notesPedagogical: "(no pedagogical notes)",
    notesOther: "(no other notes)"
} as const

/** Renders a field value, substituting `placeholder` when null/undefined/blank/empty-array */
export function displayValue(value: unknown, placeholder: string): string {
    if (value === null || value === undefined) return placeholder
    if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : placeholder
    if (typeof value === "string" && value.trim() === "") return placeholder
    if (typeof value === "boolean") return value ? "Yes" : "No"
    return String(value)
}

/** Public detail-page URL for an entity reference (composer/contributor a composition names) */
export function entityHref(noun: EntityNoun, id: number): string {
    return `/entity/${ENTITY_NOUN_SLUGS[noun]}/${id}`
}
