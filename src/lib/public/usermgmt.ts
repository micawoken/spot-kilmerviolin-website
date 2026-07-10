/**
 * lib/public/usermgmt.ts
 *
 * Provides functions to manage administrator accounts, including account creation, update, and delete
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

import { add_user, list_users, remove_user } from "../api/access_iam_mgmt"
import { conferFrom, requires, filterValidRoles } from "../api/authorize"
import { cmsSyncConfigured, pushCmsAccess, isCmsAuthorized } from "../api/cms_access_sync"
import { formatContribFromD1 } from "../api/common"
import { CONTRIBUTOR, recordTypeAssertComplete, getRecord } from "../api/d1"
import { addContributor, _getPrimitiveCacheless, updateContributorPartial } from "../api/database"
import {
    resolveByUsername,
    resolveById,
    addCollaborator,
    removeCollaborator,
    isAuthorized,
    isOwner
} from "../api/github_repo_mgmt"
import { isValidGithubUsername } from "../api/validation"

/** Whether an identity email is present in the (lowercase) Cloudflare Access user list. */
function isEmailInAccess(email: string, accessList: string[]): boolean {
    return accessList.includes(email.toLowerCase())
}

/**
 * Builds a Contributor record for enrollment, applying the shared defaults (public_email mirrors the
 * identity email; bio "", no image, not an admin, null phases, empty tags). Caller supplies the
 * fields that differ between create and finish flows (roles and active state).
 */
function buildContributor(
    identity_email: string,
    name: string,
    major: string | null,
    class_year: number | null,
    roles: string[],
    active: boolean
): Contributor {
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
        tags: [],
        // GitHub linkage is established separately through the self-service / admin linkage flows
        // (lib/api/github_repo_mgmt.ts and the setGithubUsername family below), never at enrollment
        github_username: null,
        github_user_id: null
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
        const contributor = formatContribFromD1(
            recordTypeAssertComplete(CONTRIBUTOR, contrib_primitive, false) as D1Contributor
        )
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
export async function createUser(
    ctx: ExecutionContext,
    acting_identity: Identity,
    confer: boolean,
    identity_email: string,
    name: string,
    major: string | null,
    class_year: number | null
): Promise<void> {
    // verify the acting identity has permission to create users
    if (!acting_identity.admin && !requires("user_addition", acting_identity)) {
        throw new Error("Unauthorized: insufficient permissions to create user")
    }

    // verify that the user doesn't already exist in Access or the Contributor table
    const access_info = await list_users()
    if (isEmailInAccess(identity_email, access_info)) {
        throw new Error("User already exists in Access; use finishUser()")
    }
    if ((await _getPrimitiveCacheless(CONTRIBUTOR, "identity_email", identity_email)) !== null) {
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
export async function finishUser(
    ctx: ExecutionContext,
    identity_email: string,
    name?: string,
    major?: string | null,
    class_year?: number | null
): Promise<number | null | undefined> {
    // if a user is missing an access authentication or an authorization, this function can be used to fix a user's login flow
    const access_list = await list_users()
    const in_access = isEmailInAccess(identity_email, access_list)
    const d1_record = await getContributorPrimitiveByEmail(identity_email)

    if (d1_record === null && !in_access) {
        // user does not exist
        return undefined
    }
    if (d1_record !== null && in_access) {
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
 * Best-effort push of a contributor's current CMS-editor authorization to the external Pages CMS, keyed by
 * their identity email. Reads the post-write contributor record (callers await the mutation first) and
 * fires the push fire-and-forget via ctx.waitUntil, so a CMS outage never fails the worker request; the
 * Pages CMS reconcile cron repairs any missed push. No-ops when the sync is unconfigured (see
 * cmsSyncConfigured). See lib/api/cms_access_sync.ts and docs/dev/pages-cms.md.
 *
 * @param {ExecutionContext} ctx The Cloudflare Workers execution context
 * @param {number} id The id of the contributor whose authorization state should be synced
 */
function syncCmsAccessForUser(ctx: ExecutionContext, id: number): void {
    if (!cmsSyncConfigured()) {
        return
    }
    ctx.waitUntil(
        (async () => {
            const record = await fetcher(id)
            await pushCmsAccess(record.identity_email, isCmsAuthorized(record))
        })().catch((error) => {
            console.warn("Pages CMS access sync failed; the reconcile cron will repair it", error)
        })
    )
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
    syncCmsAccessForUser(ctx, id)
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
    syncCmsAccessForUser(ctx, id)
}

/**
 * Designates a user as an administrator
 * This does not confer Access authentication
 *
 * @param {ExecutionContext} ctx The Cloudflare Workers execution environment
 * @param {number} id The id of the user to be elevated
 */
export async function elevateUser(ctx: ExecutionContext, id: number): Promise<void> {
    await updateContributorPartial(ctx, id, { admin: true }, true)
    syncCmsAccessForUser(ctx, id)
}

/**
 * Removes a user from administrator status
 * This does not affect Access authentication
 *
 * @param {ExecutionContext} ctx The Cloudflare Workers execution environment
 * @param {number} id The id of the user to be demoted
 */
export async function demoteUser(ctx: ExecutionContext, id: number): Promise<void> {
    await updateContributorPartial(ctx, id, { admin: false }, true)
    syncCmsAccessForUser(ctx, id)
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
        return formatContribFromD1(
            recordTypeAssertComplete(
                CONTRIBUTOR,
                record_primitive.results[0] as Record<string, string | number | null>,
                false
            ) as D1Contributor
        )
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
    // server-side guard: persist only defined roles. Every write to the roles column is filtered so an
    // unknown role string can never reach storage, which keeps the identity permission aggregation bounded
    // to the defined role set (see filterValidRoles / permissionsFromRoles).
    await updateContributorPartial(ctx, id, { roles: filterValidRoles(current_roles) }, true)
    syncCmsAccessForUser(ctx, id)
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
    const new_roles = record.roles.filter((r) => r !== role)
    await updateContributorPartial(ctx, id, { roles: new_roles }, true)
    syncCmsAccessForUser(ctx, id)
}

export async function _changeLoginEmail(
    ctx: ExecutionContext,
    id: number,
    old_email: string,
    new_email: string
): Promise<void> {
    // normalize to lowercase so the stored identity_email matches the lowercased JWT email used for
    // identity lookups (Cloudflare Access is case-insensitive)
    const normalized_new = new_email.trim().toLowerCase()
    // update contributor data
    await updateContributorPartial(ctx, id, { identity_email: normalized_new }, true)
    // update access
    await add_user(normalized_new)
    await remove_user(old_email)
    // the CMS collaborator is keyed by email, so revoke the old email and (re)evaluate the new one; the
    // sync reads the post-write record, which now carries normalized_new
    if (cmsSyncConfigured()) {
        ctx.waitUntil(
            pushCmsAccess(old_email, false).catch((error) => {
                console.warn(
                    "Pages CMS access sync (old-email revoke) failed; the reconcile cron will repair it",
                    error
                )
            })
        )
    }
    syncCmsAccessForUser(ctx, id)
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
 * incremental add/remove of assignRole/removeRole). Invalid roles are filtered out server-side, so any
 * role not defined in authorize.ts is silently dropped rather than persisted.
 *
 * @param {ExecutionContext} ctx The Cloudflare Workers execution context
 * @param {number} id The id of the user whose roles are to be set
 * @param {string[]} roles The complete list of roles the user should have
 */
export async function setRoles(ctx: ExecutionContext, id: number, roles: string[]): Promise<void> {
    // setRoles takes an arbitrary external list, so this is the primary point that keeps unknown roles out
    // of storage (see assignRole for the rationale and filterValidRoles / permissionsFromRoles)
    await updateContributorPartial(ctx, id, { roles: filterValidRoles(roles) }, true)
    syncCmsAccessForUser(ctx, id)
}

/**
 * Reports whether a Contributor property may be written through changeProperty (not primary key, not hidden, not protected, and not "active")
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
export async function changeProperty(
    ctx: ExecutionContext,
    id: number,
    property: keyof Omit<Contributor, "id" | "identity_email" | "roles" | "active" | "admin">,
    value: string | number | null
): Promise<void> {
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
        syncCmsAccessForUser(ctx, contrib_data.contributor_id as number)
    } catch (error) {
        // User not in D1, that's okay - just remove from Access
        return
    }
}

// GITHUB REPOSITORY LINKAGE
//
// A contributor may link a GitHub account (github_username) whose immutable id (github_user_id) is the
// authoritative binding. Linking the username is convenient (self-service for users with the github_link
// permission, or admin-managed by email); granting actual repository write access (adding the account as a
// collaborator) is always an admin operation. Authorization is ID-primary: the stored id is resolved to the
// account's current login before access is changed, so a reassigned username is denied and a legitimate
// rename is followed. See lib/api/github_repo_mgmt.ts and docs/dev/github-linkage.md.

/**
 * Whether a contributor's linked GitHub account currently holds repository write access. Resolves the
 * stored id to its current login (ID-primary) and checks collaborator/invitation status; an unlinked
 * record, or one whose id no longer resolves to an account, is treated as not authorized.
 */
async function _isLinkAuthorized(record: ContributorRecord): Promise<boolean> {
    if (record.github_user_id === null) {
        return false
    }
    const account = await resolveById(record.github_user_id)
    if (account === null) {
        return false
    }
    return isAuthorized(account.login)
}

/**
 * Core username binding: validates the username, resolves it to a GitHub account, enforces that the account
 * is not already linked to a different contributor, and writes the username + immutable id. Callers enforce
 * their own overwrite/authorization policy before calling this.
 *
 * @param ctx the Cloudflare Workers execution context
 * @param id the contributor id to bind the account to
 * @param username the GitHub username to link
 */
async function _bindGithubUsername(ctx: ExecutionContext, id: number, username: string): Promise<void> {
    const trimmed = username.trim()
    if (!isValidGithubUsername(trimmed)) {
        throw new Error("Invalid GitHub username format")
    }
    const account = await resolveByUsername(trimmed)
    if (account === null) {
        throw new Error(`GitHub user '${trimmed}' was not found`)
    }
    // uniqueness: a GitHub account may back at most one contributor (github_user_id is uniquely indexed)
    const existing = await _getPrimitiveCacheless(CONTRIBUTOR, "github_user_id", String(account.id))
    if (existing !== null && (existing.contributor_id as number) !== id) {
        throw new Error("That GitHub account is already linked to another contributor")
    }
    // protected columns; the caller has performed its own permission check, so authorize the write
    await updateContributorPartial(ctx, id, { github_username: account.login, github_user_id: account.id }, true)
}

/**
 * Reads a contributor's GitHub linkage state (username, immutable id, and whether it currently has
 * repository write access). Used by the read endpoints to render the linkage UI.
 *
 * @param id the contributor id
 * @returns the linkage state
 */
export async function getGithubLink(
    id: number
): Promise<{ github_username: string | null; github_user_id: number | null; authorized: boolean }> {
    const record = await fetcher(id)
    return {
        github_username: record.github_username,
        github_user_id: record.github_user_id,
        authorized: await _isLinkAuthorized(record)
    }
}

/**
 * Self-service: sets or changes the caller's own GitHub username. Write-once-until-authorized — once the
 * linked account has been granted repository access, only an administrator may change it; while unauthorized
 * the user may freely replace or clear it (self-clear if unauthorized).
 *
 * @param ctx the Cloudflare Workers execution context
 * @param id the caller's own contributor id
 * @param username the GitHub username to link
 */
export async function setOwnGithubUsername(ctx: ExecutionContext, id: number, username: string): Promise<void> {
    const record = await fetcher(id)
    if (record.github_user_id !== null && (await _isLinkAuthorized(record))) {
        throw new Error(
            "Your GitHub account is authorized for repository access; an administrator must change or remove it"
        )
    }
    await _bindGithubUsername(ctx, id, username)
}

/**
 * Self-service: clears the caller's own GitHub username, allowed only while the link is not authorized for
 * repository access (an authorized link must be removed by an administrator, which also revokes access).
 *
 * @param ctx the Cloudflare Workers execution context
 * @param id the caller's own contributor id
 */
export async function clearOwnGithubUsername(ctx: ExecutionContext, id: number): Promise<void> {
    const record = await fetcher(id)
    if (record.github_user_id === null) {
        return
    }
    if (await _isLinkAuthorized(record)) {
        throw new Error(
            "Your GitHub account is authorized for repository access; an administrator must change or remove it"
        )
    }
    await updateContributorPartial(ctx, id, { github_username: null, github_user_id: null }, true)
}

/**
 * Admin: sets or changes a contributor's GitHub username by id. With allowOverwrite=false (the "set" flow)
 * this refuses to replace an existing link; with allowOverwrite=true (the "change" flow) it replaces it.
 *
 * @param ctx the Cloudflare Workers execution context
 * @param id the target contributor id
 * @param username the GitHub username to link
 * @param allowOverwrite whether replacing an existing link is permitted
 */
export async function adminSetGithubUsername(
    ctx: ExecutionContext,
    id: number,
    username: string,
    allowOverwrite: boolean
): Promise<void> {
    const record = await fetcher(id)
    if (record.github_user_id !== null && !allowOverwrite) {
        throw new Error("A GitHub username is already set for this user; use the change operation to replace it")
    }
    await _bindGithubUsername(ctx, id, username)
}

/**
 * Admin: removes a contributor's GitHub link entirely. Cascades by first revoking repository access for the
 * linked account (unless it is the repository owner, who is never deauthorized), then clearing the columns.
 *
 * @param ctx the Cloudflare Workers execution context
 * @param id the target contributor id
 */
export async function deleteGithubLink(ctx: ExecutionContext, id: number): Promise<void> {
    const record = await fetcher(id)
    if (record.github_user_id !== null) {
        const account = await resolveById(record.github_user_id)
        const login = account?.login ?? record.github_username
        if (login !== null && !isOwner(login)) {
            // revoke any granted repository access before clearing the binding, so access can never be orphaned
            await removeCollaborator(login)
        }
    }
    await updateContributorPartial(ctx, id, { github_username: null, github_user_id: null }, true)
}

/**
 * Admin: grants repository write access to a contributor's linked GitHub account (ID-primary). Resolves the
 * stored id to its current login, adds it as a collaborator, and keeps the stored username aligned with that
 * login (following a legitimate rename).
 *
 * @param ctx the Cloudflare Workers execution context
 * @param id the target contributor id
 */
export async function authorizeGithub(ctx: ExecutionContext, id: number): Promise<void> {
    const record = await fetcher(id)
    if (record.github_user_id === null) {
        throw new Error("This user has no linked GitHub account to authorize")
    }
    const account = await resolveById(record.github_user_id)
    if (account === null) {
        throw new Error("The linked GitHub account no longer exists; clear and re-link the username")
    }
    if (account.login !== record.github_username) {
        // the account was renamed since linking; follow it so the stored username stays accurate
        await updateContributorPartial(ctx, id, { github_username: account.login }, true)
    }
    // the repository owner already holds full access and GitHub refuses to add them as a collaborator
    // (the PUT returns a non-2xx that would otherwise surface as a hard failure); treat authorizing the
    // owner as a no-op, mirroring the owner protection in deauthorizeGithub / deleteGithubLink
    if (isOwner(account.login)) {
        return
    }
    await addCollaborator(account.login)
}

/**
 * Admin: revokes repository write access from a contributor's linked GitHub account, leaving the username
 * link in place. Refuses to deauthorize the repository owner (self-lockout protection).
 *
 * @param ctx the Cloudflare Workers execution context
 * @param id the target contributor id
 */
export async function deauthorizeGithub(ctx: ExecutionContext, id: number): Promise<void> {
    const record = await fetcher(id)
    if (record.github_user_id === null) {
        return
    }
    const account = await resolveById(record.github_user_id)
    const login = account?.login ?? record.github_username
    if (login === null) {
        return
    }
    if (isOwner(login)) {
        throw new Error("Refusing to revoke repository access from the repository owner")
    }
    await removeCollaborator(login)
}

/**
 * Error thrown by applyGithubUsername when a github_username change cannot be applied. Carries the HTTP
 * status the API should surface (403 when the change is blocked by the conditional-protection rule, 400 for
 * a rejected binding such as an unknown user or one already linked to another contributor) so the caller
 * can report it without re-deriving the cause.
 */
export class GithubLinkageError extends Error {
    status: 400 | 403
    constructor(message: string, status: 400 | 403) {
        super(message)
        this.name = "GithubLinkageError"
        this.status = status
    }
}

/**
 * Applies a github_username change subject to the conditional-protection rule used by the contributor PATCH
 * endpoint: while the linked account is NOT authorized for repository access the record owner (or an
 * elevated admin) may freely set, change, or clear the username, but once the account is authorized the
 * column becomes protected and only an elevated administrator may alter it. github_user_id is always derived
 * server-side (never trusted from the client) — setting resolves and verifies the username against GitHub,
 * and clearing wipes both columns (revoking repository access first when the link was authorized, so access
 * is never orphaned).
 *
 * @param ctx the Cloudflare Workers execution context
 * @param id the target contributor id
 * @param username the GitHub username to link, or null/blank to unlink
 * @param elevated whether the request is an elevated administrator action (admin + elevate)
 * @returns true if a change was applied, false if the request was a no-op (unchanged, or nothing to clear)
 * @throws {GithubLinkageError} when the change is blocked by the conditional-protection rule (403) or the
 *   username cannot be bound (400)
 */
export async function applyGithubUsername(
    ctx: ExecutionContext,
    id: number,
    username: string | null,
    elevated: boolean
): Promise<boolean> {
    const record = await fetcher(id)
    const authorized = record.github_user_id !== null && (await _isLinkAuthorized(record))
    // conditional protection: an authorized link is protected and only an elevated admin may change it
    if (authorized && !elevated) {
        throw new GithubLinkageError(
            "Your GitHub account is authorized for repository access; an administrator must change or remove it",
            403
        )
    }
    const trimmed = username === null ? "" : username.trim()
    if (trimmed === "") {
        // clear; nothing to do when already unlinked
        if (record.github_user_id === null && record.github_username === null) {
            return false
        }
        if (authorized) {
            // an authorized link (reachable here only by an elevated admin) has its repository access revoked
            // before the binding is cleared, so a collaborator grant is never left orphaned
            await deleteGithubLink(ctx, id)
        } else {
            await updateContributorPartial(ctx, id, { github_username: null, github_user_id: null }, true)
        }
        return true
    }
    // set/replace; a username identical to the stored login is a no-op (avoids a needless GitHub round-trip)
    if (record.github_username === trimmed) {
        return false
    }
    try {
        await _bindGithubUsername(ctx, id, trimmed)
    } catch (error) {
        // binding rejections (unknown user, already linked to another contributor, invalid format) are
        // client errors; surface them as a 400 carrying the specific reason
        throw new GithubLinkageError(error instanceof Error ? error.message : String(error), 400)
    }
    return true
}
