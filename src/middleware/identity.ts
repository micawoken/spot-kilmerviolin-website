/**
 * middleware/identity.ts
 *
 * Supplies a middleware function to determine if authentication and authorization
 * is necessary, and if so, performs said authorization and adds it to context.locals
 *
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This file is part of the spot-kilmerviolin-website program, available at
 * https://github.com/micawoken/spot-kilmerviolin-website.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
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

import { env } from "cloudflare:workers"
import type { MiddlewareHandler } from "astro"
import { middlewareErrorResponder, failsCsrfOriginCheck } from "../lib/api/http"
import { isServiceTokenJWT, parseJWT, retrieveCredential } from "../lib/api/authenticate"
import { authEnabled, detectEnvironment } from "../lib/api/environment"
import authorize from "../lib/api/authorize"
import { isFallbackEmail } from "../lib/api/fallback"
import { type AdminAccess, satisfiesAccess, comment_401, comment_403 } from "../lib/api/page_auth"
import { resolveApiTokenIdentity, verifyBuildToken, buildTokenRouteAllowed } from "../lib/api/tokens"
import { isEmdashApiToken, isEmdashServiceRequest } from "../lib/api/emdash_service_access"

/**
 * A node in the admin page structure
 */
interface AdminPageNode {
    /** authorization needed for this page; descendants inherit it unless they override it. */
    access?: AdminAccess
    /** nested admin pages keyed by their path segment */
    children?: Record<string, AdminPageNode>
}

/**
 * Declarative map of the admin page structure to its page-level authorization requirements
 */
export const ADMIN_PAGE_STRUCTURE: Record<string, AdminPageNode> = {
    advanced: {
        children: {
            // the database terminal maps to POST /api/v1/command, which requires admin
            command: { access: { kind: "admin" } },
            // the self-enrollment flow must be reachable by a not-yet-enrolled (inactive) caller
            selfenroll: { access: { kind: "any" } },
            // the visual-compositor pages
            designs: { access: { kind: "permission", permissions: ["design_editor"] } }
        }
    },
    user: {
        children: {
            // activation (PUT /api/v1/identity/activation) is delegated to the user_activation permission
            activate: { access: { kind: "permission", permissions: ["user_activation"] } },
            // deactivation (DELETE /api/v1/identity/activation) remains admin-only
            deactivate: { access: { kind: "admin" } },
            // promotion/demotion (PUT/DELETE /api/v1/identity/admin) require admin
            elevate: { access: { kind: "admin" } },
            demote: { access: { kind: "admin" } },
            // user-scoped API tokens are self-service; build tokens require admin
            tokens: { access: { kind: "active" }, children: { build: { access: { kind: "admin" } } } }
        }
    },
    iam: {
        children: {
            // editing roles maps to PATCH/PUT /api/v1/identity/roles, which requires admin
            edit: { access: { kind: "admin" } },
            // changing another user's login email maps to PATCH /api/v1/identity/email, which requires admin
            email: { access: { kind: "admin" } },
            // listing/adding/removing users maps to endpoints requiring the user_addition permission
            add: { access: { kind: "permission", permissions: ["user_addition"] } },
            list: { access: { kind: "permission", permissions: ["user_addition"] } },
            remove: { access: { kind: "permission", permissions: ["user_addition"] } },
            // "my authorization info" shows the caller's own info; reachable while inactive
            whoami: { access: { kind: "any" } }
        }
    },
    site: {
        children: {
            // both trigger work that modifies the website's persisted public state
            rebuild: { access: { kind: "permission", permissions: ["rebuild"] } },
            purge_cache: { access: { kind: "permission", permissions: ["rebuild"] } }
        }
    },
    // the CSV bulk-import pages perform non-self assignment
    composers: { children: { import: { access: { kind: "admin" } } } },
    contributors: { children: { import: { access: { kind: "admin" } } } },
    works: { children: { import: { access: { kind: "admin" } } } },
    // the profile pages (view, edit, change sign-in email) are self-service
    profile: { access: { kind: "any" } },
    // site policy pages are always accessible
    "terms-of-use": { access: { kind: "any" } },
    "privacy-policy": { access: { kind: "any" } },
    "security-policy": { access: { kind: "any" } },
    license: { access: { kind: "any" } }
}

/**
 * Walks ADMIN_PAGE_STRUCTURE along the request path and resolves the access requirement for the page
 *
 *
 * @param {string[]} path_components - the non-empty path segments of the request URL
 * @returns {AdminAccess} the access requirement that applies to the resolved page
 */
export function adminPageAccess(path_components: string[]): AdminAccess {
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
    const path_components = url.pathname.split("/").filter((component) => component.length > 0)

    /**
     * Protected paths are as follows:
     *
     * /api/* - all API routes require authentication and authorization
     * /admin/* - all admin routes require authentication and authorization
     * /admin$ - the admin index page also requires authentication and authorization
     *
     * (/api will error out as 404)
     */

    if (path_components.length === 0) {
        // the root path does not require authentication and authorization
        return next()
    }

    // the app-authenticated surfaces (both 404'd on staging). /_emdash also needs an identity constructed
    // (see below) so middleware/emdash_access.ts can authorize it, on top of EmDash's own Cloudflare Access
    // adapter
    const isAppProtected = path_components[0] === "api" || path_components[0] === "admin"
    const isEmDash = path_components[0] === "_emdash"

    // staging serves only public-facing pages; the app admin UI, the API, and the EmDash CMS admin are
    // disabled there; respond 404 if it doesn't exist
    if ((isAppProtected || isEmDash) && detectEnvironment(context.request) === "staging") {
        return middlewareErrorResponder(context.request, 404, "This resource is not available on the staging preview.")
    }

    if (!isAppProtected && !isEmDash) {
        // the request path does not require app authentication or an identity (not api, not admin, not
        // _emdash)
        return next()
    }

    // the request path requires authentication, and identity construction. isEmDash paths only need
    // context.locals.identity populated below for the emdash_access middleware to authorize against - this
    // middleware performs no _emdash-specific authorization itself (see middleware/emdash_access.ts)

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

    if (isEmDash) {
        // The Auth-Header arm must confirm the token is shaped like an EmDash credential rather than
        // trusting the header's presence
        const isEmdashToken = credential_data[0] === "Auth-Header" && isEmdashApiToken(credential_data[1])
        if (isEmdashToken || (await isServiceTokenJWT(credential_data[1], env.CF_ACCESS_AUD))) {
            // Delegation is bounded by path, not open-ended
            if (!isEmdashServiceRequest(context.request.method, path_components.slice(1))) {
                return middlewareErrorResponder(context.request, 403, comment_403)
            }
            context.locals.emdashServiceAuth = true
            return next()
        }
    }

    // Programmatic /api/ access
    if (path_components[0] === "api" && (await isServiceTokenJWT(credential_data[1], env.CF_ACCESS_AUD))) {
        const apiToken = context.request.headers.get("X-Api-Token")
        const buildToken = context.request.headers.get("X-Build-Token")

        if (apiToken && buildToken) {
            // ambiguous credential: refuse rather than guess which token type applies
            return middlewareErrorResponder(context.request, 401, comment_401)
        }

        if (apiToken) {
            const outcome = await resolveApiTokenIdentity(apiToken, Date.now())
            if (outcome === null) {
                return middlewareErrorResponder(context.request, 401, comment_401)
            }
            // reuses the entire existing authorization pipeline verbatim
            context.locals.identity = outcome
            context.locals.tokenAuth = true
            return next()
        }

        if (buildToken) {
            if (!(await verifyBuildToken(buildToken, Date.now()))) {
                return middlewareErrorResponder(context.request, 401, comment_401)
            }
            // Default-deny, enforced here rather than per-endpoint
            if (!buildTokenRouteAllowed(context.request.method, path_components)) {
                return middlewareErrorResponder(context.request, 403, comment_403)
            }
            context.locals.buildTokenAuth = true
            return next()
        }

        // a verified service token with no recognized app-token header identifies nothing
        return middlewareErrorResponder(context.request, 401, comment_401)
    }
    // CSRF defense for the ambient cookie credential
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
    // they are rejected since they can't be used for sign-in
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
            return middlewareErrorResponder(context.request, 403, comment_403, constructed_identity.email)
        }
        // enrollable credentials must be permissionless; verify it is
        if (constructed_identity.roles.length !== 0 || constructed_identity.admin || constructed_identity.active) {
            // enrollable credential has permissions, which should be impossible, so reject
            return middlewareErrorResponder(context.request, 403, comment_403, constructed_identity.email)
        }
        // credential is enrollable and permissionless, so can be set
    } else if (constructed_identity.allowed && constructed_identity.enrollable) {
        // also impossible - a credential cannot be both allowed and enrollable
        return middlewareErrorResponder(context.request, 403, comment_403, constructed_identity.email)
    }
    // credential is useable, so set to locals
    context.locals.identity = constructed_identity
    // page-level authorization for the admin UI (API routes enforce their own checks downstream)
    if (path_components[0] === "admin" && !satisfiesAccess(adminPageAccess(path_components), constructed_identity)) {
        return middlewareErrorResponder(context.request, 403, comment_403, constructed_identity.email)
    }
    return next()
}
