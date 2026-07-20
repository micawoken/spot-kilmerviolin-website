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

import { isRecord } from "./types"

/** The three D1-backed object types a template can render one record of, once Step 5 wires them in. */
export type EntityNoun = "composer" | "composition" | "contributor"

export const ENTITY_NOUNS: readonly EntityNoun[] = ["composer", "composition", "contributor"]

/** Whether a string names an entity noun (as opposed to an EmDash collection slug). */
export function isEntityNoun(value: string): value is EntityNoun {
    return (ENTITY_NOUNS as readonly string[]).includes(value)
}

/**
 * Public-facing plural label for each entity noun. "composition" is the internal/database name; the
 * public object name is "work", so its label reads "Works" everywhere a noun is titled on a public page
 * (the database root nav, an entity index page's title/h1, etc.) — composer and contributor already
 * match their internal names, so only composition's label diverges.
 */
export const ENTITY_NOUN_LABELS: Record<EntityNoun, string> = {
    composer: "Composers",
    composition: "Works",
    contributor: "Contributors"
}

/**
 * The closed vocabulary a bindable entity field can be. Deliberately kept to what the D1 columns
 * actually are (no speculative kinds): plain scalars ("string"/"text"/"number"), a formatted timestamp
 * ("date"), a resolved foreign key ("reference"/"referenceList"), a joined array ("list"), a media
 * reference ("image"), the composition-only publication link composite ("uri"), a composer's death_year
 * (`"yearOrLiving"` — the -1 "still living" sentinel formats as "Present", mirroring the admin's
 * `ComposerInfo.astro`/`format.ts` treatment), a composer's ISO 3166-1 country code (`"countryCode"`
 * — formats to its English display name), a contributor's public email (`"email"` — renders as a
 * `mailto:` link), a composer's role (`"titleCase"` — title-cased for display regardless of how it
 * was entered), and a composer/composition's optional citations map (`"citations"` — a key-value object
 * rendered as a list of hyperlinks, the key as display text; see scripts/citations.ts).
 * "string"/"text"/"image" intentionally reuse the same
 * vocabulary `OUTLET_PROPS` (catalog.tsx) already accepts for `ContentText`/`ContentImage`, so those two
 * components work unmodified against entity fields; the rest are new kinds only `ContentField` accepts.
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
    // Derived, not a D1 column: entity-records.ts's normalizer pre-builds this from birth_year/death_year
    // (see formatLifespan in scripts/format.ts) so a template can bind the range as one field.
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
    { slug: "author_secondary", label: "Secondary Authors", type: "referenceList", refNoun: "composer" },
    { slug: "contrib_primary_1", label: "Primary Contributor", type: "reference", refNoun: "contributor" },
    { slug: "contrib_primary_2", label: "Additional Primary Contributor", type: "reference", refNoun: "contributor" },
    { slug: "contrib_addl", label: "Additional Contributors", type: "referenceList", refNoun: "contributor" },
    // Combines contrib_primary_1/_2/contrib_addl into one line, since the primary/additional-primary/
    // additional distinction is internal-only (owner decision) and shouldn't have to appear on a public
    // page — kept alongside the individual fields above (not a replacement) so an already-authored
    // template binding those separately keeps working; a template can opt into this single-line field
    // instead when convenient.
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

/**
 * Whether a resolved entity-field value counts as "empty" for a given field kind. The single source of
 * truth for that judgment — shared by `lint.ts`'s advisory empty-outlet-value warning and `catalog.tsx`'s
 * `ContentField` outlet, whose on-empty display control (show a placeholder, hide the label, or leave it
 * as-is) must agree with what the lint pass warns about. `kind` is untyped `string | undefined` rather
 * than `EntityFieldKind` because callers also pass it a `CollectionField.type` (pages/posts schemas,
 * which never produce a reference/date/list/uri/yearOrLiving/countryCode-shaped value in practice, so the
 * default branch is what those exercise).
 *
 * @param {unknown} value - the raw (already reference-resolved, per entity-records.ts) field value
 * @param {string | undefined} kind - the bound field's declared kind, when known
 * @returns {boolean} true if the value carries nothing worth displaying
 */
export function isEmptyFieldValue(value: unknown, kind: string | undefined): boolean {
    if (value === null || value === undefined) return true
    switch (kind) {
        case "reference":
            return !isRecord(value) || typeof value.name !== "string" || value.name.trim() === ""
        case "referenceList":
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
        case "string":
        case "text":
        case "countryCode":
        default:
            return typeof value !== "string" || value.trim() === ""
    }
}
