/**
 * lib/compositor/entity-fields.ts
 *
 * Static outlet field catalog for the three D1-backed entity types
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

import { mediaSource } from "./media"
import { isRecord } from "./types"

/** The three D1-backed object types a template can render one record of, once Step 5 wires them in. */
export type EntityNoun = "composer" | "composition" | "contributor"

export const ENTITY_NOUNS: readonly EntityNoun[] = ["composer", "composition", "contributor"]

/** Whether a string names an entity noun (as opposed to an EmDash collection slug). */
export function isEntityNoun(value: string): value is EntityNoun {
    return (ENTITY_NOUNS as readonly string[]).includes(value)
}

/**
 * Public-facing plural label for each entity noun
 */
export const ENTITY_NOUN_LABELS: Record<EntityNoun, string> = {
    composer: "Composers",
    composition: "Works",
    contributor: "Contributors"
}

/**
 * Public `/entity/{slug}/...` URL segment for each entity noun
 */
export const ENTITY_NOUN_SLUGS: Record<EntityNoun, string> = {
    composer: "composer",
    composition: "work",
    contributor: "contributor"
}

/**
 * Closed vocabulary a bindable entity field can be
 */
export type EntityFieldKind =
    | "string"
    | "text"
    | "number"
    | "date"
    | "reference"
    | "referenceList"
    | "referenceListWithRole"
    | "list"
    | "image"
    | "uri"
    | "yearOrLiving"
    | "countryCode"
    | "email"
    | "titleCase"
    | "citations"

/** One bindable entity field: what a picker shows, and what a render needs to interpret its value. */
export interface EntityField {
    slug: string
    label: string
    type: EntityFieldKind
    /** only for "reference" | "referenceList": which noun the bound id(s) resolve against */
    refNoun?: EntityNoun
}

const COMPOSER_FIELDS: readonly EntityField[] = [
    { slug: "name", label: "Name", type: "string" },
    { slug: "role", label: "Role", type: "titleCase" },
    { slug: "birth_year", label: "Birth Year", type: "number" },
    { slug: "death_year", label: "Death Year", type: "yearOrLiving" },
    { slug: "country", label: "Country", type: "countryCode" },
    // Derived, not a D1 column — entity-records.ts pre-builds from birth_year/death_year (formatLifespan,
    // scripts/format.ts) so a template can bind the range as one field.
    { slug: "life_span", label: "Birth–Death Years", type: "string" },
    { slug: "bio", label: "Bio", type: "text" },
    { slug: "image", label: "Image", type: "image" },
    { slug: "tags", label: "Tags", type: "list" },
    { slug: "citations", label: "Citations", type: "citations" },
    { slug: "entry_date", label: "Added", type: "date" },
    { slug: "change_date", label: "Last Updated", type: "date" }
]

const CONTRIBUTOR_FIELDS: readonly EntityField[] = [
    { slug: "name", label: "Name", type: "string" },
    { slug: "class_year", label: "Class Year", type: "number" },
    { slug: "major", label: "Major", type: "string" },
    { slug: "bio", label: "Bio", type: "text" },
    { slug: "public_email", label: "Email", type: "email" },
    { slug: "image", label: "Image", type: "image" },
    { slug: "tags", label: "Tags", type: "list" },
    { slug: "entry_date", label: "Added", type: "date" },
    { slug: "change_date", label: "Last Updated", type: "date" }
]

const COMPOSITION_FIELDS: readonly EntityField[] = [
    { slug: "name", label: "Name", type: "string" },
    { slug: "id", label: "ID", type: "number" },
    { slug: "type", label: "Type", type: "string" },
    { slug: "part", label: "Part", type: "string" },
    { slug: "image", label: "Image", type: "image" },
    { slug: "composer", label: "Composer", type: "reference", refNoun: "composer" },
    { slug: "author_secondary", label: "Secondary Authors", type: "referenceListWithRole", refNoun: "composer" },
    { slug: "contrib_primary_1", label: "Primary Contributor", type: "reference", refNoun: "contributor" },
    { slug: "contrib_primary_2", label: "Additional Primary Contributor", type: "reference", refNoun: "contributor" },
    { slug: "contrib_addl", label: "Additional Contributors", type: "referenceList", refNoun: "contributor" },
    // Combines contrib_primary_1/_2/contrib_addl into one line — that distinction is internal-only
    // (owner decision), shouldn't appear on a public page
    { slug: "contributors", label: "Contributors (single line)", type: "referenceList", refNoun: "contributor" },
    { slug: "phases", label: "Phases", type: "list" },
    { slug: "key", label: "Key", type: "string" },
    { slug: "range", label: "Range", type: "string" },
    { slug: "position_highest", label: "Highest Position", type: "string" },
    { slug: "rating_suzuki", label: "Suzuki Rating", type: "number" },
    { slug: "rating_nyssma", label: "NYSSMA Rating", type: "number" },
    { slug: "publish_name", label: "Publisher Name", type: "string" },
    { slug: "publish_location", label: "Publication Location", type: "string" },
    { slug: "publish_year", label: "Publication Year", type: "number" },
    { slug: "publication_uri", label: "Publication Link", type: "uri" },
    { slug: "notes_historical", label: "Historical Notes", type: "text" },
    { slug: "notes_pedagogical", label: "Pedagogical Notes", type: "text" },
    { slug: "notes_other", label: "Other Notes", type: "text" },
    { slug: "tags", label: "Tags", type: "list" },
    { slug: "citations", label: "Citations", type: "citations" },
    { slug: "entry_date", label: "Added", type: "date" },
    { slug: "change_date", label: "Last Updated", type: "date" }
]

const ENTITY_FIELDS: Record<EntityNoun, readonly EntityField[]> = {
    composer: COMPOSER_FIELDS,
    contributor: CONTRIBUTOR_FIELDS,
    composition: COMPOSITION_FIELDS
}

/** Outlet-eligible fields for one entity noun. Synchronous, fixed by the D1 schema, not a live read. */
export function entityFields(noun: EntityNoun): readonly EntityField[] {
    return ENTITY_FIELDS[noun]
}

/** Whether a resolved entity-field value counts as "empty" for a field kind */
export function isEmptyFieldValue(value: unknown, kind: string | undefined): boolean {
    if (value === null || value === undefined) return true
    switch (kind) {
        case "reference":
            return !isRecord(value) || typeof value.name !== "string" || value.name.trim() === ""
        case "referenceList":
        case "referenceListWithRole":
        case "list":
            return !Array.isArray(value) || value.length === 0
        case "uri":
            return !isRecord(value) || typeof value.uri !== "string" || value.uri.trim() === ""
        case "citations":
            return !isRecord(value) || Object.keys(value).length === 0
        case "number":
        case "yearOrLiving":
        case "date": // entry_date/change_date are epoch-millisecond numbers
            return typeof value !== "number"
        case "portableText":
            return !Array.isArray(value) || value.length === 0
        case "image":
            return mediaSource(value) === null
        case "string":
        case "text":
        case "countryCode":
        default:
            return typeof value !== "string" || value.trim() === ""
    }
}
