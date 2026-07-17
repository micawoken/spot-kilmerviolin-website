/**
 * lib/compositor/entity-fields.ts
 *
 * Static outlet field catalog for the three D1-backed entity types (composers, compositions,
 * contributors) — the entity analog of `design-api.ts`'s `fetchCollectionFields`, but synchronous and
 * hand-authored rather than read live from EmDash: entities are not an EmDash collection, so there is
 * no schema endpoint to ask.
 *
 * Unified field-outlet rewrite: every meaningful D1 column for each noun is bindable — there is no
 * separate "dedicated block" noun. A foreign-key column (composer_id, contrib_primary_1, contrib_addl,
 * …) is never exposed as its raw id; it is declared here as "reference"/"referenceList" and resolved to
 * a display name + link by `entity-records.ts`'s normalizer before it ever reaches a render. Internal
 * audit-only columns are omitted (raw `*_id` primary keys, the `active` flag — every rendered contributor
 * is active by definition). `entry_date`/`change_date` ARE exposed, as "date" kind fields, for building
 * created/last-modified headers (owner decision).
 *
 * Public-page labels here are NOT shared with the admin's `composition-fields.ts` — that module keeps
 * its own ID-oriented labels ("Composer ID", "Secondary Author IDs") for `CompositionInfo.astro`'s admin
 * card, which intentionally differs from this catalog's public labels (public fields resolve FKs to
 * names, never raw ids).
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

/** The three D1-backed object types a template can render one record of, once Step 5 wires them in. */
export type EntityNoun = "composer" | "composition" | "contributor"

export const ENTITY_NOUNS: readonly EntityNoun[] = ["composer", "composition", "contributor"]

/** Whether a string names an entity noun (as opposed to an EmDash collection slug). */
export function isEntityNoun(value: string): value is EntityNoun {
    return (ENTITY_NOUNS as readonly string[]).includes(value)
}

/**
 * The closed vocabulary a bindable entity field can be. Deliberately kept to what the D1 columns
 * actually are (no speculative kinds): plain scalars ("string"/"text"/"number"), a formatted timestamp
 * ("date"), a resolved foreign key ("reference"/"referenceList"), a joined array ("list"), a media
 * reference ("image"), and the composition-only publication link composite ("uri"). "string"/"text"/
 * "image" intentionally reuse the same vocabulary `OUTLET_PROPS` (catalog.tsx) already accepts for
 * `ContentText`/`ContentImage`, so those two components work unmodified against entity fields; the rest
 * are new kinds only `ContentField` accepts.
 */
export type EntityFieldKind =
    | "string"
    | "text"
    | "number"
    | "date"
    | "reference"
    | "referenceList"
    | "list"
    | "image"
    | "uri"

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
    { slug: "role", label: "Role", type: "string" },
    { slug: "birth_year", label: "Birth Year", type: "number" },
    { slug: "death_year", label: "Death Year", type: "number" },
    { slug: "country", label: "Country", type: "string" },
    { slug: "bio", label: "Bio", type: "text" },
    { slug: "image", label: "Image", type: "image" },
    { slug: "tags", label: "Tags", type: "list" },
    { slug: "entry_date", label: "Added", type: "date" },
    { slug: "change_date", label: "Last Updated", type: "date" }
]

const CONTRIBUTOR_FIELDS: readonly EntityField[] = [
    { slug: "name", label: "Name", type: "string" },
    { slug: "class_year", label: "Class Year", type: "number" },
    { slug: "major", label: "Major", type: "string" },
    { slug: "bio", label: "Bio", type: "text" },
    { slug: "public_email", label: "Email", type: "string" },
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
    { slug: "author_secondary", label: "Secondary Authors", type: "referenceList", refNoun: "composer" },
    { slug: "contrib_primary_1", label: "Primary Contributor", type: "reference", refNoun: "contributor" },
    { slug: "contrib_primary_2", label: "Additional Primary Contributor", type: "reference", refNoun: "contributor" },
    { slug: "contrib_addl", label: "Additional Contributors", type: "referenceList", refNoun: "contributor" },
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
    { slug: "entry_date", label: "Added", type: "date" },
    { slug: "change_date", label: "Last Updated", type: "date" }
]

const ENTITY_FIELDS: Record<EntityNoun, readonly EntityField[]> = {
    composer: COMPOSER_FIELDS,
    contributor: CONTRIBUTOR_FIELDS,
    composition: COMPOSITION_FIELDS
}

/**
 * The outlet-eligible fields for one entity noun. Always returns synchronously (no fetch) — entity
 * fields are fixed by the D1 schema, not a live EmDash read.
 *
 * @param {EntityNoun} noun - the entity type
 * @returns {readonly EntityField[]} that noun's outlet-eligible fields
 */
export function entityFields(noun: EntityNoun): readonly EntityField[] {
    return ENTITY_FIELDS[noun]
}
