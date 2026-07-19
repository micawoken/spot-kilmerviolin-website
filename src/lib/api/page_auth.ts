/**
 * lib/api/page_auth.ts
 *
 * Authorization primitives used by the identity middleware to determine who can access a protected page
 *
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
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

import { authEnabled } from "./environment"
import { middlewareErrorResponder } from "./http"

export const comment_401 =
    "You have not provided valid credentials to access this resource. Please log in and try again."
export const comment_403 = "Your user account is not authorized to access this resource."

/**
 * The authorization an admin page requires. Administrators always satisfy every level (mirroring the
 * API's policy in auth_check, where an administrator with an allowable record keeps full authorization
 * even while inactive); the levels describe what a non-administrator must satisfy:
 *
 *  - "admin"      : administrators only.
 *  - "permission" : an active caller whose aggregate permissions include at least one of the listed
 *                   permissions (screening reads the precomputed identity.permissions set).
 *  - "active"     : any active caller (the default for the navigation shell and the per-entity CRUD pages,
 *                   which expose no privileged data beyond what an active contributor may already reach).
 *  - "any"        : any authenticated caller, including inactive and not-yet-enrolled ones. Reserved for the
 *                   self-service flows (self-enrollment, "my authorization info", and the profile pages) that
 *                   an inactive or enrollable user must still be able to reach.
 */
export type AdminAccess =
    | { kind: "admin" }
    | { kind: "permission"; permissions: (keyof RoleProfile)[] }
    | { kind: "active" }
    | { kind: "any" }

/**
 * Evaluates whether an identity satisfies an access requirement
 *
 * @param {AdminAccess} access - the requirement to check against
 * @param {Identity} identity - the constructed identity for the caller
 * @returns {boolean} true if the caller may proceed, false if it should be rejected with 403
 */
export function satisfiesAccess(access: AdminAccess, identity: Identity): boolean {
    // an administrator is always approved (an inactive administrator would still retain full authorization)
    if (identity.admin) {
        return true
    }
    switch (access.kind) {
        case "admin":
            return false
        case "permission":
            // an active caller whose aggregate permissions include one of the accepted permissions satisfies
            // the requirement (identity.permissions is precomputed from the caller's roles in authorize.ts)
            return identity.active && access.permissions.some((permission) => identity.permissions[permission])
        case "active":
            return identity.active
        case "any":
            return true
    }
}

/**
 * Authorization guard for SSR admin pages
 *
 * Returns an error response if not authorized; null if authorized
 *
 *
 * @param {Request} request - the page request, used for environment detection and the error response
 * @param {Identity | undefined} identity - the caller's identity from Astro.locals (undefined if unauthenticated)
 * @param {AdminAccess} access - the authorization the page requires for the data it reads
 * @returns {Response | null} an error Response to return, or null when the caller is authorized
 */
export function guardPage(request: Request, identity: Identity | undefined, access: AdminAccess): Response | null {
    // local development bypasses authentication entirely (no identity is constructed), matching the
    // identity middleware; never block a page in that environment
    if (!authEnabled(request)) {
        return null
    }
    if (identity === undefined) {
        // the middleware did not construct an identity, so the caller is unauthenticated
        return middlewareErrorResponder(request, 401, comment_401)
    }
    if (!satisfiesAccess(access, identity)) {
        return middlewareErrorResponder(request, 403, comment_403, identity.email)
    }
    return null
}
