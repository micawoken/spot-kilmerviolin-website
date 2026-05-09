/**
 * lib/api.common.ts
 * 
 * Provides common services for API endpoints, such as decomposing and composing objects
 * 
 * 
 * 
 */

// types

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

export enum WorkType { // defines available work types
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

export enum AuthorRole {
    COMPOSER = "composer",
    ARRANGER = "arranger",
    LYRICIST = "lyricist",
    OTHER = "other"
}

// AUTHENTICATE/AUTHORIZE functions

export function parseCookieHeader(cookie_header: string): Record<string, string> {
    // borrowed from the mwm-go-shorturl project
    if (cookie_header === "") {
        return {}
    }
    const pairs = cookie_header.split(";")
    const cookies = pairs.reduce<Record<string, string>>((acc, current) => {
        const [name, value] = current.trim().split("=").map(i => i.trim())
        if (name && value) {
            acc[name] = decodeURIComponent(value)
        }
        return acc
    }, {});
    return cookies
}

// D1 functions

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
                throw new Error(`Invalid value type for operator ${op}: expected array of length 2, got ${typeof value} with length ${Array.isArray(value) ? value.length : "N/A"}`)
            }
            return [`${param} ${op} ? AND ?`, value]
        default:
            throw new Error(`Unsupported SQL operator: ${op}`)
    }
    
}

export function sqlListJoin(spec: Array<[string, (string | string[])?, SQLCompareOp?]>, exec_mode: "columns" | "where" | "order" = "columns"): [string, Array<string>] {
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
            if (!value) {
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
                if (!value) {
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

export function formatWorkFromD1(record: D1Composition): CompositionRecord {
    // converts the D1Composition object representation in D1 to CompositionRecord
    const { composition_id, rating_suzuki, rating_nyssma, author_secondary, contrib_addl, phases, publish_location, publish_name, publish_year, uri_type, uri, ...data } = record
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
    const author_secondary_list = author_secondary ? author_secondary.split(",").map(s => s.trim()) : []
    const contrib_addl_list = contrib_addl ? contrib_addl.split(",").map(s => parseInt(s.trim())) : []
    const phases_list = phases ? phases.split(",").map(s => parseInt(s.trim())) : []
    return {
        ...data,
        id: composition_id,
        author_secondary: author_secondary_list,
        contrib_addl: contrib_addl_list,
        rating: rating,
        publication_info: publish_info,
        phases: phases_list
    }
}

export function formatWorkToD1(record: Composition | CompositionRecord): D1Composition {
    // converts a Composition object to D1Composition
    // if the supplied object is a Composition, and not a CompositionRecord, the id and entry_date field are set to null equivalents
    let author_secondary, contrib_addl, rating, phases, publication_info, id, entry_date, data 
    switch ("id" in record) {
        case true:
            // record is a CompositionRecord, so it has the id and entry_date fields, which are used in the output
            ({ author_secondary, contrib_addl, rating, phases, publication_info, id, entry_date, ...data } = record as CompositionRecord)

            break
        case false:
            // record is a Composition, so it does not have the id and entry_date fields; these are set to null equivalents in the output
            ({ author_secondary, contrib_addl, rating, phases, publication_info, ...data } = record as Composition)
            id = null
            entry_date = null // it is assumed that Compositions retain their shape; also, entry_date is ignored for updates
            break
    }

    // the record could be a Composition or a CompositionRecord
    const rating_suzuki: number | null = rating ? rating.suzuki : null
    const rating_nyssma: number | null = rating ? rating.nyssma : null

    return {
        ...data,
        entry_date: entry_date,
        composition_id: id ? id : -1, // if id is set to -1, it cannot be used as a valid primary key for update
        rating_suzuki: rating_suzuki,
        rating_nyssma: rating_nyssma,
        publish_location: publication_info.location,
        publish_name: publication_info.name,
        publish_year: publication_info.year,
        uri_type: publication_info.uri_type,
        uri: publication_info.uri,
        author_secondary: author_secondary.join(","),
        contrib_addl: contrib_addl.join(","),
        phases: phases.join(",")
    }
}

export function formatWorkToD1Partial(record: Partial<Composition> & { id: number }): Partial<D1Composition> {
    // used for UPDATE statements where only some columns are updated
    // the id field is required to identify the record to update, but other fields are optional and only included if they are being updated
    let output: Partial<D1Composition> = {
        composition_id: record.id
    }
    for (const key in record) {
        if (key === "id") {
            continue
        }
        const value = record[key as keyof Composition]
        if (value !== undefined) {
            switch (key) {
                case "author_secondary":
                    output.author_secondary = Array.isArray(value) ? value.join(",") : ""
                    break
                case "contrib_addl":
                    output.contrib_addl = Array.isArray(value) ? value.join(",") : ""
                    break
                case "phases":
                    output.phases = Array.isArray(value) ? value.join(",") : ""
                    break
                case "rating":
                    if (
                        typeof value === "object" &&
                        value !== null &&
                        !Array.isArray(value) &&
                        "suzuki" in value &&
                        "nyssma" in value
                    ) {
                        const rating = value as CompositionRating
                        output.rating_suzuki = rating.suzuki !== undefined ? rating.suzuki : null
                        output.rating_nyssma = rating.nyssma !== undefined ? rating.nyssma : null
                    }
                    break
                case "publication_info":
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
                        output.publish_location = publication_info.location
                        output.publish_name = publication_info.name
                        output.publish_year = publication_info.year
                        output.uri_type = publication_info.uri_type
                        output.uri = publication_info.uri
                    }
                    break
                default:
                    (output as Record<string, unknown>)[key] = value
            }
        }
    }
    return output
}

export function formatCompFromD1(record: D1Composer): ComposerRecord {
    // converts the D1Composer object representation in D1 to ComposerRecord
    // ComposerRecord and D1Composer are very similar; the only difference is the id signifier
    const { composer_id, ...data } = record
    return {
        ...data,
        id: composer_id
    }
}

export function formatCompToD1(record: Composer | ComposerRecord): D1Composer {
    // converts a Composer object to D1Composer
    if ("composer_id" in record) {
        // D1Composer extends Composer, so it plausibly could be passed in
        // it is detected if it has the composer_id field, and if so, it is returned as-is (but with type assertion)
        return record as D1Composer
    }

    let data, id, entry_date
    switch ("id" in record) {
        case true:
            // record is a ComposerRecord, so it has the id and entry_date fields, which are used in the output
            ({ id, entry_date, ...data } = record as ComposerRecord)
            break
        case false:
            // record is just Composer
            ({ ...data } = record as Composer)
            id = null
            entry_date = (new Date().toISOString()) // it is assumed that Composers retain their shape; also, entry_date is ignored for updates
            break
    }
    return {
        ...data,
        entry_date: entry_date,
        composer_id: id ? id : -1 // if id is set to -1, it cannot be used as a valid primary key for update
    }
}

export function formatCompToD1Partial(record: Partial<Composer> & { id: number }): Partial<D1Composer> {
    // used for UPDATE statements where only some columns are updated
    // the id field is required to identify the record to update, but other fields are optional and only included if they are being updated
    let output: Partial<D1Composer> = {
        composer_id: record.id
    }
    for (const key in record) {
        if (key === "id") {
            continue
        }
        const value = record[key as keyof Composer]
        if (value !== undefined) {
            (output as Record<string, unknown>)[key] = value
        }
    }
    return output
}

export function formatContribFromD1(record: D1Contributor): ContributorRecord {
    // converts the D1Contributor object representation in D1 to ContributorRecord 
    // also very similar; the only difference is the id signifier
    const { contributor_id, phases, roles, admin, active, ...data } = record
    return {
        ...data,
        id: contributor_id,
        phases: phases ? phases.split(",").map(s => parseInt(s.trim())) : [],
        roles: roles ? roles.split(",").map(s => s.trim()) : [],
        admin: admin === 1,
        active: active === 1
    }
}

export function formatContribToD1(record: Contributor | ContributorRecord): D1Contributor {
    // converts a Contributor object to D1Contributor

    let data, id, entry_date
    switch ("id" in record) {
        case true:
            // record is a ContributorRecord, so it has the id and entry_date fields, which are used in the output
            ({ id, entry_date, ...data } = record as ContributorRecord)
            break
        case false:
            // record is just Contributor
            ({ ...data } = record as Contributor)
            id = null
            entry_date = (new Date().toISOString()) // it is assumed that Contributors retain their shape; also, entry_date is ignored for updates
            break
    }

    return {
        ...data,
        entry_date: entry_date,
        contributor_id: id ? id : -1, // if id is set to -1, it cannot be used as a valid primary key for update
        phases: record.phases ? record.phases.join(",") : "",
        roles: record.roles ? record.roles.join(",") : "",
        admin: record.admin ? 1 : 0,
        active: record.active ? 1 : 0
    }
}

export function formatContribToD1Partial(record: Partial<Contributor> & { id: number }): Partial<D1Contributor> {
    // used for UPDATE statements where only some columns are updated
    // the id field is required to identify the record to update, but other fields are optional and only included if they are being updated
    let output: Partial<D1Contributor> = {
        contributor_id: record.id
    }
    for (const key in record) {
        if (key === "id") {
            continue
        }
        const value = record[key as keyof Contributor]
        if (value !== undefined) {
            switch (key) {
                case "phases":
                    output.phases = Array.isArray(value) ? value.map((v: string | number) => v.toString()).join(",") : ""
                    break
                case "roles":
                    output.roles = Array.isArray(value) ? value.map((v: string | number) => v.toString()).join(",") : ""
                    break
                case "admin":
                    output.admin = value ? 1 : 0
                    break
                case "active":
                    output.active = value ? 1 : 0
                    break
                default:
                    (output as Record<string, unknown>)[key] = value
            }
        }
    }
    return output
}