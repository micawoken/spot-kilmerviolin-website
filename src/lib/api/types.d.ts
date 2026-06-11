/**
 * lib/api/types.d.ts
 * 
 * Provides type information for objects used in API libraries and other middleware
 * 
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
    readonly success: boolean;
    readonly payload: any | null;
    readonly comment: string;
}

/**
 * The shape of an API request
 * 
 * @namespace APIRequest
 * @property {Record<string, string>} meta - a record of string key-value pairs with additional request info; currently not implemented
 * @property {Array<any>} payload - the data to be used during the API call, as an array of any shape (endpoint-dependent)
 */
type APIRequest = Readonly<APIRequestPrimitive>;

interface APIRequestPrimitive {
    meta?: Record<string, string | boolean | number | null>;
    payload: any[] | null;
}

/**
 * A record stored in the Cache API
 * 
 * @namespace CacheRecord
 * @property {Array<any> | null} payload - the data stored in the cache
 * @property {string} comment - comment
 */
interface CacheRecord {
    payload: Array<any> | null;
    comment: string;
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
    v: number; // version
    f: "text" | "json"; // type, or "f"orm
    t: number; // timestamp, in milliseconds since epoch
    e: number; // ttl in seconds
    h: boolean; // whether the value is non-empty
    value: string | null;
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
    data: Record<string, string | number | null>[];
    cached: boolean;
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
    code: number; // keyof http_codes in http.ts
    message?: string; // if supplied, overrides the default message for the code
    processor?: (string) => [boolean, number, string] // if set, a function that parses the error message and returns a new error code and message
}

/**
 * Displays general user information
 * 
 * @property {boolean} ok - whether the user information can be used
 * @property {string} name - the user's name
 * @property {string[]} tags - tags associated with the user
 * @property {number[]} phases - the phases the user is involved in
 * @property {string} entry_date - the date the user was registered, as ISO 8601
 */
interface UserInfo {
    ok: boolean;
    name: string;
    tags: string[];
    phases: number[];
    entry_date: string;
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
interface BaseIdentity { // stores data extracted from JWT
    readonly sub: string;
    readonly email: string; // email is the one listed on the claim, which is not yet linked to the record in the identity database
    readonly nbf: number; 
    readonly exp: number;
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
    readonly allowed: boolean; // if the identity record is not found, the identity cannot be used
    /**
     * Whether the contributor profile is active [the Contributor record is active]
     */
    readonly active: boolean; // if the record indicates the contributor profile is active
    /**
     * Whether the identity can be used for self-enrollment by (1) connecting to an existing profile or (2) creating a new profile
     * [no Contributor record exists, and self-enroll is enabled]
     */
    readonly enrollable: boolean
    // enrollment via method (1) requires the Access email to match the existing contributor email, and enrollment via method (2) requires the Access email to not match any existing contributor email
    /**
     * The roles conferred to the identity, which confer additional authorizations
     */
    readonly roles: string[]; // system-defined roles
    /**
     * The contributor ID, used to grant row-level edit permissions in the contributor database
     */
    readonly id: number; // the contributor ID stored in the identity record, used to provide authorization for contribution edits
    /**
     * Whether the user is an admin
     */
    readonly admin: boolean; // if set, bypasses the id check for editing and enables full access to the identity endpoint
    /**
     * General information about the user
     */
    readonly userinfo: UserInfo;
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
 * 
 * Contribution edit lockout: by default, users are granted read-only access to entries made by others, which is enforced by the API. 
 * By default, administrators bypass the lockout, but certain use-cases (such as peer review) merit a lift of this restriction so that 
 * contributions can be edited. Certain roles confer authorization to escape the lockout.
 */
interface RoleProfile {
    // if set, contributor lockout is disabled
    overrides_lockout: boolean;
    // if set, lockout enforcement will ignore if the subject identity is an admin
    lockout_ignore_admin: boolean;
    user_activation: boolean;
    user_addition: boolean;
    conferrable: boolean;
}

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
    readonly name: string; // the table name
    readonly columns: string[]; // the  column names in the table
    readonly repr_exclude: string[]; // colums omitted from the object representation but included in the database representation
    readonly index: string[]; // the primary key column, and other columns marked as unique or where there is an index created
    readonly primary_key: string;
    readonly type_hint: Record<string, "string" | "number" | "null">; // provides info for VirtualSQLTable for type conversion
    readonly protected?: string[]; // if set, these properties are subject to row-level security
    readonly locked?: string[] // if set, these properties are protected by columns and require administrator permission to modify
}

// DATA TYPES

/**
 * The unchanging properties of a Contributor object
 * 
 */
interface ContributorPrimitive {
    name: string;
    class_year: number;
    major: string;
    bio: string;
    public_email: string;
    identity_email: string;
    image: string | null;
}

/**
 * The API representation of a contributor
 * Includes properties as arrays/boolean
 * 
 * @namespace Contributor
 * @property {number[]} phases - list of phase numbers the contributor is involved in
 * @property {string[]} roles - list of role names the contributor has
 * @property {string[]} tags - list of tags associated with the contributor
 * @property {boolean} active - whether the contributor is active
 * @property {boolean} admin - whether the contributor is an admin
 */
interface Contributor extends ContributorPrimitive { // API representation of a contributor
    phases: number[]; // list of phase numbers the contributor is involved in
    roles: string[]; // list of role names the contributor has
    tags: string[];
    active: boolean;
    admin: boolean;
}

/**
 * The API representation of a contributor record from D1
 * Includes database properties such as ID and entry_date
 */
interface ContributorRecord extends Contributor { // Contributor, but with fields indicating that it originates from D1
    id: number;
    entry_date: string; // ISO 8601 format
    
}

/**
 * The database representation of a record from D1
 * 
 * @namespace D1Contributor
 * @property {number} contributor_id - the database primary key
 * @property {string} entry_date - the date the record was entered into the database, in ISO 8601 format
 * @property {number} active - whether the contributor is active; a boolean stored as a number
 * @property {number} admin - whether the contributor is an admin; a boolean stored as a number
 * @property {string} phases - the phases the contributor is involved in; comma-separated
 * @property {string} roles - the roles the contributor has; comma-separated
 * @property {string} tags - the tags associated with the contributor; comma-separated
 * 
 */
interface D1Contributor extends ContributorPrimitive { // database representation of Contributor
    contributor_id: number;
    entry_date: string; // ISO 8601 format
    active: number;
    admin: number;
    phases: string; // comma-separated phase numbers
    roles: string; // comma-separated role names
    tags: string; // comma-separated tags
    [key: string]: string | number | null; // no additional fields expected; trying to clear compiler issue
}

// only current role anticipated is "reviewer", which bypasses the contribution edit lockout for non-primary contributors

interface ComposerPrimitive {
    name: string;
    role: string; // usually "composer", but can be defined as "arranger" or another type as declared
    birth_year: number;
    death_year: number; // -1 is defined as not dead
    country: string; // used as text for now, but will switch to ISO 3166-1 alpha-2 code in the future
    bio: string;
    image: string | null; // refers to a file in assets, or an external URL
}

/**
 * The API representation of a composer
 * 
 * @namespace Composer
 * @property {string} name - the composer's name
 * @property {string} role - the composer's role in the composition (e.g. "composer", "arranger", etc)
 * @property {number} birth_year - the composer's birth year
 * @property {number} death_year - the composer's death year, or -1 if the composer is still alive
 * @property {string} country - the composer's country, stored as text for now but will switch to ISO 3166-1 alpha-2 code in the future
 * @property {string} bio - a short biography of the composer
 * @property {string | null} image - the URL of the composer image, or null
 */
interface Composer extends ComposerPrimitive { // the API representation of a composer
    // an object representation of a composer
    tags: string[]; // list of tags associated with the composer
}

/**
 * The API representation of a composer record from D1
 * 
 */
interface ComposerRecord extends Composer { // Composer, but with fields indicating that it originates from D1
    // the default construct for a composer object that originates from D1
    id: number;
    entry_date: string; // ISO 8601 format
}

/**
 * The database representation of a composer record from D1
 */
interface D1Composer extends ComposerPrimitive { // database representation of Composer
    // the actual object representation stored in D1 before processing as a ComposerRecord
    // see D1Composition - record representation is different
    composer_id: number;
    entry_date: string; // ISO 8601 format
    tags: string; // comma-separated tags
    [key: string]: string | number | null; // no additional fields expected; trying to clear compiler issue
}

/**
 * The rating of a composition, stored in a Composition object and its inheritors
 */
interface CompositionRating {
    suzuki: number | null; // 1-10, null if not rated
    nyssma: number | null; // 1-6, null if not rated
}

/**
 * Publication information, stored in a Composition object and its inheritors
 * 
 */
interface PublicationInfo {
    name: string;
    location: string;
    year: number;
    uri_type: string; // https, isbn, or other
    uri: string;
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
    name: string;
    composer_id: number; // the primary composer
    contrib_primary_1: number; // primary contributors are used to enforce the rule that edits can only be made by ones who contributed
    contrib_primary_2: number | null;
    type: WorkType;
    part: string | null;
    key: Key | null; // a Key is not always appropriate
    range: string | null;
    position_highest: string | null;
    notes_pedagogical: string | null;
    notes_historical: string | null;
    notes_other: string | null;
    image: string | null; // refers to a file in assets, or an external URL
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
 */
interface Composition extends CompositionPrimitive {
    // the default construct for objects representing a composition
    rating: CompositionRating;
    publication_info: PublicationInfo;
    contrib_addl: number[]; // list of additional contributors, which are not used to confer edit permissions
    author_secondary: number[]; // list of secondary authors
    phases: number[];
    tags: string[]
}

/**
 * the API representation of a composition record from D1
 */
interface CompositionRecord extends Composition {
    // the default construct for a composition object that originates from D1
    id: number;
    entry_date: string; // ISO 8601 format
}

/**
 * the database representation of a composition record from D1
 */
interface D1Composition extends CompositionPrimitive {
    // the actual object representation stored in D1 before processing as a CompositionRecord
    // the object representation stored in D1 differs from the representation used by middleware - it is flatter
    // also, the primary key is different

    // a function in api/common.ts provides translation between these record types
    composition_id: number;
    author_secondary: string; // comma-separated list of secondary authors, stored as text in D1 but converted to string[] in middleware
    contrib_addl: string;
    phases: string;
    publish_location: string;
    publish_name: string;
    publish_year: number;
    uri_type: string;
    uri: string;
    rating_suzuki: number | null;
    rating_nyssma: number | null;
    tags: string; // comma-separated list
    entry_date: string; // ISO 8601 format
    full_name?: string; // generated and stored in d1, but not used in middleware and business logic
    [key: string]: string | number | null; // no additional fields expected; trying to clear compiler issue
}