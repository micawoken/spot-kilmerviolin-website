/**
 * lib/public/usermgmt.ts
 * 
 * Provides functions to manage administrator accounts, including account creation, update, and delete
 * 
 */

import { add_user, list_users, remove_user } from '../api/access_iam_mgmt';
import { conferFrom, requires } from '../api/authorize';
import { formatContribFromD1 } from '../api/common';
import { CONTRIBUTOR, recordTypeAssertComplete, getRecord } from '../api/d1';
import { addContributor, _getPrimitiveCacheless, updateContributorPartial } from '../api/database';

/** Whether an identity email is present in the (lowercase) Cloudflare Access user list. */
function isEmailInAccess(email: string, accessList: string[]): boolean {
    return accessList.includes(email.toLowerCase())
}

/**
 * Builds a Contributor record for enrollment, applying the shared defaults (public_email mirrors the
 * identity email; bio "", no image, not an admin, null phases, empty tags). Caller supplies the
 * fields that differ between create and finish flows (roles and active state).
 */
function buildContributor(identity_email: string, name: string, major: string | null, class_year: number | null, roles: string[], active: boolean): Contributor {
    return {
        name: name,
        identity_email: identity_email,
        public_email: identity_email,
        class_year: class_year,
        major: major,
        bio: "",
        image: null,
        roles: roles,
        active: active,
        admin: false,
        phases: null,
        tags: []
    }
}

/**
 * Looks up the raw (uncached) Contributor primitive by identity email, returning null when the user is
 * absent or the lookup fails. Shared by finishUser and emailToId.
 */
async function getContributorPrimitiveByEmail(email: string): Promise<Record<string, string | number | null> | null> {
    try {
        return await _getPrimitiveCacheless(CONTRIBUTOR, "identity_email", email)
    } catch (error) {
        return null
    }
}

/**
 * Retrieves user information for an identity email from Cloudflare Access and the Contributor table
 * @param identity_email the email of the user (which is used to authenticate with Access)
 * @returns a tuple, first with the ContributorRecord and second with whether the user is found in Access
 */
export async function getUserInfo(identity_email: string): Promise<[ContributorRecord | null, boolean]> {
    const access_info = await list_users()
    const in_access = isEmailInAccess(identity_email, access_info)
    try {
        const contrib_primitive = await _getPrimitiveCacheless(CONTRIBUTOR, "identity_email", identity_email)
        if (contrib_primitive === null) {
            return [null, in_access]
        }
        const contributor = formatContribFromD1(recordTypeAssertComplete(CONTRIBUTOR, contrib_primitive, false) as D1Contributor)
        return [contributor, true]
    } catch (error) {
        return [null, in_access]
    }
}

/**
 * Enrolls a user in Access and creates an authorization record (eliminating the need for self-enrollment)
 * 
 * @param {ExecutionContext} ctx The Cloudflare Workers execution context
 * @param {Identity} acting_identity The Identity object of the user performing createUser
 * @param {boolean} confer Whether to confer the acting identity's conferrable roles to the new user
 * @param {string} identity_email The email of the user to be created (which is used to authenticate with Access)
 * @param {string} name The name of the user to be created
 * @param {string | null} major The major of the user to be created, or null to omit
 * @param {number | null} class_year The class year of the user to be created, or null to omit
 *
 */
export async function createUser(ctx: ExecutionContext, acting_identity: Identity, confer: boolean, identity_email: string, name: string, major: string | null, class_year: number | null): Promise<void> {
    // verify the acting identity has permission to create users
    if (!acting_identity.admin && !requires("user_addition", acting_identity)) {
        throw new Error("Unauthorized: insufficient permissions to create user")
    }
    
    // verify that the user doesn't already exist in Access or the Contributor table
    const access_info = await list_users()
    if (isEmailInAccess(identity_email, access_info)) {
        throw new Error("User already exists in Access; use finishUser()")
    }
    if (await _getPrimitiveCacheless(CONTRIBUTOR, "identity_email", identity_email) !== null) {
        throw new Error("User already exists in Contributor table; use finishUser()")
    }
    // enable authentication
    await add_user(identity_email)
    // provide authorization
    let new_roles: string[]
    if (confer) {
        new_roles = conferFrom(acting_identity)
    } else {
        new_roles = []
    }
    const new_contributor = buildContributor(identity_email, name, major, class_year, new_roles, true)
    await addContributor(ctx, new_contributor)
}

/**
 * Completes enrollment of a registered user, if missing in Access or contributors
 * By default, if missing in contributors, the authorization record is permissionless and disabled
 * 
 * @param {ExecutionContext} ctx The Cloudflare Workers execution context
 * @param {string} identity_email The email of the user to be finished (which is used to authenticate with Access)
 * @param {string} name The name of the user to be finished (required if the user is missing in the Contributor table)
 * @param {string | null} major The major of the user to be finished (optional; omitted values are stored as null)
 * @param {number | null} class_year The class year of the user to be finished (optional; omitted values are stored as null)
 */
export async function finishUser(ctx: ExecutionContext, identity_email: string, name?: string, major?: string | null, class_year?: number | null): Promise<number | null | undefined> {
    // if a user is missing an access authentication or an authorization, this function can be used to fix a user's login flow
    const access_list = await list_users()
    const in_access = isEmailInAccess(identity_email, access_list)
    const d1_record = await getContributorPrimitiveByEmail(identity_email)

    if ((d1_record === null) && !in_access) {
        // user does not exist
        return undefined
    }
    if ((d1_record !== null) && in_access) {
        // user is fully enrolled
        return undefined
    }

    if (!in_access) {
        // user is missing Access enrollment, so add them
        await add_user(identity_email)
    }
    if (d1_record === null) {
        // user is missing Contributor enrollment, so add them
        // major and class_year are nullable columns; only the name is required to create the record
        if (name === undefined) {
            throw new Error("Missing required information to finish user enrollment in Contributor table")
        }
        const new_contributor = buildContributor(identity_email, name, major ?? null, class_year ?? null, [], false)
        return await addContributor(ctx, new_contributor)
    }
    return null
}

/**
 * Activates a contributor record, authorizing add permissions and limited edit permissions
 * This does not confer Access authentication, which is required for a contributor record to be used
 * 
 * @param {ExecutionContext} ctx The Cloudflare Workers execution context
 * @param {number} id The id of the user to be activated
 */
export async function activateUser(ctx: ExecutionContext, id: number): Promise<void> {
    await updateContributorPartial(ctx, id, { active: true })
}

/**
 * Deactivates a contributor record, removing add permissions and edit permissions
 * This does not affect Access authentication, but deactivated users will only have read permissions
 * 
 * @param {ExecutionContext} ctx The Cloudflare Workers execution context
 * @param {number} id The id of the user to be deactivated
 */
export async function deactivateUser(ctx: ExecutionContext, id: number): Promise<void> {
    await updateContributorPartial(ctx, id, { active: false })
}

/**
 * Designates a user as an administrator
 * This does not confer Access authentication
 * 
 * @param {ExecutionContext} ctx The Cloudflare Workers execution environment
 * @param {number} id The id of the user to be elevated
 */
export async function elevateUser(ctx: ExecutionContext, id: number): Promise<void> {
    await updateContributorPartial(ctx, id, { admin: true })
}

/**
 * Removes a user from administrator status
 * This does not affect Access authentication
 * 
 * @param {ExecutionContext} ctx The Cloudflare Workers execution environment
 * @param {number} id The id of the user to be demoted
 */
export async function demoteUser(ctx: ExecutionContext, id: number): Promise<void> {
    await updateContributorPartial(ctx, id, { admin: false })
}

/**
 * Pulls the contributor record by ID and performs a type assertion
 * 
 * @param {number} id the id of the contributor to be fetched
 * @returns the contributor record, formatted as a ContributorRecord
 */
async function fetcher(id: number): Promise<ContributorRecord> {
    try {
        const record_primitive = await getRecord(CONTRIBUTOR, id)
        if (record_primitive.results.length === 0) {
            throw new Error("User not found")
        }
        return formatContribFromD1(recordTypeAssertComplete(CONTRIBUTOR, record_primitive.results[0] as Record<string, string | number | null>, false) as D1Contributor)
    } catch (error) {
        throw new Error("User not found")
    }
}

/**
 * Assigns a role to a user, conferring permissions according to the role profile
 * 
 * @param {ExecutionContext} ctx The Cloudflare Workers execution context
 * @param {number} id The id of the user to be assigned a role
 * @param {string} role The role to be assigned to the user
 */
export async function assignRole(ctx: ExecutionContext, id: number, role: string): Promise<void> {
    const record = await fetcher(id)
    const current_roles = record.roles
    if (current_roles.includes(role)) {
        // role is already assigned
        return
    }
    current_roles.push(role)
    await updateContributorPartial(ctx, id, { roles: current_roles })
}

/**
 * Removes a role from a user, removing permissions according to the role profile
 * 
 * @param {ExecutionContext} ctx The Cloudflare Workers execution context
 * @param {number} id The id of the user to be unassigned a role
 * @param {string} role The role to be removed from the user
 */
export async function removeRole(ctx: ExecutionContext, id: number, role: string): Promise<void> {
    const record = await fetcher(id)
    if (!record.roles.includes(role)) {
        // role is not assigned
        return
    }
    const new_roles = record.roles.filter(r => r !== role)
    await updateContributorPartial(ctx, id, { roles: new_roles })
}

export async function _changeLoginEmail(ctx: ExecutionContext, id: number, old_email: string, new_email: string): Promise<void> {
    // update contributor data
    await updateContributorPartial(ctx, id, { identity_email: new_email })
    // update access
    await add_user(new_email)
    await remove_user(old_email)
}

/**
 * Changes a user's identity email used to log into Access (and also updates the contributor record)
 * 
 * @param {ExecutionContext} ctx The Cloudflare Workers execution context
 * @param {number} id The id of the user whose email is to be changed
 * @param {string} new_email The new email address for the user
 */
export async function changeLoginEmail(ctx: ExecutionContext, id: number, new_email: string): Promise<void> {
    const record = await fetcher(id)
    const old_email = record.identity_email
    // update contributor data
    await _changeLoginEmail(ctx, id, old_email, new_email)
}

/**
 * Replaces a user's entire set of roles with the provided list (set semantics, as opposed to the
 * incremental add/remove of assignRole/removeRole). Role validity is the caller's responsibility.
 *
 * @param {ExecutionContext} ctx The Cloudflare Workers execution context
 * @param {number} id The id of the user whose roles are to be set
 * @param {string[]} roles The complete list of roles the user should have
 */
export async function setRoles(ctx: ExecutionContext, id: number, roles: string[]): Promise<void> {
    await updateContributorPartial(ctx, id, { roles: roles })
}

/**
 * Reports whether a Contributor property may be written through changeProperty, deriving the answer
 * from the CONTRIBUTOR schema (lib/api/d1.ts) rather than a separate hardcoded allowlist so the two
 * cannot drift. A property is writable when it is a real table column that is not the primary key, not a
 * representation-only column (repr_exclude, e.g. entry_date), and not a protected authentication/
 * authorization column (CONTRIBUTOR.protected: roles, admin, identity_email).
 *
 * `active` is additionally reserved here: it gates whether a credential can be used (an authorization
 * concern) and has dedicated activateUser/deactivateUser entry points, but it is intentionally not part
 * of CONTRIBUTOR.protected (which would also hide it from readers and gate it behind elevation), so it is
 * excluded at this layer without modifying the schema.
 *
 * @param {string} property the candidate Contributor property name
 * @returns {boolean} true if the property is a writable, non-auth column
 */
function isChangeableProperty(property: string): boolean {
    const reserved = new Set<string>([
        CONTRIBUTOR.primary_key,
        ...CONTRIBUTOR.repr_exclude,
        ...(CONTRIBUTOR.protected ?? []),
        "active"
    ])
    return CONTRIBUTOR.columns.includes(property) && !reserved.has(property)
}

/**
 * Changes a non-authentication, non-authorization property of a user, such as bio or public email
 *
 * @param {ExecutionContext} ctx The Cloudflare Workers execution context
 * @param  {number} id The id of the user whose property is to be changed
 * @param {keyof Omit<Contributor, "id" | "identity_email" | "roles" | "active" | "admin">} property The property to be changed; must be a non-authentication, non-authorization property of the Contributor table
 * @param {string | number | null} value The new value for the property
 * @throws {Error} if property is not a writable (non-authentication, non-authorization) Contributor column
 */
export async function changeProperty(ctx: ExecutionContext, id: number, property: keyof Omit<Contributor, "id" | "identity_email" | "roles" | "active" | "admin">, value: string | number | null): Promise<void> {
    // updates a non-authentication, non-authorization property of a user
    // guard at runtime: the TS type forbids auth/authz keys, but a caller passing an unvalidated string
    // would otherwise be able to write columns such as roles or admin through this path
    if (!isChangeableProperty(property)) {
        throw new Error(`Property "${property}" cannot be changed through changeProperty`)
    }
    const update_data: Partial<Contributor> = {}
    update_data[property] = value as any
    await updateContributorPartial(ctx, id, update_data)
}

/**
 * Given an identity email, returns the corresponding contributor ID, or null if not found
 * 
 * @param {string} email the identity email of the user whose ID is to be fetched
 * @returns the contributor ID corresponding to the identity email, or null if not found
 */
export async function emailToId(email: string): Promise<number | null> {
    const contrib_data = await getContributorPrimitiveByEmail(email)
    if (contrib_data === null) {
        return null
    }
    return contrib_data.contributor_id as number
}

/**
 * Given a contributor ID, returns the corresponding identity email, or null if not found
 * 
 * @param {number} id the contributor ID of the user whose identity email is to be fetched
 * @returns the identity email corresponding to the contributor ID, or null if not found
 */
export async function idToEmail(id: number): Promise<string | null> {
    try {
        const contrib_data = await getRecord(CONTRIBUTOR, id)
        if (contrib_data.results.length === 0) {
            return null
        }
        return (contrib_data.results[0] as Record<string, string | number | null>).identity_email as string
    } catch (error) {
        return null
    }
}

/**
 * Removes a user from Access and deactivates their contributor record
 * 
 * @param {ExecutionContext} ctx The Cloudflare Workers execution environment
 * @param {string} identity_email The email of the user to be removed (which is used to authenticate with Access)
 */
export async function removeUser(ctx: ExecutionContext, identity_email: string): Promise<void> {
    // removes a user from Access, and deactivates their contributor record
    await remove_user(identity_email)
    try {
        const contrib_data = await _getPrimitiveCacheless(CONTRIBUTOR, "identity_email", identity_email)
        if (contrib_data === null) {
            return
        }
        // no need to type convert it, since contributor_id exists
        await updateContributorPartial(ctx, contrib_data.contributor_id as number, { active: false })
    } catch (error) {
        // User not in D1, that's okay - just remove from Access
        return
    }
}