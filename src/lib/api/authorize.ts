/**
 * lib/api/authorize.ts
 * 
 * Accepts a BaseIdentity object from authenticate.ts and provides authorization information
 * Validates an Identity object for a given scope
 * Provides basic authorization primitives for Identity objects, such as verifying role permissions and admin status
 * 
 * 
 * Calls depend on authenticate.ts
 * Dependent on d1.ts (to query authorization data)
 * 
 */

import { env } from "cloudflare:workers"
import { getRecordSpecificProp, CONTRIBUTOR, recordTypeAssertComplete } from "./d1.ts";
import { SQLStatement } from "./sql.ts";

/**
 * The available roles and their permissions defined in lib/api/authorize.ts
 * 
 */
export const roles: Record<string, RoleProfile> = {
    "reviewer": {
        overrides_lockout: true,
        lockout_ignore_admin: true,
        user_activation: false,
        user_addition: false,
        conferrable: true,
    },
    "userenroll": {
        overrides_lockout: false,
        lockout_ignore_admin: false,
        user_activation: true,
        user_addition: true,
        conferrable: false,
    }
}

/**
 * Returns the contributor record associated with the BaseIdentity, or null if no such record exists
 * 
 * @param {BaseIdentity} identity - the BaseIdentity object to find a matching contributor record for
 * @returns {Promise<D1Contributor | null>} - a promise that resolves to the matching contributor record, or null if no match is found
 * 
 */
async function _getIdentityRecord(identity: BaseIdentity): Promise<D1Contributor | null> {
    // returns the contributor record whose identity email aligns with the BaseIdentity email
    const identity_email = identity.email
    try {
        const response = await getRecordSpecificProp(CONTRIBUTOR, "identity_email", identity_email)
        if (!response.success || response.results.length === 0) {
            return null
        }
        return recordTypeAssertComplete(CONTRIBUTOR, response.results[0] as Record<string, string | number | null>) as D1Contributor
    } catch (error) {
        return null
    }
}

/**
 * Using a BaseIdentity from authenticate.ts and a contributor record from d1.ts, constructs an authorization record
 * 
 * @param {BaseIdentity} identity - the BaseIdentity object to construct from
 * @param {D1Contributor | null} record - the D1Contributor record to construct from, or null if no such record exists
 * @returns {Identity} - the constructed Identity object
 */
function buildIdentity(identity: BaseIdentity, record: D1Contributor | null): Identity {
    // builds an Identity object from a BaseIdentity and a D1Contributor record
    // there is no validation of identity or record, so this function is not exposed
    const allowed = record !== null
    const enrollable = (record === null && env.API_USER_SELFENROLL) // provides method 2 enrollment directly; method 1 is accomplished in the enrollment flow
    const active = record ? record.active === 1 : false
    // an empty roles column ("") splits to [""], which is not a valid role and breaks role lookups; filter blanks so a roleless user is [] not [""]
    const roles = record ? record.roles.split(",").map((r: string) => r.trim()).filter((r: string) => r.length > 0) : []
    const id = record ? record.contributor_id : -1
    const admin = record ? record.admin === 1 : false
    const user_info: UserInfo = {
        name: record ? record.name : "",
        // the tags and phases columns are nullable; a null column yields an empty list in the identity summary
        tags: record && record.tags ? record.tags.split(",").map((t: string) => t.trim()) : [],
        phases: record && record.phases ? record.phases.split(",").map((p: string) => parseInt(p.trim())).filter((p: number) => !isNaN(p)) : [],
        entry_date: record ? record.entry_date : "",
        ok: record !== null
    }
    return {
        ...identity,
        "allowed": allowed,
        "enrollable": enrollable,
        "active": active,
        "roles": roles,
        "id": id,
        "admin": admin,
        "userinfo": user_info,
    }
}

/**
 * Constructs an Identity object with authorization info from a BaseIdentity
 *
 * @param {BaseIdentity} identity - the BaseIdentity object to construct from
 * @returns {Promise<Identity>} - a promise that resolves to the constructed Identity object
 *
 */
export default async function authorize(identity: BaseIdentity): Promise<Identity> {
    const record = await _getIdentityRecord(identity)
    // buildIdentity handles the no-record case, deriving enrollable from env.API_USER_SELFENROLL;
    // it must be used for both branches so that disabling self-enrollment is actually honored
    return buildIdentity(identity, record)
}

/**
 * Checks if a given identity has a required permission based on their assigned roles
 * @param {keyof RoleProfile} permission - the permission to check for
 * @param {Identity} identity - the Identity object to check permissions for
 * @return {boolean} - true if the identity has the required permission, false otherwise
 * 
 */
export function requires(permission: keyof RoleProfile, identity: Identity): boolean {
    // delegates to requiresOneOf so all role lookups share one (unknown-role-safe) implementation
    return requiresOneOf([permission], identity, false)
}

/**
 * Checks if a given identity has at least one of the required permissions based on their assigned roles
 * @param {keyof RoleProfile[]} permissions - the permissions to check for
 * @param {Identity} identity - the Identity object to check permissions for
 * @return {boolean} - true if the identity has at least one of the required permissions, false otherwise
 */
export function requiresOneOf(permissions: (keyof RoleProfile)[], identity: Identity, fail_closed: boolean = true): boolean {
    if (permissions.length === 0) {
        if (fail_closed) return identity.admin
        else return true
    }
    const user_roles = identity.roles
    return user_roles.some(role => {
        const profile = roles[role]
        // an unknown role string (stale/typo data) has no profile; treat it as granting nothing rather than throwing
        if (!profile) return false
        return permissions.some(permission => profile[permission] === true)
    })
}

/**
 * Checks if a given identity has all of the required permissions based on their assigned roles
 * @param {keyof RoleProfile[]} permissions - the permissions to check for
 * @param {Identity} identity - the Identity object to check permissions for
 * @return {boolean} - true if the identity has all of the required permissions, false otherwise
 */
export function requiresAllOf(permissions: (keyof RoleProfile)[], identity: Identity, fail_closed: boolean = true): boolean {
    if (permissions.length === 0) {
        if (fail_closed) return identity.admin
        else return true
    }
    const user_roles = identity.roles
    return user_roles.some(role => {
        const profile = roles[role]
        // an unknown role string (stale/typo data) has no profile; treat it as granting nothing rather than throwing
        if (!profile) return false
        return permissions.every(permission => profile[permission] === true)
    })
}

/**
 * Returns a list of conferrable roles that the given identity can confer to other users
 * @param {Identity} identity - the Identity object to check conferrable roles for
 * @return {string[]} - a list of conferrable roles that the identity can confer to other users
 */
export function conferFrom(identity: Identity): string[] {
    // an admin check is not performed since the case where an admin wants to confer all roles is an edge case that isn't too important to ease
    return identity.roles.filter((value, index, array) => {
        if (!(value in roles)) {
            return false
        }
        return roles[value].conferrable
    })
}

/**
 * Implements the contribution edit lockout
 * 
 * @param {CompositionRecord} record - the composition record to compare against
 * @param {Identity} identity - the Identity object to review, assumed to be valid
 * @param {boolean} use_admin - whether to allow review of admin status
 * @returns {boolean} - whether the user is allowed to modify the record
 */
export function canModify(record: CompositionRecord, acting_identity: Identity, use_admin: boolean = true): boolean {
    if (acting_identity?.id === null || acting_identity.id === undefined) {
        // no identity asserted
        return false
    }
    if (record.contrib_primary_1 === acting_identity.id || record.contrib_primary_2 === acting_identity.id) {
        // primary contributor
        return true
    }
    if (requires("overrides_lockout", acting_identity)) {
        // user permission bypasses lockout
        return true
    }
    if (use_admin && acting_identity.admin) {
        // admin bypasses lockout
        return true
    }
    return false
}

/**
 * Protects the contribution edit lockout mechanism by enforcing readonly on its implementing columns
 * 
 * @param {CompositionRecord} record - the current database record to compare against
 * @param {Partial<Composition>} new_record - the new proposed record in API format, which may be partial
 * @param {Identity} acting_identity - the identity of the acting user
 * @param {boolean} use_admin - whether to allow review of admin status
 * @returns {boolean} - whether the user is allowed to perform the modification as-is
 * 
 */
export function canAct(record: CompositionRecord, new_record: Partial<Composition>, acting_identity: Identity, use_admin: boolean = true) {
    if (acting_identity?.id === null || acting_identity.id === undefined) {
        // no identity asserted
        return false
    }
    if (use_admin && acting_identity.admin) {
        // admin bypasses lockout entirely, including the co-primary protection below
        return true
    }
    if (record.contrib_primary_1 === acting_identity.id || record.contrib_primary_2 === acting_identity.id) {
        // a primary contributor may edit, but may not modify or remove a *defined, non-self* co-primary
        // (filling an empty second slot, e.g. adding a co-primary through the first, remains allowed)
        return !modifiesProtectedPrimary(record, new_record, acting_identity.id)
    }
    // the user is not an admin and isn't a primary contributor
    // for the operation to proceed, it cannot modify the columns relevant to the lockout system, i.e. the primary contributor columns

    if ((record.contrib_primary_1 !== new_record?.contrib_primary_1 && "contrib_primary_1" in new_record) || (record.contrib_primary_2 !== new_record?.contrib_primary_2 && "contrib_primary_2" in new_record)) {
        // the operation modifies the lockout columns; do not allow since not admin or primary
        return false
    }
    // operation is by non-admin but doesn't modify lockout; proceed
    return true
}

/**
 * Detects whether a proposed update modifies or removes a primary contributor slot that currently
 * holds a defined contributor other than the acting user. Filling an empty (null) slot and leaving a
 * slot unchanged are both permitted; changing or clearing a non-self contributor is not.
 *
 * @param {CompositionRecord} record - the current database record
 * @param {Partial<Composition>} new_record - the proposed (possibly partial) update in API format
 * @param {number} self - the acting user's contributor id
 * @returns {boolean} - true if the update touches a protected (defined, non-self) primary slot
 */
function modifiesProtectedPrimary(record: CompositionRecord, new_record: Partial<Composition>, self: number): boolean {
    const slots: ("contrib_primary_1" | "contrib_primary_2")[] = ["contrib_primary_1", "contrib_primary_2"]
    return slots.some(slot => {
        if (!(slot in new_record)) {
            // the slot is not part of this update; it cannot be modified
            return false
        }
        const current = record[slot]
        // only a defined contributor other than the acting user is protected
        if (current === null || current === undefined || current === self) {
            return false
        }
        // protected slot: any change away from its current value is a modify/remove
        return new_record[slot] !== current
    })
}

/**
 * Returns whether a non-blank, asserted contributor id is held by the acting identity
 *
 * @param {number | null | undefined} id - the identity's contributor id
 * @returns {boolean} - true if the id is a valid (asserted) contributor id, false otherwise
 */
function hasContributorId(id: number | null | undefined): id is number {
    // an unenrolled identity carries id -1 (see buildIdentity); treat that, null, and undefined as "no id"
    return id !== null && id !== undefined && id !== -1
}

/**
 * Enforces the create-time authorization rule for compositions: a non-admin may only create a
 * composition on which they are themselves a primary contributor, while an admin (when use_admin is
 * set) may name any registered users as primaries
 *
 * @param {Composition} record - the proposed composition record
 * @param {Identity} acting_identity - the identity of the acting user, assumed to be valid
 * @param {boolean} use_admin - whether to allow review of admin status
 * @returns {boolean} - whether the user is allowed to create the proposed record
 */
export function canCreate(record: Composition, acting_identity: Identity, use_admin: boolean = true): boolean {
    if (!hasContributorId(acting_identity?.id)) {
        // no enrolled identity asserted; cannot be a primary contributor
        return false
    }
    if (use_admin && acting_identity.admin) {
        // admins may create compositions naming any registered users as primaries
        return true
    }
    // non-admins must name themselves as one of the primary contributors
    return record.contrib_primary_1 === acting_identity.id || record.contrib_primary_2 === acting_identity.id
}

/**
 * Computes the additional-contributor list that records the acting user as a contributor when they
 * edit a composition without being one of its primaries (the effective primaries are the proposed
 * ones when the update changes them, else the current record's)
 *
 * Returns null when no change is needed: the acting user is unenrolled, is an effective primary, or
 * is already present in the additional-contributor list.
 *
 * @param {CompositionRecord} current - the current database record
 * @param {Partial<Composition>} proposed - the proposed (possibly partial) update in API format
 * @param {Identity} acting_identity - the identity of the acting user
 * @returns {number[] | null} - the updated contrib_addl list, or null if no change is needed
 */
export function withActingContributor(current: CompositionRecord, proposed: Partial<Composition>, acting_identity: Identity): number[] | null {
    if (!hasContributorId(acting_identity?.id)) {
        return null
    }
    const self = acting_identity.id
    const effective_primary_1 = "contrib_primary_1" in proposed ? proposed.contrib_primary_1 : current.contrib_primary_1
    const effective_primary_2 = "contrib_primary_2" in proposed ? proposed.contrib_primary_2 : current.contrib_primary_2
    if (self === effective_primary_1 || self === effective_primary_2) {
        // the editor is already a primary contributor; nothing to record
        return null
    }
    // base on the proposed list when the update sets it, else carry the current record's list forward
    const base = "contrib_addl" in proposed && Array.isArray(proposed.contrib_addl) ? proposed.contrib_addl : current.contrib_addl
    if (base.includes(self)) {
        // the editor is already recorded as an additional contributor
        return null
    }
    return [...base, self]
}