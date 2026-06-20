/**
 * src/middleware/identity.ts
 * 
 * Supplies a middleware function to determine if authentication and authorization is necessary, and if so, performs said authorization and adds it to context.locals
 * 
 */

import { env } from "cloudflare:workers"
import type { MiddlewareHandler } from "astro"
import { middlewareErrorResponder, failsCsrfOriginCheck } from "../lib/api/http"
import { parseJWT, retrieveCredential } from "../lib/api/authenticate"
import { authEnabled, detectEnvironment } from "../lib/api/environment"
import authorize from "../lib/api/authorize"
import { isFallbackEmail } from "../lib/api/fallback"
import { type AdminAccess, satisfiesAccess, comment_401, comment_403 } from "../lib/api/page_auth"


/**
 * A node in the admin page structure. A node may carry an access requirement (gating itself and, by
 * default, its descendants) and/or a map of child path segments to further nodes.
 */
interface AdminPageNode {
    /** authorization needed for this page; descendants inherit it unless they override it. */
    access?: AdminAccess
    /** nested admin pages keyed by their path segment */
    children?: Record<string, AdminPageNode>
}

/**
 * Declarative map of the admin page structure to its page-level authorization requirements (defense in
 * depth; every /api/* endpoint still enforces its own authorization). Keyed by the path segment
 * following /admin.
 *
 * The /admin index defaults to "any" (the landing page exposes no privileged data and must stay
 * reachable so an inactive or not-yet-enrolled caller can navigate to the self-service flows), while
 * every other admin page defaults to "active": most pages must not be accessible to an inactive caller
 * unless they are an administrator. Pages an inactive/enrollable caller must still reach — the
 * self-enrollment flow, "my authorization info", and the profile pages — are explicitly marked "any".
 *
 * Keep this in sync with the pages under src/pages/admin; an unlisted page under a gated section
 * inherits that section's requirement (fail closed), and an unlisted page elsewhere falls back to the
 * "active" default.
 */
const ADMIN_PAGE_STRUCTURE: Record<string, AdminPageNode> = {
    advanced: {
        children: {
            // the database terminal maps to POST /api/v1/command, which requires admin
            command: { access: { kind: "admin" } },
            // the self-enrollment flow must be reachable by a not-yet-enrolled (inactive) caller
            selfenroll: { access: { kind: "any" } },
        },
    },
    user: {
        children: {
            // activation (PUT /api/v1/identity/activation) is delegated to the user_activation permission
            activate: { access: { kind: "role", roles: ["user_activation"] } },
            // deactivation (DELETE /api/v1/identity/activation) remains admin-only
            deactivate: { access: { kind: "admin" } },
            // promotion/demotion (PUT/DELETE /api/v1/identity/admin) require admin
            elevate: { access: { kind: "admin" } },
            demote: { access: { kind: "admin" } },
        },
    },
    iam: {
        children: {
            // editing roles maps to PATCH/PUT /api/v1/identity/roles, which requires admin
            edit: { access: { kind: "admin" } },
            // changing another user's login email maps to PATCH /api/v1/identity/email, which requires admin
            email: { access: { kind: "admin" } },
            // listing/adding/removing users maps to endpoints requiring the user_addition permission
            add: { access: { kind: "role", roles: ["user_addition"] } },
            list: { access: { kind: "role", roles: ["user_addition"] } },
            remove: { access: { kind: "role", roles: ["user_addition"] } },
            // "my authorization info" shows the caller their own info; reachable while inactive
            whoami: { access: { kind: "any" } },
        },
    },
    // the profile pages (view, edit, change sign-in email) are self-service and target only the caller's
    // own record, so they remain reachable by an inactive (but enrolled) caller
    profile: { access: { kind: "any" } },
}

/**
 * Walks ADMIN_PAGE_STRUCTURE along the request path and resolves the access requirement for the page.
 *
 * The caller guarantees path_components[0] === "admin". The /admin index resolves to "any"; every other
 * page starts from the "active" default and is narrowed by the most specific node encountered. An
 * unlisted segment stops the walk but keeps the inherited requirement (fail closed).
 *
 * @param {string[]} path_components - the non-empty path segments of the request URL
 * @returns {AdminAccess} the access requirement that applies to the resolved page
 */
function adminPageAccess(path_components: string[]): AdminAccess {
    let access: AdminAccess = path_components.length === 1 ? { kind: "any" } : { kind: "active" }
    let children: Record<string, AdminPageNode> | undefined = ADMIN_PAGE_STRUCTURE
    for (let i = 1; i < path_components.length; i++) {
        const node: AdminPageNode | undefined = children?.[path_components[i]]
        if (node === undefined) {
            break
        }
        if (node.access !== undefined) {
            access = node.access
        }
        children = node.children
    }
    return access
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
        // staging serves only public-facing pages; the admin UI and the API are disabled there.
        // Respond 404 to hide their existence (staging needs no auth secrets as a result).
        if (detectEnvironment(context.request) === "staging") {
            return middlewareErrorResponder(context.request, 404, "This resource is not available on the staging preview.")
        }

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
        // CSRF defense for the ambient cookie credential: the CF_Authorization cookie is attached by the
        // browser to any request to this origin, so a cookie-authenticated state-changing request must
        // prove a same-origin initiator (see failsCsrfOriginCheck). Header/Bearer credentials are not
        // ambient — a cross-site page cannot set those headers — so they are exempt. The app's own admin
        // UI issues same-origin calls whose Origin is allowlisted, so legitimate writes are unaffected.
        if (credential_data[0] === "cookie" && failsCsrfOriginCheck(context.request)) {
            return middlewareErrorResponder(context.request, 403, "Cross-origin request rejected.")
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
        // fallback identity emails are reserved placeholders for contributors with no real sign-in email
        // (see lib/api/fallback.ts); refuse to construct an identity for one so it can never authenticate,
        // even if such an address somehow appears in Access
        if (isFallbackEmail(validation.email)) {
            return middlewareErrorResponder(context.request, 403, comment_403)
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
        // page-level authorization for the admin UI (API routes enforce their own checks downstream).
        // Active-state gating happens here via the resolved access requirement: most admin pages require
        // an active caller unless they are an administrator (see ADMIN_PAGE_STRUCTURE / satisfiesAccess).
        if (path_components[0] === "admin" && !satisfiesAccess(adminPageAccess(path_components), constructed_identity)) {
            return middlewareErrorResponder(context.request, 403, comment_403)
        }
        return next()
    }
    // path does not require authentication and authorization
    return next()
}