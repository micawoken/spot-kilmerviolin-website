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
    const roles = record ? record.roles.split(",").map((r: string) => r.trim()) : []
    const id = record ? record.contributor_id : -1
    const admin = record ? record.admin === 1 : false
    const user_info: UserInfo = {
        name: record ? record.name : "",
        tags: record ? record.tags.split(",").map((t: string) => t.trim()) : [],
        phases: record ? record.phases.split(",").map((p: string) => parseInt(p.trim())) : [],
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
 * Internal function to return a partial Identity object with no permissions
 */
function _permissionlessPrototype() {
    // returns a permissionless Identity object useable for enrollment
    // this function may not be needed since buildIdentity accepts null
    return {
        "allowed": false,
        "enrollable": true,
        "active": false,
        "roles": [],
        "id": -1,
        "admin": false,
        "userinfo": {
            "name": "",
            "tags": [],
            "phases": [],
            "entry_date": "",
            "ok": false
        }
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
    if (record === null) {
        return {
            ...identity,
            ..._permissionlessPrototype()
        }
    }
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
    const user_roles = identity.roles
    return user_roles.some(role => {roles[role][permission]})
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
        return permissions.some(permission => roles[role][permission])
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
        return permissions.every(permission => roles[role][permission])
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
    if (record.contrib_primary_1 === acting_identity.id || record.contrib_primary_2 === acting_identity.id) {
        // primary contributor
        return true
    }
    if (use_admin && acting_identity.admin) {
        // admin bypasses lockout
        return true
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