/**
 * lib/api/authorize.ts
 *
 * Accepts a BaseIdentity object from authenticate.ts and provides authorization information
 * Validates an Identity object for a given scope
 * Provides basic authorization primitives for Identity objects, such as verifying role permissions and admin status
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

import { env } from "cloudflare:workers"
import { getRecordSpecificProp, CONTRIBUTOR, recordTypeAssertComplete } from "./d1.ts"

/**
 * The available roles and their permissions defined in lib/api/authorize.ts
 *
 */
export const roles: Record<string, RoleProfile> = {
    reviewer: {
        overrides_lockout: true,
        lockout_ignore_admin: true,
        user_activation: false,
        user_addition: false,
        conferrable: true,
        cms_editor: false,
        github_link: false
    },
    userenroll: {
        overrides_lockout: false,
        lockout_ignore_admin: false,
        user_activation: true,
        user_addition: true,
        conferrable: false,
        cms_editor: false,
        github_link: false
    },
    siteeditor: {
        overrides_lockout: false,
        lockout_ignore_admin: false,
        user_activation: false,
        user_addition: false,
        conferrable: false,
        cms_editor: true,
        github_link: true
    }
}

/**
 * The canonical list of permission keys, mirroring the boolean fields of RoleProfile. It is the base for
 * aggregating an identity's permissions (every key starts false before each held role's grants are OR-ed
 * in) and exists because RoleProfile, being a type, has no runtime key list. The `satisfies` clause
 * rejects a typo'd or non-permission key here, and the compile-time guard below rejects forgetting a key,
 * so this stays in lockstep with RoleProfile.
 */
const PERMISSION_KEYS = [
    "overrides_lockout",
    "lockout_ignore_admin",
    "user_activation",
    "user_addition",
    "conferrable",
    "cms_editor",
    "github_link"
] as const satisfies readonly (keyof RoleProfile)[]

// compile-time exhaustiveness guard: if a permission is added to RoleProfile without being listed in
// PERMISSION_KEYS, the conditional resolves to `false` and this type fails its `extends true` constraint
type _Assert<T extends true> = T
type _PermissionKeysExhaustive = _Assert<keyof RoleProfile extends (typeof PERMISSION_KEYS)[number] ? true : false>

/**
 * Filters a list of role names down to those defined in {@link roles}. This is the server-side guard
 * applied on every write to the contributor roles column (see usermgmt setRoles/assignRole): only known
 * roles are ever persisted, which keeps stale or malicious role strings out of storage and bounds the
 * role iteration in {@link permissionsFromRoles} to the defined role set. Input order and duplicates are
 * preserved.
 *
 * @param role_names - the candidate role names
 * @returns the subset of role_names that are defined roles
 */
export function filterValidRoles(role_names: string[]): string[] {
    return role_names.filter((name) => name in roles)
}

/**
 * Aggregates the permission set granted by a list of role names: the union (logical OR) across the
 * RoleProfile of every *valid* role in the list. An unknown role string (stale/legacy data) carries no
 * profile and contributes nothing; the write path filters these out (see {@link filterValidRoles}), so
 * this is a second line of defense. The returned object always carries every permission key, defaulting
 * to false when no held role grants it.
 *
 * @param role_names - the identity's role names
 * @returns the flattened Permissions set
 */
export function permissionsFromRoles(role_names: string[]): IdentityPermissions {
    // start with every permission false, then OR in each valid role's grants
    const permissions = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, false])) as {
        -readonly [K in keyof RoleProfile]: boolean
    }
    for (const name of role_names) {
        const profile = roles[name]
        // unknown roles confer nothing; only defined roles contribute permissions
        if (!profile) continue
        for (const key of PERMISSION_KEYS) {
            if (profile[key]) permissions[key] = true
        }
    }
    return permissions
}

/**
 * The identity-record cache TTL, in milliseconds, is sourced from the `IDENTITY_CACHE_TTL_MS` wrangler var.
 * The contributor record backing an Identity is read on every authenticated request (the identity
 * middleware authorizes before the endpoint runs), so caching it for a short window collapses repeated
 * reads from the same caller to a single D1 query. The window is deliberately small: it is the upper bound
 * on how long an authorization change (a role/admin/active edit, or a deactivation) can take to take
 * effect, so it is kept to seconds rather than minutes.
 *
 * Per-isolate cache of contributor records keyed by (lowercased) identity email. There is no cross-isolate
 * invalidation, so `env.IDENTITY_CACHE_TTL_MS` is the only bound on staleness; the email key derives from
 * a verified Access JWT, so its cardinality is bounded by the org's enrolled users.
 */
const _identityCache = new Map<string, { record: D1Contributor | null; expires: number }>()

/**
 * Drops every entry from the per-isolate identity cache. Called by the data layer when a contributor
 * record is written (see database.ts `_exec_wrap`): a contributor mutation can change an entry's
 * authorization-relevant fields (roles/admin/active) or remap an identity_email, and the cache is keyed
 * by email — not by the contributor id a write carries — so it cannot be evicted per row. Contributor
 * writes are rare relative to the authenticated reads this cache serves and the map is bounded by the
 * org's enrolled users, so clearing it wholesale is cheap; the cleared entries simply re-read from D1 on
 * their next request. Invalidation is per-isolate only (like the cache itself), so a write in one isolate
 * does not evict another's copy — `env.IDENTITY_CACHE_TTL_MS` remains the cross-isolate staleness bound.
 */
export function invalidateIdentityCache(): void {
    _identityCache.clear()
}

/**
 * Returns the contributor record associated with the BaseIdentity, or null if no such record exists
 *
 * The lookup is the most frequent D1 read in the system, so a confirmed result (a found record or a
 * confirmed-absent one) is cached per isolate for `env.IDENTITY_CACHE_TTL_MS`. A thrown D1 error is left
 * uncached so a transient failure is retried on the next request rather than pinned (as not-enrolled) for
 * the whole TTL.
 *
 * @param identity - the BaseIdentity object to find a matching contributor record for
 * @returns - a promise that resolves to the matching contributor record, or null if no match is found
 *
 */
async function _getIdentityRecord(identity: BaseIdentity): Promise<D1Contributor | null> {
    // returns the contributor record whose identity email aligns with the BaseIdentity email;
    // normalize to lowercase to match how identity_email is stored (Cloudflare Access is
    // case-insensitive). The email is already lowercased at JWT extraction, so this is defensive
    // against any other path that constructs a BaseIdentity.
    const identity_email = identity.email.toLowerCase()
    const now = Date.now()
    const cached = _identityCache.get(identity_email)
    if (cached !== undefined && cached.expires > now) {
        return cached.record
    }
    try {
        const response = await getRecordSpecificProp(CONTRIBUTOR, "identity_email", identity_email)
        if (!response.success) {
            // an unsuccessful (but non-throwing) response is treated as no match and left uncached
            return null
        }
        const record =
            response.results.length === 0
                ? null
                : (recordTypeAssertComplete(
                      CONTRIBUTOR,
                      response.results[0] as Record<string, string | number | null>
                  ) as D1Contributor)
        _identityCache.set(identity_email, { record, expires: now + Number(env.IDENTITY_CACHE_TTL_MS) })
        return record
    } catch (error) {
        return null
    }
}

/**
 * Using a BaseIdentity from authenticate.ts and a contributor record from d1.ts, constructs an authorization record
 *
 * @param identity - the BaseIdentity object to construct from
 * @param record - the D1Contributor record to construct from, or null if no such record exists
 * @returns - the constructed Identity object
 */
function buildIdentity(identity: BaseIdentity, record: D1Contributor | null): Identity {
    // builds an Identity object from a BaseIdentity and a D1Contributor record
    // there is no validation of identity or record, so this function is not exposed
    const allowed = record !== null
    const enrollable = record === null && env.API_USER_SELFENROLL // provides method 2 enrollment directly; method 1 is accomplished in the enrollment flow
    const active = record ? record.active === 1 : false
    // an empty roles column ("") splits to [""], which is not a valid role and breaks role lookups; filter blanks so a roleless user is [] not [""]
    const roles = record
        ? record.roles
              .split(",")
              .map((r: string) => r.trim())
              .filter((r: string) => r.length > 0)
        : []
    const id = record ? record.contributor_id : -1
    const admin = record ? record.admin === 1 : false
    const user_info: UserInfo = {
        name: record ? record.name : "",
        // the tags and phases columns are nullable; a null column yields an empty list in the identity summary
        tags: record && record.tags ? record.tags.split(",").map((t: string) => t.trim()) : [],
        phases:
            record && record.phases
                ? record.phases
                      .split(",")
                      .map((p: string) => parseInt(p.trim()))
                      .filter((p: number) => !isNaN(p))
                : [],
        entry_date: record ? record.entry_date : "",
        // the remaining non-authorization profile fields are stashed here so self-service flows can read
        // the acting user's own record straight from the identity rather than issuing a second lookup
        // (authorization state — roles/admin/active/id and the sign-in identity_email — is excluded; it
        // lives on the Identity proper). Nullable columns default to null, change_date to "" when no record.
        class_year: record ? record.class_year : null,
        major: record ? record.major : null,
        bio: record ? record.bio : null,
        public_email: record ? record.public_email : null,
        image: record ? record.image : null,
        change_date: record ? record.change_date : "",
        ok: record !== null
    }
    return {
        ...identity,
        allowed: allowed,
        enrollable: enrollable,
        active: active,
        roles: roles,
        id: id,
        admin: admin,
        userinfo: user_info,
        // flatten the held roles into their aggregate permission set once, here, so downstream access
        // screening reads a single precomputed set. Iteration is bounded to the stored roles, which the
        // write path filters to defined roles (see filterValidRoles); unknown roles confer nothing.
        permissions: permissionsFromRoles(roles)
    }
}

/**
 * Constructs an Identity object with authorization info from a BaseIdentity
 *
 * @param identity - the BaseIdentity object to construct from
 * @returns - a promise that resolves to the constructed Identity object
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
 * @param permission - the permission to check for
 * @param identity - the Identity object to check permissions for
 * @return - true if the identity has the required permission, false otherwise
 *
 */
export function requires(permission: keyof RoleProfile, identity: Identity): boolean {
    // delegates to requiresOneOf so all role lookups share one (unknown-role-safe) implementation
    return requiresOneOf([permission], identity, false)
}

/**
 * Checks if a given identity has at least one of the required permissions based on their assigned roles
 * @param permissions - the permissions to check for
 * @param identity - the Identity object to check permissions for
 * @return - true if the identity has at least one of the required permissions, false otherwise
 */
export function requiresOneOf(
    permissions: (keyof RoleProfile)[],
    identity: Identity,
    fail_closed: boolean = true
): boolean {
    return _requiresMatch(permissions, identity, fail_closed, "some")
}

/**
 * Checks if a given identity has all of the required permissions based on their assigned roles
 * @param permissions - the permissions to check for
 * @param identity - the Identity object to check permissions for
 * @return - true if the identity has all of the required permissions, false otherwise
 */
export function requiresAllOf(
    permissions: (keyof RoleProfile)[],
    identity: Identity,
    fail_closed: boolean = true
): boolean {
    return _requiresMatch(permissions, identity, fail_closed, "every")
}

/**
 * Shared role/permission check for {@link requiresOneOf} and {@link requiresAllOf}. With an empty
 * permission set the result depends on fail_closed (admins only when closed, everyone when open).
 * Otherwise the identity passes if at least one of its roles satisfies the permissions under `match`:
 * "some" requires any one permission, "every" requires all of them within a single role.
 *
 * @param match - whether a role must grant some or every requested permission
 */
function _requiresMatch(
    permissions: (keyof RoleProfile)[],
    identity: Identity,
    fail_closed: boolean,
    match: "some" | "every"
): boolean {
    if (permissions.length === 0) {
        if (fail_closed) return identity.admin
        else return true
    }
    const user_roles = identity.roles
    return user_roles.some((role) => {
        const profile = roles[role]
        // an unknown role string (stale/typo data) has no profile; treat it as granting nothing rather than throwing
        if (!profile) return false
        return permissions[match]((permission) => profile[permission] === true)
    })
}

/**
 * Returns a list of conferrable roles that the given identity can confer to other users
 * @param identity - the Identity object to check conferrable roles for
 * @return - a list of conferrable roles that the identity can confer to other users
 */
export function conferFrom(identity: Identity): string[] {
    // an admin check is not performed since the case where an admin wants to confer all roles is an edge case that isn't too important to ease
    return identity.roles.filter((value) => {
        if (!(value in roles)) {
            return false
        }
        return roles[value].conferrable
    })
}

/**
 * Implements the contribution edit lockout
 *
 * @param record - the composition record to compare against
 * @param identity - the Identity object to review, assumed to be valid
 * @param use_admin - whether to allow review of admin status
 * @returns - whether the user is allowed to modify the record
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
 * @param record - the current database record to compare against
 * @param new_record - the new proposed record in API format, which may be partial
 * @param acting_identity - the identity of the acting user
 * @param use_admin - whether to allow review of admin status
 * @returns - whether the user is allowed to perform the modification as-is
 *
 */
export function canAct(
    record: CompositionRecord,
    new_record: Partial<Composition>,
    acting_identity: Identity,
    use_admin: boolean = true
) {
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

    if (
        (record.contrib_primary_1 !== new_record?.contrib_primary_1 && "contrib_primary_1" in new_record) ||
        (record.contrib_primary_2 !== new_record?.contrib_primary_2 && "contrib_primary_2" in new_record)
    ) {
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
 * @param record - the current database record
 * @param new_record - the proposed (possibly partial) update in API format
 * @param self - the acting user's contributor id
 * @returns - true if the update touches a protected (defined, non-self) primary slot
 */
function modifiesProtectedPrimary(record: CompositionRecord, new_record: Partial<Composition>, self: number): boolean {
    const slots: ("contrib_primary_1" | "contrib_primary_2")[] = ["contrib_primary_1", "contrib_primary_2"]
    return slots.some((slot) => {
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
 * @param id - the identity's contributor id
 * @returns - true if the id is a valid (asserted) contributor id, false otherwise
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
 * @param record - the proposed composition record
 * @param acting_identity - the identity of the acting user, assumed to be valid
 * @param use_admin - whether to allow review of admin status
 * @returns - whether the user is allowed to create the proposed record
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
 * @param current - the current database record
 * @param proposed - the proposed (possibly partial) update in API format
 * @param acting_identity - the identity of the acting user
 * @returns - the updated contrib_addl list, or null if no change is needed
 */
export function withActingContributor(
    current: CompositionRecord,
    proposed: Partial<Composition>,
    acting_identity: Identity
): number[] | null {
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
    const base =
        "contrib_addl" in proposed && Array.isArray(proposed.contrib_addl)
            ? proposed.contrib_addl
            : current.contrib_addl
    if (base.includes(self)) {
        // the editor is already recorded as an additional contributor
        return null
    }
    return [...base, self]
}
