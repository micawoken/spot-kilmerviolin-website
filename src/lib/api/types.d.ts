/**
 * lib/api/types.d.ts
 * 
 * Provides type information for objects used in API libraries and other middleware
 * 
 */


interface ApiResponse {
    readonly success: boolean;
    readonly payload: object | null;
    readonly comment: string;
}

interface CacheRecord {
    payload: object;
    comment: string;
}

interface KVMetadata {
    v: number; // version
    f: "text" | "json"; // type, or "f"orm
    t: number; // timestamp, in milliseconds since epoch
    e: number; // ttl in seconds
    value: string | null;
}

// BaseIdentity is returned by the authentication library
interface BaseIdentity { // stores data extracted from JWT
    readonly sub: string;
    readonly email: string; // email is the one listed on the claim, which is not yet linked to the record in the identity database
    readonly nbf: number; 
    readonly exp: number;
} // if created, the identity is assumed as authenticated

// Identity is returned by the authorization library, and is required for authorization; BaseIdentity will not be accepted
interface Identity extends BaseIdentity {
    // connects a base identity generated from an Access JWT claim to an identity record, providing authorization data
    readonly allowed: boolean; // if the identity record is not found, the identity cannot be used
    readonly active: boolean; // if the record indicates the contributor profile is active
    readonly enrollable: boolean; // if the identity record is not found, and the identity is active, the user is allowed to enroll their identity by (1) connecting their identity record to an existing contributor, or (2) creating a new contributor
    // enrollment via method (1) requires the Access email to match the existing contributor email, and enrollment via method (2) requires the Access email to not match any existing contributor email
    readonly roles: string[]; // system-defined roles
    readonly id: number; // the contributor ID stored in the identity record, used to provide authorization for contribution edits
    readonly admin: boolean; // if set, bypasses the id check for editing and enables full access to the identity endpoint
}

// the Identity object is constructed by authorization and is not stored as a record since it contains token-specific data

interface RoleProfile {
    // if set, contributor lockout is disabled
    overrides_lockout: boolean;
    // if set, lockout enforcement will ignore if the subject identity is an admin
    lockout_ignore_admin: boolean;
}

// D1 TYPES

interface D1BaseSchema {
    readonly db: D1Database // the D1 database object
}

interface D1Schema extends D1BaseSchema {
    readonly name: string; // the table name
    readonly columns: string[]; // the  column names in the table
    readonly repr_exclude: string[]; // colums omitted from the object representation but included in the database representation
    readonly index: string[]; // the primary key column, and other columns marked as unique or where there is an index created
    readonly primary_key: string;
    readonly type_hint: Record<string, "string" | "number" | "null">; // provides info for VirtualSQLTable for type conversion
}

// DATA TYPES

interface ContributorPrimitive {
    name: string;
    class_year: number;
    major: string;
    bio: string;
    public_email: string;
    identity_email: string;
    image: string | null;
}

interface Contributor extends ContributorPrimitive { // API representation of a contributor
    phases: number[]; // list of phase numbers the contributor is involved in
    roles: string[]; // list of role names the contributor has
    active: boolean;
    admin: boolean;
}

interface ContributorRecord extends Contributor { // Contributor, but with fields indicating that it originates from D1
    id: number;
    entry_date: string; // ISO 8601 format
    
}

interface D1Contributor extends ContributorPrimitive { // database representation of Contributor
    contributor_id: number;
    entry_date: string; // ISO 8601 format
    active: number;
    admin: number;
    phases: string // comma-separated phase numbers
    roles: string // comma-separated role names
    [key: string]: string | number | null; // no additional fields expected; trying to clear compiler issue
}

// only current role anticipated is "reviewer", which bypasses the contribution edit lockout for non-primary contributors

interface Composer { // the API representation of a composer
    // an object representation of a composer
    name: string;
    role: string; // usually "composer", but can be defined as "arranger" or another type as declared
    birth_year: number;
    death_year: number; // -1 is defined as not dead
    country: string; // used as text for now, but will switch to ISO 3166-1 alpha-2 code in the future
    bio: string;
    image: string | null; // refers to a file in assets, or an external URL
}

interface ComposerRecord extends Composer { // Composer, but with fields indicating that it originates from D1
    // the default construct for a composer object that originates from D1
    id: number;
    entry_date: string; // ISO 8601 format
}

interface D1Composer extends Composer { // database representation of Composer
    // the actual object representation stored in D1 before processing as a ComposerRecord
    // see D1Composition - record representation is different
    composer_id: number;
    entry_date: string; // ISO 8601 format
    [key: string]: string | number | null; // no additional fields expected; trying to clear compiler issue
}

interface CompositionRating {
    suzuki: number | null; // 1-10, null if not rated
    nyssma: number | null; // 1-6, null if not rated
}

interface PublicationInfo {
    name: string;
    location: string;
    year: number;
    uri_type: string; // https, isbn, or other
    uri: string;
}

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
    notes_pedagogical: string;
    notes_historical: string;
    notes_other: string;
}

interface Composition extends CompositionPrimitive {
    // the default construct for objects representing a composition
    rating: CompositionRating;
    publication_info: PublicationInfo;
    contrib_addl: number[]; // list of additional contributors, which are not used to confer edit permissions
    author_secondary: string[]; // list of secondary authors
    phases: number[]
}

interface CompositionRecord extends Composition {
    // the default construct for a composition object that originates from D1
    id: number;
    entry_date: string; // ISO 8601 format
}

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
    entry_date: string; // ISO 8601 format
    full_name?: string; // generated and stored in d1, but not used in middleware and business logic
    [key: string]: string | number | null; // no additional fields expected; trying to clear compiler issue
}