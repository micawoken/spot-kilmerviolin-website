/**
 * lib/api/common.ts
 *
 * Provides common services for API endpoints, such as decomposing and composing objects
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
 */

import { normalizePitchRange, normalizePosition } from "./validation"

// the composition range and highest-position fields are stored in canonical form: a range has its note
// letters uppercased, and a position is always stored as an (uppercase) Roman numeral (an integer input
// is converted). Blank/null values pass through unchanged. Inputs are validated before reaching here.
const normalizeRangeValue = (value: any): any =>
    typeof value === "string" && value.trim() !== "" ? normalizePitchRange(value) : value
const normalizePositionValue = (value: any): any =>
    typeof value === "string" && value.trim() !== "" ? normalizePosition(value) : value

// types

/**
 * Expresses the available SQL comparison operations used by WHERE clauses
 */
export enum SQLCompareOp {
    EQ = "=",
    NEQ = "<>",
    GT = ">",
    GTE = ">=",
    LT = "<",
    LTE = "<=",
    IN = "IN",
    NOT_IN = "NOT IN",
    LIKE = "LIKE",
    NOT_LIKE = "NOT LIKE",
    BETWEEN = "BETWEEN",
    NOT_BETWEEN = "NOT BETWEEN"
}

/**
 * Lists the available work types
 */
export enum WorkType {
    // defines available work types
    OTHER = "Other",
    CHAMBER = "Chamber",
    ORCHESTRA_FULL = "Full Orchestra",
    ORCHESTRA_STRING = "String Orchestra",
    PROGRAMMATIC = "Programmatic",
    SOLO_ACCOMPANIED = "Solo - Accompanied",
    SOLO_UNACCOMPANIED = "Solo - Unaccompanied",
    IRISH = "Traditional Irish" // additional entries should be added after the last entry

    // see lib/api/README.md for contact info on updating this enum
}

/**
 * Lists the available keys
 */
export enum Key {
    // key equivalency (enharmonics) are provided by a function in api/common.ts
    C_MAJOR = "C Major",
    C_MINOR = "C Minor",
    Cs_MAJOR = "C# Major",
    Cs_MINOR = "C# Minor",
    Db_MAJOR = "Db Major",
    Db_MINOR = "Db Minor",
    D_MAJOR = "D Major",
    D_MINOR = "D Minor",
    Ds_MAJOR = "D# Major",
    Ds_MINOR = "D# Minor",
    Eb_MAJOR = "Eb Major",
    Eb_MINOR = "Eb Minor",
    E_MAJOR = "E Major",
    E_MINOR = "E Minor",
    Es_MAJOR = "E# Major",
    Es_MINOR = "E# Minor",
    Fb_MAJOR = "Fb Major",
    Fb_MINOR = "Fb Minor",
    F_MAJOR = "F Major",
    F_MINOR = "F Minor",
    Fs_MAJOR = "F# Major",
    Fs_MINOR = "F# Minor",
    Gb_MAJOR = "Gb Major",
    Gb_MINOR = "Gb Minor",
    G_MAJOR = "G Major",
    G_MINOR = "G Minor",
    Gs_MAJOR = "G# Major",
    Gs_MINOR = "G# Minor",
    Ab_MAJOR = "Ab Major",
    Ab_MINOR = "Ab Minor",
    A_MAJOR = "A Major",
    A_MINOR = "A Minor",
    As_MAJOR = "A# Major",
    As_MINOR = "A# Minor",
    Bb_MAJOR = "Bb Major",
    Bb_MINOR = "Bb Minor",
    B_MAJOR = "B Major",
    B_MINOR = "B Minor",
    Cb_MAJOR = "Cb Major",
    Cb_MINOR = "Cb Minor"
}

/**
 * Lists the available author roles
 */
export enum AuthorRole {
    COMPOSER = "composer",
    ARRANGER = "arranger",
    LYRICIST = "lyricist",
    TRANSCRIBER = "transcriber",
    EDITOR = "editor",
    OTHER = "other"
}

// AUTHENTICATE/AUTHORIZE functions

/**
 * Returns a record of cookie key-value pairs from the Cookie header
 *
 * @param {string} cookie_header - the value of the Cookie header
 * @return {Record<string, string>} an object mapping cookie names to their values
 *
 */
export function parseCookieHeader(cookie_header: string): Record<string, string> {
    // borrowed from the mwm-go-shorturl project
    if (cookie_header === "") {
        return {}
    }
    const pairs = cookie_header.split(";")
    const cookies = pairs.reduce<Record<string, string>>((acc, current) => {
        const [name, value] = current
            .trim()
            .split("=")
            .map((i) => i.trim())
        if (name && value) {
            acc[name] = decodeURIComponent(value)
        }
        return acc
    }, {})
    return cookies
}

// D1 functions

/**
 * Converts a SQL spec_line in an SQLStatement object to the equivalent SQL command comparison substring
 *
 * @param { [string, string | string[], SQLCompareOp] } spec_line - a tuple of the form [parameter name, parameter value(s), SQL comparison operator]
 * @return {[string, Array<string>]} a tuple of the form [SQL command comparison substring, parameter values]
 */
export function sqlPrepOp(spec_line: [string, string | string[], SQLCompareOp]): [string, Array<string>] {
    const [param, value, op] = spec_line
    switch (op) {
        case SQLCompareOp.EQ:
        case SQLCompareOp.NEQ:
        case SQLCompareOp.GT:
        case SQLCompareOp.GTE:
        case SQLCompareOp.LT:
        case SQLCompareOp.LTE:
            if (typeof value !== "string") {
                throw new Error(`Invalid value type for operator ${op}: expected string, got ${typeof value}`)
            }
            return [`${param} ${op} ?`, [value]]
        case SQLCompareOp.IN:
        case SQLCompareOp.NOT_IN:
            if (!Array.isArray(value)) {
                throw new Error(`Invalid value type for operator ${op}: expected array, got ${typeof value}`)
            }
            if (value.length === 0) {
                // an empty list would generate "IN ()", which is a SQLite syntax error
                throw new Error(`Invalid value for operator ${op}: expected a non-empty array`)
            }
            return [`${param} ${op} (${value.map(() => "?").join(", ")})`, value]
        case SQLCompareOp.LIKE:
        case SQLCompareOp.NOT_LIKE:
            if (typeof value !== "string") {
                throw new Error(`Invalid value type for operator ${op}: expected string, got ${typeof value}`)
            }
            return [`${param} ${op} ?`, [value]]
        case SQLCompareOp.BETWEEN:
        case SQLCompareOp.NOT_BETWEEN:
            if (!Array.isArray(value) || value.length !== 2) {
                throw new Error(
                    `Invalid value type for operator ${op}: expected array of length 2, got ${typeof value} with length ${Array.isArray(value) ? value.length : "N/A"}`
                )
            }
            return [`${param} ${op} ? AND ?`, value]
        default:
            throw new Error(`Unsupported SQL operator: ${op}`)
    }
}

/**
 * Prepares a full SQL clause (WHERE, ORDER BY, and *column list*) using a list of SQL spec_lines from an SQLStatement object
 *
 * @param {Array<[string, string | string[], SQLCompareOp]>} spec - a list of tuples of the form [parameter name, parameter value(s), SQL comparison operator]
 * @param {"columns" | "where" | "order"} exec_mode - the type of SQL clause to prepare
 * @return {[string, Array<string>]} a tuple of the form [SQL clause, parameter values]
 */
export function sqlListJoin(
    spec: Array<[string, (string | string[])?, SQLCompareOp?]>,
    exec_mode: "columns" | "where" | "order" = "columns"
): [string, Array<string>] {
    if (spec.length === 0) {
        return ["", []]
    }
    if (spec.length === 1) {
        const [param, value, op] = spec[0]
        if (exec_mode === "columns") {
            return [param, []]
        } else if (exec_mode === "order") {
            if (!value || (value !== "ASC" && value !== "DESC")) {
                throw new Error("Invalid value for order direction: expected 'ASC' or 'DESC'")
            }
            return [`${param} ${value}`, []]
            // value is assumed to be validated
        } else if (exec_mode === "where") {
            if (value === undefined) {
                // an empty string is a legitimate comparison value, so only undefined is rejected
                throw new Error("Value is required for where clauses")
            }
            if (!op) {
                throw new Error("SQL compare operator is required for where clauses")
            }
            return sqlPrepOp([param, value, op])
        }
    }
    // 2 or more objects
    let output = ""
    let params = []
    for (let i = 0; i < spec.length; i++) {
        const [param, value, op] = spec[i]
        if (i > 0 && exec_mode === "where") {
            output += " AND "
            // only AND is supported for now
        } else if (i > 0 && exec_mode === "columns") {
            output += ", "
            // if use params is false, then it is being used for list assembly (e.g., columns)
        } else if (i > 0 && exec_mode === "order") {
            output += ", "
            // the asc and desc instructions are specified in the composer
        }
        switch (exec_mode) {
            case "columns": {
                output += param
                break
            }
            case "order": {
                if (!value || (value !== "ASC" && value !== "DESC")) {
                    throw new Error("Invalid value for order direction: expected 'ASC' or 'DESC'")
                }
                output += `${param} ${value}`
                // again, the value is assumed to be validated; enforcement is managed by the SQLBuilder
                break
            }
            case "where": {
                if (value === undefined) {
                    // an empty string is a legitimate comparison value, so only undefined is rejected
                    throw new Error("Value is required for where clauses")
                }
                if (!op) {
                    throw new Error("SQL compare operator is required for where clauses")
                }
                const [sql, values] = sqlPrepOp([param, value, op])
                output += sql
                params.push(...values)
                break
            }
        }
    }

    return [output, params]
    // returns the SQL statement (ready to be prepared) and a list of parameters in order
}

// TYPE CONVERSION

function splitAndFilterItems(value: string): string[] {
    return value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "")
}

function splitAndFilterNumbers(value: string): number[] {
    return splitAndFilterItems(value).map((item) => parseInt(item, 10))
}

function joinAndFilterItems(values: Array<string | number>): string {
    return values
        .map((item) => item.toString().trim())
        .filter((item) => item !== "")
        .join(",")
}

/** A per-field transform used by {@link applyPartialFields}; mutates `output` for a defined `value`. */
type PartialFieldTransform = (value: any, output: Record<string, unknown>) => void

/**
 * Shared loop for the three format*ToD1Partial converters. Iterates a partial record, skipping the
 * `id` column (callers map it to the table's primary-key column) and any undefined field, then either
 * applies the field's transform or passes the value through unchanged.
 */
function applyPartialFields(
    record: Record<string, any>,
    output: Record<string, unknown>,
    transforms: { [field: string]: PartialFieldTransform }
): void {
    for (const key in record) {
        if (key === "id") {
            continue
        }
        const value = record[key]
        if (value === undefined) {
            continue
        }
        const transform = transforms[key]
        if (transform) {
            transform(value, output)
        } else {
            output[key] = value
        }
    }
}

/** Transform builder: joins an array field into a comma-separated string, or "" when not an array. */
const joinOrEmpty =
    (field: string): PartialFieldTransform =>
    (value, output) => {
        output[field] = Array.isArray(value) ? joinAndFilterItems(value) : ""
    }

/**
 * Converts a D1Composition object representation in D1 to CompositionRecord
 *
 * @param {D1Composition} record - the D1Composition object to convert
 * @return {CompositionRecord} the converted CompositionRecord object
 */
export function formatWorkFromD1(record: D1Composition): CompositionRecord {
    // converts the D1Composition object representation in D1 to CompositionRecord
    const {
        composition_id,
        rating_suzuki,
        rating_nyssma,
        author_secondary,
        contrib_addl,
        phases,
        publish_location,
        publish_name,
        publish_year,
        uri_type,
        uri,
        tags,
        ...data
    } = record
    const rating: CompositionRating = {
        suzuki: rating_suzuki,
        nyssma: rating_nyssma
    }
    const publish_info: PublicationInfo = {
        location: publish_location,
        name: publish_name,
        year: publish_year,
        uri_type: uri_type,
        uri: uri
    }
    const author_secondary_list = author_secondary ? splitAndFilterNumbers(author_secondary) : []
    const contrib_addl_list = contrib_addl ? splitAndFilterNumbers(contrib_addl) : []
    const phases_list = phases ? splitAndFilterNumbers(phases) : []
    const tag_list: string[] = tags ? splitAndFilterItems(tags) : []
    return {
        ...data,
        id: composition_id,
        author_secondary: author_secondary_list,
        contrib_addl: contrib_addl_list,
        rating: rating,
        publication_info: publish_info,
        phases: phases_list,
        tags: tag_list
    }
}

/**
 * Converts a Composition object to D1Composition
 *
 * @param {Composition | CompositionRecord} record - the Composition or CompositionRecord object to convert
 * @return {D1Composition} the converted D1Composition object
 */
export function formatWorkToD1(record: Composition | CompositionRecord): D1Composition {
    // converts a Composition object to D1Composition
    // if the supplied object is a Composition, and not a CompositionRecord, the id, entry_date, and change_date fields are set to null equivalents
    let author_secondary, contrib_addl, rating, phases, publication_info, id, entry_date, change_date, tags, data
    switch ("id" in record) {
        case true:
            // record is a CompositionRecord, so it has the id, entry_date, and change_date fields, which are used in the output
            ;({
                author_secondary,
                contrib_addl,
                rating,
                phases,
                publication_info,
                id,
                entry_date,
                change_date,
                tags,
                ...data
            } = record as CompositionRecord)

            break
        case false:
            // record is a Composition, so it does not have the id, entry_date, or change_date fields; these are set to null equivalents in the output
            ;({ author_secondary, contrib_addl, rating, phases, publication_info, tags, ...data } =
                record as Composition)
            id = null
            entry_date = null // it is assumed that Compositions retain their shape; also, entry_date is ignored for updates
            change_date = null // change_date is set by business logic on insert/update (see database.ts), not from the supplied object
            break
    }

    // the record could be a Composition or a CompositionRecord
    // missing/undefined members are normalized to null so downstream stringification cannot crash
    const rating_suzuki: number | null = rating ? (rating.suzuki ?? null) : null
    const rating_nyssma: number | null = rating ? (rating.nyssma ?? null) : null

    return {
        ...data,
        // store range and highest position in their canonical (normalized) form
        range: normalizeRangeValue((data as Record<string, any>).range),
        position_highest: normalizePositionValue((data as Record<string, any>).position_highest),
        entry_date: entry_date,
        change_date: change_date,
        composition_id: id ? id : -1, // if id is set to -1, it cannot be used as a valid primary key for update
        rating_suzuki: rating_suzuki,
        rating_nyssma: rating_nyssma,
        publish_location: publication_info.location,
        publish_name: publication_info.name,
        publish_year: publication_info.year,
        uri_type: publication_info.uri_type,
        uri: publication_info.uri,
        author_secondary: author_secondary ? joinAndFilterItems(author_secondary) : "",
        contrib_addl: contrib_addl ? joinAndFilterItems(contrib_addl) : "",
        phases: phases ? joinAndFilterItems(phases) : "",
        tags: tags ? joinAndFilterItems(tags) : ""
    }
}

/**
 * Converts a partial Composition object (with a required id field) to a partial D1Composition object, for use in UPDATE statements
 */
export function formatWorkToD1Partial(record: Partial<Composition> & { id: number }): Partial<D1Composition> {
    // used for UPDATE statements where only some columns are updated
    // the id field is required to identify the record to update, but other fields are optional and only included if they are being updated
    const output: Partial<D1Composition> = {
        composition_id: record.id
    }
    applyPartialFields(record as Record<string, any>, output as Record<string, unknown>, {
        author_secondary: joinOrEmpty("author_secondary"),
        contrib_addl: joinOrEmpty("contrib_addl"),
        phases: joinOrEmpty("phases"),
        tags: joinOrEmpty("tags"),
        // normalize range and highest position to their canonical stored form when present
        range: (value, out) => {
            out.range = normalizeRangeValue(value)
        },
        position_highest: (value, out) => {
            out.position_highest = normalizePositionValue(value)
        },
        rating: (value, out) => {
            if (
                typeof value === "object" &&
                value !== null &&
                !Array.isArray(value) &&
                "suzuki" in value &&
                "nyssma" in value
            ) {
                const rating = value as CompositionRating
                out.rating_suzuki = rating.suzuki !== undefined ? rating.suzuki : null
                out.rating_nyssma = rating.nyssma !== undefined ? rating.nyssma : null
            }
        },
        publication_info: (value, out) => {
            if (
                typeof value === "object" &&
                value !== null &&
                !Array.isArray(value) &&
                "location" in value &&
                "name" in value &&
                "year" in value &&
                "uri_type" in value &&
                "uri" in value
            ) {
                const publication_info = value as PublicationInfo
                out.publish_location = publication_info.location
                out.publish_name = publication_info.name
                out.publish_year = publication_info.year
                out.uri_type = publication_info.uri_type
                out.uri = publication_info.uri
            }
        }
    })
    return output
}

/**
 * Converts a D1Composer object representation in D1 to ComposerRecord
 *
 * @param {D1Composer} record - the D1Composer object to convert
 * @return {ComposerRecord} the converted ComposerRecord object
 */
export function formatCompFromD1(record: D1Composer): ComposerRecord {
    // converts the D1Composer object representation in D1 to ComposerRecord
    // ComposerRecord and D1Composer are very similar; the only difference is the id signifier
    const { composer_id, tags, ...data } = record
    return {
        ...data,
        id: composer_id,
        tags: tags ? splitAndFilterItems(tags) : []
    }
}

/**
 * Converts a Composer object to D1Composer
 *
 * @param {Composer | ComposerRecord} record - the Composer or ComposerRecord object to convert
 * @return {D1Composer} the converted D1Composer object
 */
export function formatCompToD1(record: Composer | ComposerRecord): D1Composer {
    // converts a Composer object to D1Composer
    let data, id, entry_date, change_date, tags
    switch ("id" in record) {
        case true:
            // record is a ComposerRecord, so it has the id, entry_date, and change_date fields, which are used in the output
            ;({ id, entry_date, change_date, tags, ...data } = record as ComposerRecord)
            break
        case false:
            // record is just Composer
            ;({ tags, ...data } = record as Composer)
            id = null
            entry_date = new Date().toISOString() // it is assumed that Composers retain their shape; also, entry_date is ignored for updates
            change_date = entry_date // change_date is set by business logic on insert/update (see database.ts); seeded to entry_date for a new record
            break
    }
    return {
        ...data,
        tags: tags ? joinAndFilterItems(tags) : "",
        entry_date: entry_date,
        change_date: change_date,
        composer_id: id ? id : -1 // if id is set to -1, it cannot be used as a valid primary key for update
    }
}

/**
 * Converts a partial Composer object (with a required id field) to a partial D1Composer object, for use in UPDATE statements
 *
 * @return the converted partial D1Composer object
 */
export function formatCompToD1Partial(record: Partial<Composer> & { id: number }): Partial<D1Composer> {
    // used for UPDATE statements where only some columns are updated
    // the id field is required to identify the record to update, but other fields are optional and only included if they are being updated
    const output: Partial<D1Composer> = {
        composer_id: record.id
    }
    applyPartialFields(record as Record<string, any>, output as Record<string, unknown>, {
        // composer tags are only written when an array is supplied (no empty-string fallback)
        tags: (value, out) => {
            if (Array.isArray(value)) out.tags = joinAndFilterItems(value)
        }
    })
    return output
}

/**
 * Converts a D1Contributor object representation in D1 to ContributorRecord
 *
 * @param {D1Contributor} record - the D1Contributor object to convert
 * @return {ContributorRecord} the converted ContributorRecord object
 */
export function formatContribFromD1(record: D1Contributor): ContributorRecord {
    // converts the D1Contributor object representation in D1 to ContributorRecord
    // also very similar; the only difference is the id signifier
    const { contributor_id, phases, roles, admin, active, tags, ...data } = record
    return {
        ...data,
        id: contributor_id,
        // class_year, major, and phases are nullable in the database; a null (or legacy empty-string) phases column maps to null, not []
        phases: phases ? splitAndFilterNumbers(phases) : null,
        roles: roles ? splitAndFilterItems(roles) : [],
        admin: admin === 1,
        active: active === 1,
        tags: tags ? splitAndFilterItems(tags) : []
    }
}

/**
 * Converts a Contributor object to D1Contributor
 *
 * @param {Contributor | ContributorRecord} record - the Contributor or ContributorRecord object to convert
 * @return {D1Contributor} the converted D1Contributor object
 */
export function formatContribToD1(record: Contributor | ContributorRecord): D1Contributor {
    // converts a Contributor object to D1Contributor

    let data, id, entry_date, change_date
    switch ("id" in record) {
        case true:
            // record is a ContributorRecord, so it has the id, entry_date, and change_date fields, which are used in the output
            ;({ id, entry_date, change_date, ...data } = record as ContributorRecord)
            break
        case false:
            // record is just Contributor
            ;({ ...data } = record as Contributor)
            id = null
            entry_date = new Date().toISOString() // it is assumed that Contributors retain their shape; also, entry_date is ignored for updates
            change_date = entry_date // change_date is set by business logic on insert/update (see database.ts); seeded to entry_date for a new record
            break
    }

    // the phases column is nullable; an absent or empty list is stored as NULL rather than an empty string
    const phases_joined = record.phases ? joinAndFilterItems(record.phases) : ""

    return {
        ...data,
        entry_date: entry_date,
        change_date: change_date,
        contributor_id: id ? id : -1, // if id is set to -1, it cannot be used as a valid primary key for update
        phases: phases_joined !== "" ? phases_joined : null,
        roles: record.roles ? joinAndFilterItems(record.roles) : "",
        admin: record.admin ? 1 : 0,
        active: record.active ? 1 : 0,
        tags: record.tags ? joinAndFilterItems(record.tags) : ""
    }
}

/**
 * Converts a partial Contributor object (with a required id field) to a partial D1Contributor object, for use in UPDATE statements
 *
 * @param {Partial<Contributor> & { id: number }} record - the partial Contributor object to convert, which must include the id field
 * @return {Partial<D1Contributor>} the converted partial D1Contributor object
 */
export function formatContribToD1Partial(record: Partial<Contributor> & { id: number }): Partial<D1Contributor> {
    // used for UPDATE statements where only some columns are updated
    // the id field is required to identify the record to update, but other fields are optional and only included if they are being updated
    const output: Partial<D1Contributor> = {
        contributor_id: record.id
    }
    applyPartialFields(record as Record<string, any>, output as Record<string, unknown>, {
        phases: (value, out) => {
            // nullable column: a null value, empty list, or list of blanks is stored as NULL
            const joined = Array.isArray(value) ? joinAndFilterItems(value) : ""
            out.phases = joined !== "" ? joined : null
        },
        roles: joinOrEmpty("roles"),
        admin: (value, out) => {
            out.admin = value ? 1 : 0
        },
        active: (value, out) => {
            out.active = value ? 1 : 0
        },
        tags: joinOrEmpty("tags")
    })
    return output
}

/**
 * Creates a standardized API response payload
 *
 * @param {boolean} success - whether the API request was successful
 * @param {Array<any> | null} payload - the payload of the API response, which is an array of any type or null
 * @param {string} comment - a comment providing additional information about the API response
 * @return {APIResponse} the standardized API response object
 */
export function createAPIPayload(success: boolean, payload: any | null, comment: string): APIResponse {
    return {
        success: success,
        payload: payload,
        comment: comment
    }
}

/**
 * Creates an error payload
 *
 * @param {string} comment - a comment describing the error
 * @return {APIResponse} the standardized API response object representing an error, with success set to false and payload set to null
 */
export function errorAPIPayload(comment: string): APIResponse {
    return createAPIPayload(false, null, comment)
}

/**
 * Replaces the common "smart"/curly quotation marks with their straight ASCII equivalents. Word processors
 * and spreadsheets (a likely source of pasted or CSV-imported data) auto-substitute these, which then break
 * exact-match lookups and look inconsistent in stored text.
 *
 * @param value the string to normalize
 * @returns the string with curly single/double quotes converted to ' and "
 */
function straightenQuotes(value: string): string {
    return value
        .replace(/[‘’‚‛′]/g, "'") // ‘ ’ ‚ ‛ ′ → '
        .replace(/[“”„‟″]/g, '"') // “ ” „ ‟ ″ → "
}

/**
 * Recursively cleans up user-supplied input for a data write: every string is trimmed of leading/trailing
 * whitespace and has its curly quotes straightened; objects and arrays are walked and rebuilt, and all other
 * values pass through unchanged. Returns a cleaned copy (the input is not mutated). Applied on the data POST
 * path (see handleBulkCreate) so pasted/CSV-imported records are normalized before validation and storage;
 * it is deliberately not wired into the generic request parser, which also serves auth/identity/command
 * endpoints whose payloads must be preserved verbatim.
 *
 * @param value the value to sanitize (a record, array, or scalar)
 * @returns a sanitized copy of the value
 */
export function sanitizeInputStrings<T>(value: T): T {
    if (typeof value === "string") {
        return straightenQuotes(value).trim() as unknown as T
    }
    if (Array.isArray(value)) {
        return value.map((element) => sanitizeInputStrings(element)) as unknown as T
    }
    if (value !== null && typeof value === "object") {
        const cleaned: Record<string, unknown> = {}
        for (const [key, element] of Object.entries(value)) {
            cleaned[key] = sanitizeInputStrings(element)
        }
        return cleaned as unknown as T
    }
    return value
}

/**
 * Parses the body of an API request into an APIRequest object and performs validation
 *
 * @param {Request} request - the API request to parse
 * @param {string[]} [meta_expect_keys] - an optional list of expected keys in the meta field; if provided, the function will validate that the meta field contains these keys
 * @return {Promise<APIRequest | Error>} a promise that resolves to the parsed APIRequest object, or an Error if the request body is not valid JSON, does not have the required shape, or if the meta field does not contain the expected keys (if meta_expect_keys is provided)
 */
export async function parseAPIRequest(request: Request, meta_expect_keys?: string[]): Promise<APIRequest | Error> {
    // parses the body of an API request into an APIRequest object
    const content_type = request.headers.get("Content-Type")
    const is_json_content_type = content_type !== null && content_type.toLowerCase().includes("application/json")
    if (content_type !== null && !is_json_content_type) {
        return new Error("Invalid content type: expected application/json")
    }
    let data: { payload: unknown; meta?: Record<string, string | boolean | number | null> }
    try {
        const body_text = await request.text()
        if (body_text.trim() === "") {
            // a bodiless request (e.g. a GET that carries only a meta header) is allowed without a
            // Content-Type, since there is nothing to interpret
            data = {
                payload: null
            }
        } else {
            // a non-empty body must declare application/json; a missing Content-Type is no longer assumed
            // to be JSON, so an untyped payload is rejected rather than parsed on faith
            if (!is_json_content_type) {
                return new Error("Invalid content type: expected application/json for a request body")
            }
            data = {
                payload: JSON.parse(body_text)
            }
        }
    } catch (e) {
        return new Error(`Failed to parse request body as JSON: ${e}`)
    }
    // validate the shape of the response
    if (typeof data !== "object" || data === null) {
        return new Error("Invalid request body: expected an object")
    }
    if (!(data.payload instanceof Array) && data.payload !== null) {
        return new Error("Invalid request body: must be an array or null")
    }
    // if meta_expect_keys is provided, validate the shape of the meta field
    let meta: Record<string, string | boolean | number | null> | undefined = undefined
    const meta_data = request.headers.get("X-MWMSC-Request-Meta")
    const meta_header = meta_data ? (meta_data.length <= 512 ? meta_data : null) : null // arbitrary limit to prevent abuse; if the header is present but exceeds the limit, it is treated as missing
    /** by default, if meta_expect_keys is not supplied, meta is not checked (which is useful for requests that don't require it)
     *  however, some requests make meta optional, which requires the header to be checked and parsed but allows for keys to be missing
     *  if an empty array is supplied, header parsing executes, but if there is no data to parse, an empty meta is returned silently
     */
    const enforce_meta_presence = meta_expect_keys ? meta_expect_keys.length > 0 : false

    if (meta_expect_keys && !meta_header && !enforce_meta_presence) {
        // meta is optional and missing
        meta = {}
    } else if (meta_expect_keys && !meta_header && enforce_meta_presence) {
        // meta is required but missing
        return new Error("Missing required meta header: X-MWMSC-Request-Meta")
    } else if (meta_expect_keys && !meta_header) {
        // should be impossible
        return new Error(
            "Invalid state: meta_expect_keys is supplied but meta header is missing, and meta header is not optional"
        )
    } else if (meta_expect_keys && meta_header) {
        // attempt to parse JSON string
        try {
            data.meta = JSON.parse(meta_header)
        } catch (e) {
            return new Error(`Failed to parse meta header as JSON: ${e}`)
        }
        if (
            typeof data.meta !== "object" ||
            data.meta === null ||
            Array.isArray(data.meta) ||
            Object.values(data.meta).some(
                (key) => typeof key !== "string" && typeof key !== "boolean" && typeof key !== "number" && key !== null
            )
        ) {
            return new Error(
                "Invalid request body: 'meta' field must be an object of type Record<string, string | boolean | number | null>"
            )
        }
        const missing_keys = meta_expect_keys.filter((key) => !(key in (data.meta as object)))
        // not checking for extra keys since they won't be checked
        if (missing_keys.length > 0) {
            return new Error(`Invalid request body: 'meta' field is missing required keys: ${missing_keys.join(", ")}`)
        }
        meta = data.meta as Record<string, string | boolean | number | null>
    }
    // shape validated
    if (data.payload instanceof Array && data.payload.length === 0) {
        // return null since null is trivial
        return {
            payload: null,
            meta: meta !== undefined ? meta : undefined
        }
    }
    return {
        payload: data.payload,
        meta: meta !== undefined ? meta : undefined
    }
}
