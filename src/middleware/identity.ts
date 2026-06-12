/**
 * src/middleware/identity.ts
 * 
 * Supplies a middleware function to determine if authentication and authorization is necessary, and if so, performs said authorization and adds it to context.locals
 * 
 */

import { env } from "cloudflare:workers"
import type { MiddlewareHandler } from "astro"
import { middlewareErrorResponder } from "../lib/api/http"
import { parseJWT, retrieveCredential } from "../lib/api/authenticate"
import { authEnabled } from "../lib/api/environment"
import authorize, { requires } from "../lib/api/authorize"


const comment_401 = "You have not provided valid credentials to access this resource. Please log in and try again."
const comment_403 = "Your user account is not authorized to access this resource."


/**
 * The authorization a caller must satisfy to view an admin page. The requirement is met if the
 * caller is an administrator (when admin is permitted) OR is active and holds one of the listed
 * role permissions. admin is checked without requiring active, mirroring the API's policy that an
 * inactive administrator retains full authorization (see auth_check).
 */
interface AdminPageRequirement {
    /** whether an administrator satisfies this requirement */
    admin: boolean
    /** role permissions, any one of which satisfies this requirement for an active caller */
    roles: (keyof RoleProfile)[]
}

/**
 * A node in the admin page structure. A node may carry a requirement (gating itself and, by
 * default, its descendants) and/or a map of child path segments to further nodes.
 */
interface AdminPageNode {
    /** authorization needed for this page; descendants inherit it unless they override it. Omitted means open. */
    requirement?: AdminPageRequirement
    /** nested admin pages keyed by their path segment */
    children?: Record<string, AdminPageNode>
}

/**
 * Declarative map of the admin page structure to its page-level authorization requirements
 * (defense in depth; every /api/* endpoint still enforces its own authorization). Keyed by the
 * path segment following /admin. Pages with no requirement on their path — the navigation shell,
 * the per-entity CRUD pages, and the self-service pages (iam/whoami, advanced/selfenroll) — are
 * open, since they expose no privileged data server-side and their actions are gated at the API.
 *
 * Keep this in sync with the pages under src/pages/admin; unlisted pages under a gated section
 * inherit that section's requirement (fail closed), and unlisted pages elsewhere are open.
 */
const ADMIN_PAGE_STRUCTURE: Record<string, AdminPageNode> = {
    // all site management is administrator-only
    site: { requirement: { admin: true, roles: [] } },
    advanced: {
        children: {
            command: { requirement: { admin: true, roles: [] } },
            elevate: { requirement: { admin: true, roles: [] } },
            demote: { requirement: { admin: true, roles: [] } },
            // selfenroll: open (no requirement) — intended for not-yet-enrolled callers
        },
    },
    iam: {
        children: {
            // editing roles/admin status maps to PATCH /api/v1/identity, which requires admin
            edit: { requirement: { admin: true, roles: [] } },
            // listing/adding/removing users maps to endpoints requiring the user_addition permission
            add: { requirement: { admin: true, roles: ["user_addition"] } },
            list: { requirement: { admin: true, roles: ["user_addition"] } },
            remove: { requirement: { admin: true, roles: ["user_addition"] } },
            // whoami: open (no requirement) — shows the caller their own authorization info
        },
    },
}

/**
 * Walks ADMIN_PAGE_STRUCTURE along the request path, reads the authorization requirement that
 * applies to the resolved page, and checks the identity against it.
 *
 * @param {string[]} path_components - the non-empty path segments of the request URL
 * @param {Identity} identity - the constructed identity for the caller
 * @returns {boolean} true if the caller may view the page, false if it should be rejected with 403
 */
function adminPageAuthorized(path_components: string[], identity: Identity): boolean {
    if (path_components[0] !== "admin") {
        return true
    }
    // follow the structure along the path, tracking the most specific requirement encountered;
    // an unlisted segment stops the walk but keeps the inherited requirement (fail closed)
    let children: Record<string, AdminPageNode> | undefined = ADMIN_PAGE_STRUCTURE
    let requirement: AdminPageRequirement | undefined = undefined
    for (let i = 1; i < path_components.length; i++) {
        const node: AdminPageNode | undefined = children?.[path_components[i]]
        if (node === undefined) {
            break
        }
        if (node.requirement !== undefined) {
            requirement = node.requirement
        }
        children = node.children
    }
    if (requirement === undefined) {
        // the path resolves to no gated page; open by default
        return true
    }
    // an administrator satisfies the requirement when admin access is permitted
    if (requirement.admin && identity.admin) {
        return true
    }
    // otherwise an active caller holding one of the accepted role permissions satisfies it
    if (identity.active && requirement.roles.some(role => requires(role, identity))) {
        return true
    }
    return false
}


export const identity: MiddlewareHandler = async (context, next) => {
    // determine if the request path requires authentication and authorization
    const url = new URL(context.request.url)
    const path_components = url.pathname.split("/").filter(component => component.length > 0)
    
    /**
     * Protected paths are as follows:
     * 
     * /api/* - all API routes require authentication and authorization
     * /admin/* - all admin routes require authentication and authorization
     * /admin$ - the admin index page also requires authentication and authorization
     * 
     * (/api will error out as 404)
     */

    if (path_components.length > 0 && (path_components[0] === "api" || path_components[0] === "admin")) {
        // the request path requires authentication and authorization

        // on local development (development build served from localhost/127.0.0.1),
        // authentication and authorization are bypassed entirely; in all other
        // environments, the identity authentication and authorization process proceeds as normal
        if (!authEnabled(context.request)) {
            return next()
        }

        // retrieve the credential and perform JWT validation
        const credential_data = await retrieveCredential(context.request)
        if (credential_data === null) {
            // no credential, unauthorized
            return middlewareErrorResponder(context.request, 401, comment_401)
        }

        const validation: BaseIdentity | null | undefined = await parseJWT(credential_data[1], env.CF_ACCESS_AUD)
        if (validation === undefined) {
            // no credential provided, unauthorized
            return middlewareErrorResponder(context.request, 401, comment_401)
        }
        if (validation === null) {
            // credential invalid, unauthorized
            return middlewareErrorResponder(context.request, 401, comment_401)
        }
        // credential is authenticated, construct the identity information
        const constructed_identity: Identity = await authorize(validation)
        // verify the credential can be used, or is unusable but enrollable
        if (!constructed_identity.allowed) {
            // no Contributor record exists conveying authorization information
            if (!constructed_identity.enrollable) {
                // credential is inactive and not enrollable, so reject
                return middlewareErrorResponder(context.request, 403, comment_403)
            }
            // enrollable credentials must be permissionless; verify it is
            if (constructed_identity.roles.length != 0 || constructed_identity.admin || constructed_identity.active) {
                // enrollable credential has permissions, which should be impossible, so reject
                return middlewareErrorResponder(context.request, 403, comment_403)
            }
            // credential is enrollable and permissionless, so can be set
        } else if (constructed_identity.allowed && constructed_identity.enrollable) {
            // also impossible - a credential cannot be both allowed and enrollable
            return middlewareErrorResponder(context.request, 403, comment_403)
        }
        // credential is useable, so set to locals
        context.locals.identity = constructed_identity
        // NO CHECK HAS BEEN MADE ON WHETHER THE CREDENTIAL IS ACTIVE
        // page-level authorization for the admin UI (API routes enforce their own checks downstream)
        if (!adminPageAuthorized(path_components, constructed_identity)) {
            return middlewareErrorResponder(context.request, 403, comment_403)
        }
        return next()
    }
    // path does not require authentication and authorization
    return next()
}