/**
 * lib/api/page_auth.ts
 *
 * Shared page-level authorization model for the admin UI. The identity middleware uses it to gate
 * admin routes (defense in depth — every /api/* endpoint still enforces its own authorization), and
 * SSR admin pages use guardPage() to re-check authorization before reading privileged data directly
 * from the database (which bypasses the API entirely).
 *
 */

import { authEnabled, isActiveRequestDev } from "./environment"
import { requires } from "./authorize"
import { isMissingTableError, middlewareErrorResponder, missingTableErrorPage, devModeUnavailablePage } from "./http"

export const comment_401 = "You have not provided valid credentials to access this resource. Please log in and try again."
export const comment_403 = "Your user account is not authorized to access this resource."

/**
 * The authorization an admin page requires. Administrators always satisfy every level (mirroring the
 * API's policy in auth_check, where an administrator with an allowable record keeps full authorization
 * even while inactive); the levels describe what a non-administrator must satisfy:
 *
 *  - "admin"  : administrators only.
 *  - "role"   : an active caller holding at least one of the listed role permissions.
 *  - "active" : any active caller (the default for the navigation shell and the per-entity CRUD pages,
 *               which expose no privileged data beyond what an active contributor may already reach).
 *  - "any"    : any authenticated caller, including inactive and not-yet-enrolled ones. Reserved for the
 *               self-service flows (self-enrollment, "my authorization info", and the profile pages) that
 *               an inactive or enrollable user must still be able to reach.
 */
export type AdminAccess =
    | { kind: "admin" }
    | { kind: "role"; roles: (keyof RoleProfile)[] }
    | { kind: "active" }
    | { kind: "any" }

/**
 * Evaluates whether an identity satisfies an access requirement.
 *
 * @param {AdminAccess} access - the requirement to check against
 * @param {Identity} identity - the constructed identity for the caller
 * @returns {boolean} true if the caller may proceed, false if it should be rejected with 403
 */
export function satisfiesAccess(access: AdminAccess, identity: Identity): boolean {
    // an administrator satisfies every requirement (an inactive administrator retains full authorization)
    if (identity.admin) {
        return true
    }
    switch (access.kind) {
        case "admin":
            return false
        case "role":
            // an active caller holding one of the accepted role permissions satisfies the requirement
            return identity.active && access.roles.some(role => requires(role, identity))
        case "active":
            return identity.active
        case "any":
            return true
    }
}

/**
 * Authorization guard for SSR admin pages. Returns a ready-to-return error Response when the caller is
 * not authorized for the data the page is about to read, or null when the page may proceed. Mirrors the
 * middleware's environment handling: when authentication is disabled (local development) the page is
 * allowed through, matching the rest of the admin UI.
 *
 * Usage from an Astro page's frontmatter, before any database call:
 *   const denied = guardPage(Astro.request, Astro.locals.identity, { kind: "active" })
 *   if (denied) return denied
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
        return middlewareErrorResponder(request, 403, comment_403)
    }
    return null
}

/**
 * Wraps a server-side database read performed directly by an admin page. When the read fails because a
 * table critical to the operation does not exist, it resolves to the missing-table fallback page instead
 * of letting the error bubble up as an unhandled 500; any other error propagates unchanged.
 *
 * The caller distinguishes the two outcomes with an `instanceof Response` check: a Response is a
 * ready-to-return fallback page, while anything else is the read's resolved value.
 *
 * Usage from an Astro page's frontmatter:
 *   const composers = await guardedRead(() => listComposers(Astro.locals.cfContext))
 *   if (composers instanceof Response) return composers
 *
 * @param {() => Promise<T>} read - the database read to perform
 * @returns {Promise<T | Response>} the read's value, or the missing-table fallback page
 */
export async function guardedRead<T>(read: () => Promise<T>): Promise<T | Response> {
    try {
        return await read()
    } catch (error) {
        if (isMissingTableError(error)) {
            return missingTableErrorPage(error)
        }
        if (isActiveRequestDev()) {
            return devModeUnavailablePage()
        }
        console.log(error)
        throw error
    }
}
