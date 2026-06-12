/**
 * scripts/types.ts
 * 
 * Stores object types corresponding with API types in types.d.ts for use client-side
 * 
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
 * 
 */


/**
 * Type for two-element array
 * 
 * First element is type indicator
 * Second element is whether it can be omitted when the form is in required mode
 */
export type FieldPair = [string, boolean]

type CustomObjectParser = [any, (...args: any[]) => any, string[]]

const supported_uri = ["https", "isbn", "doi"]

/**
 * Types interface for object generator
 * 
 * 
 */
export const composer_interface: Record<string, FieldPair> = {
    "name": ["string", false],
    "birth_year": ["number", false],
    "death_year": ["number", false],
    "country": ["string", false],
    "bio": ["string", true],
    "image": ["string", true],
    "role": ["string", false],
    "tags": ["string[]", true]
}

// class_year, major, and phases map to nullable database columns: they are optional, and
// phases uses the nullable-array type ("number[]?") so an empty input is sent as null, not []
export const contributor_interface_full: Record<string, FieldPair> = {
    "name": ["string", false],
    "class_year": ["number", true],
    "major": ["string", true],
    "bio": ["string", true],
    "public_email": ["string", true],
    "identity_email": ["string", false],
    "image": ["string", true],
    "phases": ["number[]?", true],
    "roles": ["string[]", true],
    "tags": ["string[]", true],
    "active": ["boolean", false],
    "admin": ["boolean", false]
}

export const contributor_interface_partial: Record<string, FieldPair> = {
    "name": ["string", false],
    "class_year": ["number", true],
    "major": ["string", true],
    "bio": ["string", true],
    "public_email": ["string", true],
    "identity_email": ["string", false],
    "image": ["string", true],
    "phases": ["number[]?", true],
    "tags": ["string[]", true],
    "active": ["boolean", false]
}

export const composition_interface: Record<string, FieldPair> = {
    "name": ["string", false],
    "composer_id": ["number", false],
    "contrib_primary_1": ["number", false],
    "contrib_primary_2": ["number", true],
    "contrib_addl": ["number[]", true],
    "type": ["string", false],
    "part": ["string", true],
    "key": ["string", true],
    "range": ["string", true],
    "position_highest": ["string", true],
    "notes_pedagogical": ["string", true],
    "notes_historical": ["string", true],
    "notes_other": ["string", true],
    "image": ["string", true],
    "rating": ["X-Rating", true],
    "publication_info": ["X-Publication-Info", true],
    "author_secondary": ["number[]", true], // list of secondary authors
    "phases": ["number[]", true],
    "tags": ["string[]", true]
}

export const interface_data: Record<string, {
    interface: Record<string, FieldPair>,
    name: string,
    custom_objects?: (keyof typeof custom_object_parsers)[]
}> = {
    "composer": {
        interface: composer_interface,
        name: "composer"
    },
    "contributor_full": {
        interface: contributor_interface_full,
        name: "contributor"
    },
    "contributor_partial": {
        interface: contributor_interface_partial,
        name: "contributor"
    },
    "composition": {
        interface: composition_interface,
        name: "composition",
        custom_objects: ["X-Rating", "X-Publication-Info"]
    }
}


export const rating_constructor: Record<string, FieldPair> = {
    "suzuki": ["number", false],
    "nyssma": ["number", false]
}

export const pubinfo_constructor: Record<string, FieldPair> = {
    "name": ["string", false],
    "location": ["string", false],
    "year": ["number", false],
    "uri_type": ["string", false],
    "uri": ["string", false]
}

/**
 * Parses a rating member that maps to a nullable column
 *
 * Returns null for blank input (stored as NULL), the parsed number when valid,
 * and undefined when the input is non-blank but invalid (rejecting the construction)
 */
function parseNullableRating(raw: string | null, min: number, max: number): number | null | undefined {
    if (raw === null || raw.trim() === "") {
        return null
    }
    const num = parseInt(raw)
    if (isNaN(num) || num < min || num > max) {
        return undefined
    }
    return num
}

export function constructRating(suzuki: string | null, nyssma: string | null): CompositionRating | null {
    // rating_suzuki and rating_nyssma are independently nullable columns: blank inputs become null members
    const suzuki_num = parseNullableRating(suzuki, 1, 10)
    const nyssma_num = parseNullableRating(nyssma, 1, 6)
    if (suzuki_num === undefined || nyssma_num === undefined) {
        return null
    }
    return {
        suzuki: suzuki_num,
        nyssma: nyssma_num
    }
}

export function constructPubInfo(name: string | null, location: string | null, year: string | null, uri_type: string | null, uri: string | null): PublicationInfo | null {
    // publish_name, publish_location, publish_year, and uri_type are NOT NULL columns; year must parse and uri_type must be supported
    const year_num = parseInt(year ?? "")
    if (isNaN(year_num) || uri_type === null || !supported_uri.includes(uri_type)) {
        return null
    }
    return {
        name: name ?? "",
        location: location ?? "",
        year: year_num,
        uri_type: uri_type,
        uri: uri ?? ""
    }
}

export const custom_object_parsers: Record<string, CustomObjectParser> = {
    "X-Rating": ["rating", constructRating, ["rating_suzuki", "rating_nyssma"]],
    // params are spread positionally into the constructor, so their order must match the constructor signature
    "X-Publication-Info": ["publication_info", constructPubInfo, ["publish_name", "publish_location", "publish_year", "uri_type", "uri"]]
}