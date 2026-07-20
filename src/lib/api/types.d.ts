/**
 * lib/api/types.d.ts
 *
 * Provides type information for objects used in API libraries and other middleware
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

/**
 * The shape of an API response
 *
 * @namespace APIResponse
 * @property {boolean} success - whether the API call succeeded, used to determine if the payload is valid
 * @property {Array<any> | null} payload - the data returned by the API call, if the response calls for one
 * @property {string} comment - a string providing additional information about the API response, such as error messages or other comments
 */
interface APIResponse {
    readonly success: boolean
    readonly payload: any | null
    readonly comment: string
}

/**
 * The shape of an API request
 *
 * @namespace APIRequest
 * @property {Record<string, string>} meta - a record of string key-value pairs with additional request info; currently not implemented
 * @property {Array<any>} payload - the data to be used during the API call, as an array of any shape (endpoint-dependent)
 */
type APIRequest = Readonly<APIRequestPrimitive>

interface APIRequestPrimitive {
    meta?: Record<string, string | boolean | number | null>
    payload: any[] | null
}

/**
 * The set of tables that the keyword search may target
 */
type SearchDatabase = "composers" | "compositions" | "contributors"

/**
 * A single keyword-search hit
 *
 * @property {SearchDatabase} database - the table the hit belongs to (used to build its link)
 * @property {number} id - the record's primary key
 * @property {string} name - the display name; for compositions this is "{composer}: {composition}"
 */
interface SearchResult {
    database: SearchDatabase
    id: number
    name: string
}

/**
 * The metadata representation of a file stored in the R2 bucket (R2_FILES)
 *
 * Files are R2-only: the object key (filename) is the file's identity, and all descriptive
 * metadata lives in the object's customMetadata (with size/content_type/uploaded sourced from
 * the R2 object itself). There is no D1 table backing files. See lib/api/r2.ts and lib/api/files.ts.
 *
 * @namespace FileMeta
 * @property {string} key - the object key (filename), which serves as the file's id
 * @property {number} size - the stored object size in bytes (the optimized variant for images)
 * @property {string} content_type - the stored MIME type (image/webp for optimized images)
 * @property {string} uploaded - the upload timestamp, in ISO 8601 format
 * @property {string} etag - the R2 entity tag of the stored object
 * @property {string | null} uploader - the contributor id (as a string) that uploaded the file, or null
 * @property {number | null} width - the image width in pixels, or null for non-images
 * @property {number | null} height - the image height in pixels, or null for non-images
 * @property {boolean} optimized - whether the stored bytes are an optimized image variant
 * @property {string} alt - the required alt text supplied at upload/replace time
 */
interface FileMeta {
    key: string
    size: number
    content_type: string
    uploaded: string // ISO 8601 format
    etag: string
    uploader: string | null
    width: number | null
    height: number | null
    optimized: boolean
    alt: string
}

/**
 * The set of file sources the file picker can draw from
 *
 * "r2" is the live R2 bucket (managed through the files API); "bundled" is the build-time pool
 * optimized from src/files and published to dist/files (see the files-manifest build step).
 */
type FileSource = "r2" | "bundled"

/**
 * A single file-picker entry, unifying R2 files and build-time bundled (src/files) assets
 *
 * @property {FileSource} source - where the entry came from (bundled entries are ranked first)
 * @property {string} name - the display/file name used for filtering
 * @property {string} url - the value autofilled into an image field (/api/v1/files/<key> for r2,
 *   /files/<name> for bundled)
 * @property {number | null} width - the image width in pixels, if known
 * @property {number | null} height - the image height in pixels, if known
 * @property {string | null} alt - the entry's alt text, if known
 */
interface FilePickerEntry {
    source: FileSource
    name: string
    url: string
    width: number | null
    height: number | null
    alt: string | null
}

/**
 * A record stored in the Cache API
 *
 * @namespace CacheRecord
 * @property {Array<any> | null} payload - the data stored in the cache
 * @property {string} comment - comment
 */
interface CacheRecord {
    payload: Array<any> | null
    comment: string
}

/**
 * The metadata associated with a KV entry
 *
 * @property {number} v - the metadata version
 * @property {"text" | "json" | "form"} f - the value type
 * @property {number} t - the timestamp, in milliseconds since epoch
 * @property {number} e - the TTL, in seconds
 * @property {string | null} value - the value, if storable
 */
interface KVMetadata {
    v: number // version
    f: "text" | "json" // type, or "f"orm
    t: number // timestamp, in milliseconds since epoch
    e: number // ttl in seconds
    h: boolean // whether the value is non-empty
    value: string | null
}

/**
 * The output of _exec_wrap, the function providing access to D1 in database.ts
 *
 * @property {Array<Record<string, string | number | null>>} data - rows from a query
 * @property {boolean} cached - whether the result was returned from cache
 * @property {"global" | "local"} [query_scope] - whether the query scope was global or local
 * @property {D1Meta & Record<string, unknown>} [meta] - the D1Result.meta property
 *
 */
interface ExecResult {
    data: Record<string, string | number | null>[]
    cached: boolean
    query_scope?: "global" | "local"
    meta?: D1Meta & Record<string, unknown>
}

/**
 * A SQLite error message
 *
 * @namespace SQLiteErrorMsgPrimitive
 * @property {number} code - the HTTP code
 * @property {string} [message] - if supplied, overrides the default message for the code
 * @property {(D1Schema, string) => [boolean, number, string]} [processor] - if set, a function that parses the error message and returns a new error code and message
 */
interface SQLiteErrorMsgPrimitive {
    code: number // keyof http_codes in http.ts
    message?: string // if supplied, overrides the default message for the code
    processor?: (string) => [boolean, number, string] // if set, a function that parses the error message and returns a new error code and message
}

/**
 * Displays general user information
 *
 * Carries the acting user's non-authorization contributor fields, stashed by the authorization primitive
 * (see buildIdentity in lib/api/authorize.ts) so self-service flows can read the caller's own profile from
 * the identity without a second contributor lookup. Authorization state (roles/admin/active/id and the
 * sign-in identity_email) is excluded and lives on the Identity proper.
 *
 * @property {boolean} ok - whether the user information can be used
 * @property {string} name - the user's name
 * @property {string[]} tags - tags associated with the user
 * @property {number[]} phases - the phases the user is involved in
 * @property {number | null} entry_date - the date the user was registered, as epoch milliseconds, or null when no record
 * @property {number | null} class_year - the user's class year, or null if omitted
 * @property {string | null} major - the user's major, or null if omitted
 * @property {string | null} bio - the user's biography, or null if omitted
 * @property {string | null} public_email - the user's public-facing email, or null if omitted
 * @property {string | null} image - the user's image reference, or null if omitted
 * @property {number | null} change_date - the record's last-modified date as epoch milliseconds, or null when no record
 */
interface UserInfo {
    ok: boolean
    name: string
    tags: string[]
    phases: number[]
    entry_date: number | null
    class_year: number | null
    major: string | null
    bio: string | null
    public_email: string | null
    image: string | null
    change_date: number | null
}

// BaseIdentity is returned by the authentication library
/**
 * An identity primitive returned by authorization once a JWT is verified
 *
 * @property {boolean} sub - the JWT subject, which is a UUID from Cloudflare Access
 * @property {string} email - the email of the authenticated user, also from Access
 * @property {number} nbf - the time, in seconds since epoch, before which this credential is invalid
 * @property {number} exp - the time, in seconds since epoch, after which this credential is invalid
 *
 */
interface BaseIdentity {
    // stores data extracted from JWT
    readonly sub: string
    readonly email: string // email is the one listed on the claim, which is not yet linked to the record in the identity database
    readonly nbf: number
    readonly exp: number
} // if created, the identity is assumed as authenticated

// Identity is returned by the authorization library, and is required for authorization; BaseIdentity will not be accepted

/**
 * A constructed identity using data from the Contributor database
 *
 * @property {boolean} allowed - Whether the identity can be used for authorization in the API
 * @property {boolean} enrollable - Whether the identity can be used for self-enrollment (see below for self-enrollment flow and security)
 * @property {boolean} active - Whether the identity is active (authorized to modify the composer and composition databases)
 * @property {string[]} roles - The roles conferred to the identity, which confer additional authorizations
 * @property {number} id - The contributor ID, used to grant row-level edit permissions in the contributor database
 * @property {boolean} admin - Whether the user is an admin (see below for admin permissions)
 *
 * Admin permissions: administrators have the following permissions, some of which may be conferred by roles:
 * - Access to the identity endpoint (/api/v1/identity), providing add/update/remove permission to Cloudflare Access
 * - Bypass of contribution edit lockout (see below for contribution edit lockout)
 * - Write access to all contributor records, escaping row-level security on the contributor table
 * - Access to the command endpoint (/api/v1/command), providing terminal access to the D1 database
 *
 * Of these, writing to contributor records, access to the command endpoint, and remove permission on the identity endpoint cannot be conferred by roles.
 *
 * Self-enrollment: when a user authenticates with Access but has no record in the contributor database, lib/api/authorize.ts returns a
 * permissionless Identity object with enrollable set to true. A true enrollable provides authorization to use self-enrollment endpoints,
 * allowing a user to enter user-supplied data (name, major, etc) into the contributor database. As part of self-enrollment, the identity is
 * granted zero permissions and is not active; to activate the account, a user with a userenroll role or an administrator must activate the account.
 *
 */
interface Identity extends BaseIdentity {
    // connects a base identity generated from an Access JWT claim to an identity record, providing authorization data
    /**
     * Whether the identity can be used for authorization in the API [a Contributor record exists]
     */
    readonly allowed: boolean // if the identity record is not found, the identity cannot be used
    /**
     * Whether the contributor profile is active [the Contributor record is active]
     */
    readonly active: boolean // if the record indicates the contributor profile is active
    /**
     * Whether the identity can be used for self-enrollment by (1) connecting to an existing profile or (2) creating a new profile
     * [no Contributor record exists, and self-enroll is enabled]
     */
    readonly enrollable: boolean
    // enrollment via method (1) requires the Access email to match the existing contributor email, and enrollment via method (2) requires the Access email to not match any existing contributor email
    /**
     * The roles conferred to the identity, which confer additional authorizations
     */
    readonly roles: string[] // system-defined roles
    /**
     * The contributor ID, used to grant row-level edit permissions in the contributor database
     */
    readonly id: number // the contributor ID stored in the identity record, used to provide authorization for contribution edits
    /**
     * Whether the user is an admin
     */
    readonly admin: boolean // if set, bypasses the id check for editing and enables full access to the identity endpoint
    /**
     * General information about the user
     */
    readonly userinfo: UserInfo
    /**
     * The aggregate permission set conferred by the identity's roles, precomputed during authorization
     * (see buildIdentity / permissionsFromRoles). Lets access screening consult one flattened set rather
     * than re-walking the role registry per check.
     */
    readonly permissions: IdentityPermissions
}

// the Identity object is constructed by authorization and is not stored as a record since it contains token-specific data

/**
 * Provides property information for different user roles
 *
 * @namespace RoleProfile
 * @property {boolean} overrides_lockout - Whether the role allows a user to bypass the contribution edit lockout (see later)
 * @property {boolean} lockout_ignore_admin - If overrides_lockout is true, whether the lockout override also applies to entries by administrators
 * @property {boolean} user_activation - Whether the role allows a user to activate user accounts (their own, and others)
 * @property {boolean} user_addition - Whether the role allows a user to add new users
 * @property {boolean} conferrable - Whether the role can be conferred by a non-administrator possessing the role to another user
 * @property {boolean} cms_editor - Whether the role provides authorization to edit site content through the
 *   in-worker EmDash CMS at /_emdash, enforced by src/middleware/emdash_access.ts. See
 *   docs/dev/emdash-migration.md.
 * @property {boolean} design_editor - Whether the role provides authorization to use the visual design
 *   system (/admin/designs: the design list, the Puck editor, the theme). STRICTLY WEAKER than cms_editor
 *   over /_emdash: the design system is a browser-side EmDash API client, so emdash_access.ts admits a
 *   design_editor to a fixed ALLOWLIST of the paths it calls (its own design_* collections; read-only
 *   entry, schema and media reads) and denies the rest of the CMS — the admin UI, other collections'
 *   writes, settings, users. cms_editor is a superset and does not require this permission.
 *
 * Contribution edit lockout: by default, users are granted read-only access to entries made by others, which is enforced by the API.
 * By default, administrators bypass the lockout, but certain use-cases (such as peer review) merit a lift of this restriction so that
 * contributions can be edited. Certain roles confer authorization to escape the lockout.
 */
interface RoleProfile {
    // if set, contributor lockout is disabled
    overrides_lockout: boolean
    // if set, lockout enforcement will ignore if the subject identity is an admin
    lockout_ignore_admin: boolean
    user_activation: boolean
    user_addition: boolean
    conferrable: boolean
    cms_editor: boolean
    design_editor: boolean
}

/**
 * The aggregate permission set granted to an identity: the union (logical OR) of the RoleProfile of every
 * valid role the identity holds. Each key mirrors a RoleProfile permission and is true iff at least one
 * held role grants it; an identity with no (valid) roles has every permission false.
 *
 * Defined as a mapped type over RoleProfile so the two can never drift — adding a permission to RoleProfile
 * automatically adds it here. Exposed as Identity.permissions and consumed by access screening
 * (see page_auth satisfiesAccess). Named IdentityPermissions to avoid colliding with the global DOM
 * `Permissions` interface (the navigator.permissions API).
 */
type IdentityPermissions = { readonly [K in keyof RoleProfile]: boolean }

// D1 TYPES

/**
 * Represents a D1 database object, on which commands can be run
 *
 */
interface D1BaseSchema {
    readonly db: D1Database // the D1 database object
}

/**
 * A schema to access a specific D1 table
 *
 * @namespace D1Schema
 * @property {string} name - the name of the table
 * @property {string[]} columns - the column names in the table
 * @property {string[]} repr_exclude - columns omitted from the object representation but included in the database representation
 * @property {string[]} index - the primary key column, and other columns marked as unique or where there is an index created
 * @property {string} primary_key - the column with the primary key
 * @property {Record<string, "string" | "number" | "null">} type_hint - provides info for VirtualSQLTable for type conversion
 * @property {string[]} [protected] - if set, these properties are subject to row-level security and may be stripped from an object representation
 * @property {string[]} [locked] - if set, these properties are used for a security-relevant operation and require administrator permission to edit
 *
 */
interface D1Schema extends D1BaseSchema {
    readonly name: string // the table name
    readonly columns: string[] // the  column names in the table
    readonly repr_exclude: string[] // colums omitted from the object representation but included in the database representation
    readonly index: string[] // the primary key column, and other columns marked as unique or where there is an index created
    readonly primary_key: string
    readonly type_hint: Record<string, "string" | "number" | "null"> // provides info for VirtualSQLTable for type conversion
    readonly protected?: string[] // if set, these properties are subject to row-level security
    readonly locked?: string[] // if set, these properties are protected by columns and require administrator permission to modify
}

// DATA TYPES

/**
 * The unchanging properties of a Contributor object
 *
 */
interface ContributorPrimitive {
    name: string
    class_year: number | null
    major: string | null
    bio: string | null
    public_email: string | null
    identity_email: string
    image: string | null
}

/**
 * The API representation of a contributor
 * Includes properties as arrays/boolean
 *
 * @namespace Contributor
 * @property {number[] | null} phases - list of phase numbers the contributor is involved in, or null if omitted
 * @property {string[]} roles - list of role names the contributor has
 * @property {string[]} tags - list of tags associated with the contributor
 * @property {boolean} active - whether the contributor is active
 * @property {boolean} admin - whether the contributor is an admin
 */
interface Contributor extends ContributorPrimitive {
    // API representation of a contributor
    phases: number[] | null // list of phase numbers the contributor is involved in, or null if omitted
    roles: string[] // list of role names the contributor has
    tags: string[]
    active: boolean
    admin: boolean
}

/**
 * The API representation of a contributor record from D1
 * Includes database properties such as ID and entry_date
 */
interface ContributorRecord extends Contributor {
    // Contributor, but with fields indicating that it originates from D1
    id: number
    entry_date: number // epoch milliseconds; creation date, managed by business logic, immutable after insert
    change_date: number // epoch milliseconds; last-modified date, managed by business logic
}

/**
 * The database representation of a record from D1
 *
 * @namespace D1Contributor
 * @property {number} contributor_id - the database primary key
 * @property {number} entry_date - the date the record was entered into the database, as epoch milliseconds
 * @property {number} active - whether the contributor is active; a boolean stored as a number
 * @property {number} admin - whether the contributor is an admin; a boolean stored as a number
 * @property {string | null} phases - the phases the contributor is involved in; comma-separated, or null if omitted
 * @property {string} roles - the roles the contributor has; comma-separated
 * @property {string | null} tags - the tags associated with the contributor; comma-separated
 *
 */
interface D1Contributor extends ContributorPrimitive {
    // database representation of Contributor
    contributor_id: number
    entry_date: number // epoch milliseconds; creation date, immutable after insert (see db_init.sql trigger)
    change_date: number // epoch milliseconds; last-modified date
    active: number
    admin: number
    phases: string | null // comma-separated phase numbers, or null if omitted
    roles: string // comma-separated role names
    tags: string | null // comma-separated tags
    [key: string]: string | number | null // no additional fields expected; trying to clear compiler issue
}

// only current role anticipated is "reviewer", which bypasses the contribution edit lockout for non-primary contributors

interface ComposerPrimitive {
    name: string
    role: string // usually "composer", but can be defined as "arranger" or another type as declared
    birth_year: number
    death_year: number // -1 is defined as not dead
    country: string // ISO 3166-1 alpha-2 country code, validated on the client and server (see lib/api/validation.ts)
    bio: string
    image: string | null // refers to a file in assets, or an external URL
}

/**
 * The API representation of a composer
 *
 * @namespace Composer
 * @property {string} name - the composer's name
 * @property {string} role - the composer's role in the composition (e.g. "composer", "arranger", etc)
 * @property {number} birth_year - the composer's birth year
 * @property {number} death_year - the composer's death year, or -1 if the composer is still alive
 * @property {string} country - the composer's country as an ISO 3166-1 alpha-2 code, validated on the client and server (see lib/api/validation.ts)
 * @property {string} bio - a short biography of the composer
 * @property {string | null} image - the URL of the composer image, or null
 * @property {Record<string, string>} [citations] - optional key-value citations: source name to an https
 *   link, DOI, or ISBN (docs/dev/miscellaneous.txt); omitted or {} when there are none
 */
interface Composer extends ComposerPrimitive {
    // the API representation of a composer
    // an object representation of a composer
    tags: string[] // list of tags associated with the composer
    citations?: Record<string, string>
}

/**
 * The API representation of a composer record from D1
 *
 */
interface ComposerRecord extends Composer {
    // Composer, but with fields indicating that it originates from D1
    // the default construct for a composer object that originates from D1
    id: number
    entry_date: number // epoch milliseconds; creation date, managed by business logic, immutable after insert
    change_date: number // epoch milliseconds; last-modified date, managed by business logic
}

/**
 * The database representation of a composer record from D1
 */
interface D1Composer extends ComposerPrimitive {
    // database representation of Composer
    // the actual object representation stored in D1 before processing as a ComposerRecord
    // see D1Composition - record representation is different
    composer_id: number
    entry_date: number // epoch milliseconds; creation date, immutable after insert (see db_init.sql trigger)
    change_date: number // epoch milliseconds; last-modified date
    tags: string // comma-separated tags
    citations: string // JSON-encoded { [sourceName]: httpsLink | doi | isbn }, "" when empty
    [key: string]: string | number | null // no additional fields expected; trying to clear compiler issue
}

/**
 * The rating of a composition, stored in a Composition object and its inheritors
 */
interface CompositionRating {
    suzuki: number | null // 1-10, null if not rated
    nyssma: number | null // 1-6, null if not rated
}

/**
 * Publication information, stored in a Composition object and its inheritors
 *
 */
interface PublicationInfo {
    name: string
    location: string
    year: number
    uri_type: string // https, isbn, or other
    uri: string
}

/**
 * The basic elements of a composition
 *
 * @namespace CompositionPrimitive
 * @property {string} name - the name of the composition
 * @property {number} composer_id - the primary composer of the composition
 * @property {number} contrib_primary_1 - the primary contributor, used to confer edit permissions
 * @property {number | null} contrib_primary_2 - a secondary contributor, which also confers edit permissions
 * @property {WorkType} type - the type of the composition, e.g. "orchestral", "chamber", etc
 * @property {string | null} part - the part, ex. violin
 * @property {Key | null} key - the key of the composition, if applicable
 * @property {string | null} range - the range stored as text
 * @property {string | null} position_highest - the highest position in the composition
 * @property {string | null} notes_pedagogical - pedagogical notes about the composition
 * @property {string | null} notes_historical - historical notes about the composition
 * @property {string | null} notes_other - other notes about the composition
 * @property {string | null} image - a URL or path to an image representing the composition
 */
interface CompositionPrimitive {
    name: string
    composer_id: number // the primary composer
    contrib_primary_1: number // primary contributors are used to enforce the rule that edits can only be made by ones who contributed
    contrib_primary_2: number | null
    type: WorkType
    part: string | null
    key: Key | null // a Key is not always appropriate
    range: string | null
    position_highest: string | null
    notes_pedagogical: string | null
    notes_historical: string | null
    notes_other: string | null
    image: string | null // refers to a file in assets, or an external URL
}

// properties in the primitives can be added/modified without updating the type conversion functions in common.ts

/**
 * the API representation of a composition
 *
 * @namespace Composition
 * @property {string} name - the name of the composition
 * @property {number} composer_id - the primary composer of the composition
 * @property {number} contrib_primary_1 - the primary contributor, used to confer edit permissions
 * @property {number | null} contrib_primary_2 - a secondary contributor, which also confers edit permissions
 * @property {WorkType} type - the type of the composition, e.g. "orchestral", "chamber", etc
 * @property {string | null} part - the part, ex. violin
 * @property {Key | null} key - the key of the composition, if applicable
 * @property {string | null} range - the range stored as text
 * @property {string | null} position_highest - the highest position in the composition
 * @property {string | null} notes_pedagogical - pedagogical notes about the composition
 * @property {string | null} notes_historical - historical notes about the composition
 * @property {string | null} notes_other - other notes about the composition
 * @property {string | null} image - a URL or path to an image representing the composition
 * @property {CompositionRating} rating - the composition's rating, stored as an object with properties for each rating type
 * @property {PublicationInfo} publication_info - the composition's publication information
 * @property {number[]} contrib_addl - a list of additional contributors (not deemed primary)
 * @property {number[]} author_secondary - a list of secondary authors pointing to composer records
 * @property {number[]} phases - what phases it was in
 * @property {string[]} tags - what tags it has
 * @property {Record<string, string>} [citations] - optional key-value citations: source name to an
 *   https link, DOI, or ISBN (docs/dev/miscellaneous.txt); omitted or {} when there are none
 */
interface Composition extends CompositionPrimitive {
    // the default construct for objects representing a composition
    rating: CompositionRating
    publication_info: PublicationInfo
    contrib_addl: number[] // list of additional contributors, which are not used to confer edit permissions
    author_secondary: number[] // list of secondary authors
    phases: number[]
    tags: string[]
    citations?: Record<string, string>
}

/**
 * the API representation of a composition record from D1
 */
interface CompositionRecord extends Composition {
    // the default construct for a composition object that originates from D1
    id: number
    entry_date: number // epoch milliseconds; creation date, managed by business logic, immutable after insert
    change_date: number // epoch milliseconds; last-modified date, managed by business logic
}

/**
 * The resolved names attached to a composition when the "names" meta flag is set on a GET
 *
 * The composition record itself only stores numeric references (composer_id and author_secondary for
 * composers; contrib_primary_1, contrib_primary_2, and contrib_addl for contributors), so these
 * human-readable names are resolved from the composer and contributor tables on request and transmitted
 * alongside the composition rather than embedded in it.
 *
 * @property {string} composer_name - the name of the composer referenced by the composition's composer_id
 * @property {string[]} author_secondary_names - the names of the composers referenced by author_secondary,
 *   in the same order as the author_secondary array (an unresolvable id yields an empty string)
 * @property {string} contrib_primary_1_name - the name of the contributor referenced by contrib_primary_1
 *   (an unresolvable id yields an empty string)
 * @property {string} contrib_primary_2_name - the name of the contributor referenced by contrib_primary_2,
 *   or an empty string when contrib_primary_2 is null or the id is unresolvable
 * @property {string[]} contrib_addl_names - the names of the contributors referenced by contrib_addl,
 *   in the same order as the contrib_addl array (an unresolvable id yields an empty string)
 */
interface CompositionNames {
    composer_name: string
    author_secondary_names: string[]
    contrib_primary_1_name: string
    contrib_primary_2_name: string
    contrib_addl_names: string[]
}

/**
 * A composition paired with its resolved names, returned by the connector when the "names" meta flag
 * is requested. The API object is kept whole under "object" so it remains a valid Composition, with the
 * supplementary names (which are not part of the Composition spec) carried separately under "names".
 *
 * @property {CompositionRecord} object - the composition record, conforming to the Composition interface
 * @property {CompositionNames} names - the resolved composer and contributor names
 */
interface CompositionWithNames {
    object: CompositionRecord
    names: CompositionNames
}

/**
 * the database representation of a composition record from D1
 */
interface D1Composition extends CompositionPrimitive {
    // the actual object representation stored in D1 before processing as a CompositionRecord
    // the object representation stored in D1 differs from the representation used by middleware - it is flatter
    // also, the primary key is different

    // a function in api/common.ts provides translation between these record types
    composition_id: number
    author_secondary: string // comma-separated list of secondary authors, stored as text in D1 but converted to string[] in middleware
    contrib_addl: string
    phases: string
    publish_location: string
    publish_name: string
    publish_year: number
    uri_type: string
    uri: string
    rating_suzuki: number | null
    rating_nyssma: number | null
    tags: string // comma-separated list
    citations: string // JSON-encoded { [sourceName]: httpsLink | doi | isbn }, "" when empty
    entry_date: number // epoch milliseconds; creation date, immutable after insert (see db_init.sql trigger)
    change_date: number // epoch milliseconds; last-modified date
    full_name?: string // generated and stored in d1, but not used in middleware and business logic
    [key: string]: string | number | null // no additional fields expected; trying to clear compiler issue
}
