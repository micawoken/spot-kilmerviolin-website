/**
 * lib/api/tables.ts
 *
 * Primitive schema information, available for import by the compositor system
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

/*
 * D1 table spec info
 *
 * CREATE TABLE contributors (
 *   contributor_id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   name TEXT UNIQUE NOT NULL,
 *   class_year INTEGER,
 *   major TEXT,
 *   phases TEXT,
 *   bio TEXT,
 *   public_email TEXT,
 *   identity_email TEXT UNIQUE NOT NULL,
 *   active INTEGER NOT NULL,
 *   roles TEXT NOT NULL,
 *   admin INTEGER NOT NULL,
 *   image TEXT,
 *   tags TEXT,
 *   entry_date INTEGER NOT NULL,
 *   change_date INTEGER
 * );
 *
 * CREATE TABLE composers (
 *   composer_id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   name TEXT NOT NULL,
 *   role TEXT NOT NULL,
 *   birth_year INTEGER NOT NULL,
 *   death_year INTEGER NOT NULL,
 *   country TEXT NOT NULL,
 *   bio TEXT,
 *   image TEXT,
 *   tags TEXT,
 *   citations TEXT,
 *   entry_date INTEGER NOT NULL,
 *   change_date INTEGER,
 *   UNIQUE (name, role)
 * );
 *
 * CREATE TABLE compositions (
 *   composition_id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   name TEXT NOT NULL,
 *   composer_id INTEGER NOT NULL,
 *   contrib_primary_1 INTEGER NOT NULL,
 *   contrib_primary_2 INTEGER,
 *   contrib_addl TEXT,
 *   author_secondary TEXT,
 *   type TEXT NOT NULL,
 *   part TEXT,
 *   rating_suzuki INTEGER,
 *   rating_nyssma INTEGER,
 *   publish_location TEXT NOT NULL,
 *   publish_name TEXT NOT NULL,
 *   publish_year INTEGER NOT NULL,
 *   uri_type TEXT NOT NULL,
 *   uri TEXT,
 *   key TEXT,
 *   range TEXT,
 *   position_highest TEXT,
 *   notes_pedagogical TEXT,
 *   notes_historical TEXT,
 *   notes_other TEXT,
 *   image TEXT,
 *   phases TEXT NOT NULL,
 *   tags TEXT,
 *   citations TEXT,
 *   entry_date INTEGER NOT NULL,
 *   change_date INTEGER,
 *   FOREIGN KEY (composer_id) REFERENCES composers(composer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
 *   FOREIGN KEY (contrib_primary_1) REFERENCES contributors(contributor_id) ON UPDATE CASCADE ON DELETE RESTRICT,
 *   FOREIGN KEY (contrib_primary_2) REFERENCES contributors(contributor_id) ON UPDATE CASCADE ON DELETE RESTRICT
 * );
 */

/**
 * Table shape for contributors, without a database binding
 */
export const CONTRIBUTOR_TABLE: D1SchemaPrimitive = {
    name: "contributors",
    columns: [
        "contributor_id",
        "name",
        "class_year",
        "major",
        "phases",
        "bio",
        "public_email",
        "identity_email",
        "active",
        "roles",
        "admin",
        "image",
        "tags",
        "entry_date",
        "change_date"
    ],
    index: ["contributor_id", "identity_email", "public_email"],
    repr_exclude: ["entry_date", "change_date"],
    primary_key: "contributor_id",
    type_hint: {
        contributor_id: "number",
        name: "string",
        class_year: "number",
        major: "string",
        phases: "string", // comma-separated phase numbers, which are converted to a number array later
        bio: "string",
        public_email: "string",
        identity_email: "string",
        active: "number",
        roles: "string", // also a comma-separated string array
        admin: "number",
        image: "string",
        tags: "string",
        entry_date: "number",
        change_date: "number"
    },
    // "active" belongs here with the other authorization columns: it is the system's revocation
    // mechanism short of removing the user from Access, and PATCH /api/v1/contributors/[id] runs in
    // selfmgmt mode — which admits an INACTIVE caller — so without it a deactivated user could PATCH
    // their own record back to active and regain every permission their roles carry. Self-deactivation
    // is unaffected: it has its own route (DELETE /api/v1/identity/self), which does not consult this list.
    protected: ["roles", "admin", "identity_email", "active"]
}

/**
 * Table shape for composers, without a database binding
 */
export const COMPOSER_TABLE: D1SchemaPrimitive = {
    name: "composers",
    columns: [
        "composer_id",
        "name",
        "role",
        "birth_year",
        "death_year",
        "country",
        "bio",
        "image",
        "tags",
        "citations",
        "entry_date",
        "change_date"
    ],
    index: ["composer_id", "name"],
    repr_exclude: ["entry_date", "change_date"],
    primary_key: "composer_id",
    type_hint: {
        composer_id: "number",
        name: "string",
        role: "string",
        birth_year: "number",
        death_year: "number",
        country: "string",
        bio: "string",
        image: "string",
        tags: "string",
        citations: "string", // JSON-encoded { [sourceName]: httpsLink | doi | isbn }, "" when empty
        entry_date: "number",
        change_date: "number"
    }
}

/**
 * Table shape for compositions, without a database binding
 */
export const COMPOSITION_TABLE: D1SchemaPrimitive = {
    name: "compositions",
    // columns use shape of Composition interface
    columns: [
        "composition_id",
        "name",
        "composer_id",
        "contrib_primary_1",
        "contrib_primary_2",
        "contrib_addl",
        "author_secondary",
        "type",
        "part",
        "rating_suzuki",
        "rating_nyssma",
        "publish_location",
        "publish_name",
        "publish_year",
        "uri_type",
        "uri",
        "key",
        "range",
        "position_highest",
        "notes_pedagogical",
        "notes_historical",
        "notes_other",
        "image",
        "phases",
        "tags",
        "citations",
        "entry_date",
        "change_date"
    ],
    index: ["composition_id"],
    repr_exclude: ["entry_date", "change_date"],
    primary_key: "composition_id",
    type_hint: {
        composition_id: "number",
        name: "string",
        composer_id: "number",
        contrib_primary_1: "number", // contributor ID
        contrib_primary_2: "number",
        contrib_addl: "string", // comma-separated contributor IDs
        author_secondary: "string", // comma-separated secondary composer IDs
        type: "string",
        part: "string",
        rating_suzuki: "number",
        rating_nyssma: "number",
        publish_location: "string",
        publish_name: "string",
        publish_year: "number",
        uri_type: "string",
        uri: "string",
        key: "string",
        range: "string",
        position_highest: "string",
        notes_pedagogical: "string",
        notes_historical: "string",
        notes_other: "string",
        image: "string",
        phases: "string", // comma-separated phase numbers, which are converted to a number array later
        tags: "string",
        citations: "string", // JSON-encoded { [sourceName]: httpsLink | doi | isbn }, "" when empty
        entry_date: "number",
        change_date: "number"
    }
}
