/**
 * lib/compositor/entity-fields.ts
 *
 * Static outlet field catalog for the three D1-backed entity types (composers, compositions,
 * contributors) — synchronous, hand-authored, unlike `design-api.ts`'s `fetchCollectionFields`:
 * entities aren't an EmDash collection, no schema endpoint to ask.
 *
 * Unified field-outlet rewrite: every meaningful D1 column per noun is bindable, no separate
 * "dedicated block" noun. A foreign key (composer_id, contrib_primary_1, contrib_addl, …) is never
 * exposed as its raw id — declared here as "reference"/"referenceList", resolved to name+link by
 * `entity-records.ts`'s normalizer before render. Audit-only columns omitted (raw `*_id` PKs, `active`
 * — an authorization-only column, stripped before a contributor record ever reaches this catalog; a
 * rendered contributor's page existence depends on its `hidden` tag, not `active` — see
 * `d1-schema.ts`'s `isHiddenContributor`). `entry_date`/`change_date` exposed as "date" for
 * created/last-modified headers (owner decision).
 *
 * Public-page labels here are NOT shared with the admin's `composition-fields.ts` — that module keeps
 * its own ID-oriented labels ("Composer ID", "Secondary Author IDs") for `CompositionInfo.astro`;
 * public fields resolve FKs to names, never raw ids.
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
 * Public `/entity/{slug}/...` URL segment for each entity noun — the same internal/public split as
 * {@link ENTITY_NOUN_LABELS}, applied to the route instead of the title: "composition" is the internal/
 * database name and never appears in a public URL, so its slug is "work" while composer and contributor
 * keep their internal names as their slugs.
 */
export const ENTITY_NOUN_SLUGS: Record<EntityNoun, string> = {
    composer: "composer",
    composition: "work",
    contributor: "contributor"
}

/**
 * Closed vocabulary a bindable entity field can be — kept to what the D1 columns actually are, no
 * speculative kinds. Notable ones: `"yearOrLiving"` — composer death_year, -1 sentinel formats as
 * "Present" (mirrors `ComposerInfo.astro`/`format.ts`); `"countryCode"` — ISO 3166-1, formats to
 * English display name; `"email"` — renders `mailto:`; `"titleCase"` — composer role, title-cased
 * regardless of entry; `"citations"` — key-value map rendered as hyperlink list (scripts/citations.ts);
 * `"referenceListWithRole"` — `author_secondary` only, a `referenceList` whose tiles also show each
 * resolved composer's `role` (title-cased) in parentheses after their name.
 * "string"/"text"/"image" deliberately reuse `OUTLET_PROPS`'s (catalog.tsx) vocabulary for
 * `ContentText`/`ContentImage`, so those two work unmodified against entity fields; the rest are new
 * kinds only `ContentField` accepts.
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
    // (owner decision), shouldn't appear on a public page. Additive, not a replacement: an existing
    // template binding those separately keeps working; new ones can opt into this instead.
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

/** Outlet-eligible fields for one entity noun. Synchronous — fixed by the D1 schema, not a live read. */
export function entityFields(noun: EntityNoun): readonly EntityField[] {
    return ENTITY_FIELDS[noun]
}

/** Whether a resolved entity-field value counts as "empty" for a field kind — single source of truth
 * shared by `lint.ts`'s empty-outlet warning and `catalog.tsx`'s `ContentField` on-empty display
 * control; the two must agree. `kind` is `string | undefined`, not `EntityFieldKind`, because callers
 * also pass a `CollectionField.type` (pages/posts schemas) — those exercise the default branch. */
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
        case "string":
        case "text":
        case "countryCode":
        default:
            return typeof value !== "string" || value.trim() === ""
    }
}
