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

import { getRecordSpecificProp, CONTRIBUTOR } from "./d1.ts";


export const roles: Record<string, RoleProfile> = {
    "reviewer": {
        overrides_lockout: true,
        lockout_ignore_admin: false
    }
}


async function _getIdentityRecord(identity: BaseIdentity): Promise<D1Contributor | null> {
    // returns the contributor record whose identity email aligns with the BaseIdentity email
    const identity_email = identity.email
    const response = await getRecordSpecificProp(CONTRIBUTOR, "identity_email", identity_email)

    if (response instanceof Error) {
        return null
    }
    if (!response.success || response.results.length === 0) {
        return null
    }
    return response.results[0] as D1Contributor
}

function buildIdentity(identity: BaseIdentity, record: D1Contributor | null): Identity {
    // builds an Identity object from a BaseIdentity and a D1Contributor record
    // there is no validation of identity or record, so this function is not exposed
    const allowed = record !== null
    const enrollable = (record === null) // provides method 2 enrollment directly; method 1 is accomplished in the enrollment flow
    const active = record ? record.active === 1 : false
    const roles = record ? record.roles.split(",").map((r: string) => r.trim()) : []
    const id = record ? record.contributor_id : -1
    const admin = record ? record.admin === 1 : false
    return {
        ...identity,
        "allowed": allowed,
        "enrollable": enrollable,
        "active": active,
        "roles": roles,
        "id": id,
        "admin": admin
    }
}

export async function authorize(identity: BaseIdentity): Promise<Identity | null> {
    const record = await _getIdentityRecord(identity)
    if (record === null) {
        return null
    }
    return buildIdentity(identity, record)
}

export function check_lockout(acting_identity: Identity, subject_identity: Identity, role: string): [boolean, string] {
    // checks if the acting identity is allowed to edit representations linked to the subject identity
    if (acting_identity.admin) {
        // administrators always bypass lockout
        return [true, ""]
    }
    if (acting_identity.id === subject_identity.id) {
        // self-reference
        return [true, ""]
    }

    if (!(role in roles)) {
        // role is not recognized
        return [false, "Role not recognized"]
    }

    if (!roles[role].overrides_lockout) {
        // the role does not override lockout, so the edit is not allowed
        return [false, "Role does not override lockout"]
    }

    if (acting_identity.roles.includes(role)) {
        if (subject_identity.admin && roles[role].lockout_ignore_admin) {
            // the subject identity is an admin, but admin status is ignored
            return [true, ""]
        } else if (!subject_identity.admin) {
            // the subject identity is not an admin, so the edit is allowed
            return [true, ""]
        }
    }
    // acting identity does not possess role
    return [false, "Acting identity does not possess role"]
}