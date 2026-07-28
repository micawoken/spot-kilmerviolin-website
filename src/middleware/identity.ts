/**
 * middleware/identity.ts
 *
 * Supplies a middleware function to determine if authentication and authorization is necessary, and if so, performs said authorization and adds it to context.locals
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
export const ADMIN_PAGE_STRUCTURE: Record<string, AdminPageNode> = {
    advanced: {
        children: {
            // the database terminal maps to POST /api/v1/command, which requires admin
            command: { access: { kind: "admin" } },
            // the self-enrollment flow must be reachable by a not-yet-enrolled (inactive) caller
            selfenroll: { access: { kind: "any" } },
            // the visual-compositor pages (design list, editor, templates, theme) are gated on
            // design_editor. They read and write EmDash design collections from the BROWSER, so this page
            // gate alone is not sufficient — the same permission also admits the caller to the design
            // system's /_emdash paths, and only those (emdash_access.ts). cms_editor is the superset and
            // is not required here.
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
            // user-scoped API tokens (plan-prelaunch-features.md §2) are self-service: any active,
            // enrolled contributor manages their own. Build tokens (§2 D9) are admin-only — they have no
            // owning contributor to self-manage.
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
            // "my authorization info" shows the caller their own info; reachable while inactive
            whoami: { access: { kind: "any" } }
        }
    },
    site: {
        children: {
            // both trigger work that re-materialises the site: a rebuild queues a billable Workers Build,
            // and a cache purge drops every subsequent read back to D1. Each page also carries its own
            // guardPage on the same permission — this entry makes the middleware refuse first.
            rebuild: { access: { kind: "permission", permissions: ["rebuild"] } },
            purge_cache: { access: { kind: "permission", permissions: ["rebuild"] } }
        }
    },
    // the CSV bulk-import pages perform non-self assignment (e.g. naming contributors on compositions) and
    // commit many records at once, so they are admin-only regardless of the underlying endpoint's default
    composers: { children: { import: { access: { kind: "admin" } } } },
    contributors: { children: { import: { access: { kind: "admin" } } } },
    works: { children: { import: { access: { kind: "admin" } } } },
    // the profile pages (view, edit, change sign-in email) are self-service and target only the caller's
    // own record, so they remain reachable by an inactive (but enrolled) caller
    profile: { access: { kind: "any" } },
    // site policy pages are always accessible
    "terms-of-use": { access: { kind: "any" } },
    "privacy-policy": { access: { kind: "any" } },
    "security-policy": { access: { kind: "any" } }
}

/**
 * Walks ADMIN_PAGE_STRUCTURE along the request path and resolves the access requirement for the page.
 *
 * The caller guarantees path_components[0] === "admin". The /admin index resolves to "any"; every other
 * page starts from the "active" default and is narrowed by the most specific node encountered. An
 * unlisted segment stops the walk but keeps the inherited requirement (fail closed).
 *
 * Exported for tests/admin-page-gating.test.ts, which binds this map to the on-disk page tree in both
 * directions — a page that moves without its entry, and an entry naming a page that no longer exists.
 * That is how the design pages silently lost their design_editor gate through a directory move.
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
    // adapter.
    const isAppProtected = path_components[0] === "api" || path_components[0] === "admin"
    const isEmDash = path_components[0] === "_emdash"

    // staging serves only public-facing pages; the app admin UI, the API, and the EmDash CMS admin are
    // disabled there. Respond 404 to hide their existence (staging needs no auth secrets as a result).
    if ((isAppProtected || isEmDash) && detectEnvironment(context.request) === "staging") {
        return middlewareErrorResponder(context.request, 404, "This resource is not available on the staging preview.")
    }

    if (!isAppProtected && !isEmDash) {
        // the request path does not require app authentication or an identity (not api, not admin, not
        // _emdash)
        return next()
    }

    // the request path requires authentication, and identity construction. isEmDash paths only need
    // context.locals.identity populated below for the emdash_access middleware to authorize against — this
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
    // Non-browser service credentials on /_emdash are delegated to EmDash's own auth layer instead of the
    // app identity flow, which cannot represent them (an EmDash API token is not an Access JWT, and an
    // Access service-token JWT carries no email): EmDash validates Bearer tokens itself (with per-token
    // scopes), and its Access adapter maps a service-token JWT to an EmDash role. The cms_editor gate in
    // middleware/emdash_access.ts targets browser sessions, which take the identity flow below: a browser's
    // CF_Authorization cookie holds a USER JWT (email present), which isServiceTokenJWT rejects, so the
    // credential slot is deliberately not consulted — Access injects a service-token JWT as BOTH the
    // Cf-Access-Jwt-Assertion header and a CF_Authorization cookie (observed on prod), and the cookie wins
    // retrieveCredential's priority. Skipping the cookie CSRF origin check here is safe for the same
    // reason: only a verified service-token JWT (never a user session) is delegated. Build-time reads
    // (lib/build/emdash-api.ts) and the design-collection setup tooling depend on this delegation.
    // The delegation is bounded on both axes — credential SHAPE and request PATH — because EmDash's own
    // gate does not cover the routes it publishes as anonymous (lib/api/emdash_service_access.ts).
    if (isEmDash) {
        // The Auth-Header arm must confirm the token is shaped like an EmDash credential rather than
        // trusting the header's presence: retrieveCredential returns "Auth-Header" for ANY `Bearer
        // <anything>`, and delegating on that alone let an unauthenticated caller past this gate entirely.
        const isEmdashToken = credential_data[0] === "Auth-Header" && isEmdashApiToken(credential_data[1])
        if (isEmdashToken || (await isServiceTokenJWT(credential_data[1], env.CF_ACCESS_AUD))) {
            // Delegation is bounded by path, not open-ended: EmDash checks isPublicEmDashRoute BEFORE its
            // bearer check, so its anonymous routes (setup, auth, oauth, comments, search) would never
            // reach a token check. Only the paths the build and setup tooling actually call are delegated.
            if (!isEmdashServiceRequest(context.request.method, path_components.slice(1))) {
                return middlewareErrorResponder(context.request, 403, comment_403)
            }
            context.locals.emdashServiceAuth = true
            return next()
        }
    }
    // Programmatic /api/ access (plan-prelaunch-features.md §2): a verified Access service-token JWT (no
    // user email, so the identity flow below cannot represent it) plus an app-issued token header. Access
    // remains the mandatory outer gate (D3) — a service token with neither header still gets nothing.
    // Token headers arrive deliberately, never ambient like the CF_Authorization cookie, so this branch is
    // correctly placed ahead of the cookie CSRF check below without needing that check itself.
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
            // reuses the entire existing authorization pipeline verbatim: downstream auth_check calls
            // cannot tell this identity apart from a cookie-authenticated one
            context.locals.identity = outcome
            context.locals.tokenAuth = true
            return next()
        }

        if (buildToken) {
            if (!(await verifyBuildToken(buildToken, Date.now()))) {
                return middlewareErrorResponder(context.request, 401, comment_401)
            }
            // Default-deny, enforced here rather than per-endpoint (D9): a build token resolves no
            // Identity at all, so it grants ONLY the three whitelisted full-list GETs. Centralizing the
            // whitelist in one fail-closed chokepoint (buildTokenRouteAllowed) means no individual
            // endpoint's auth_check can forget it — everything else 403s before a route handler runs.
            if (!buildTokenRouteAllowed(context.request.method, path_components)) {
                return middlewareErrorResponder(context.request, 403, comment_403)
            }
            context.locals.buildTokenAuth = true
            return next()
        }

        // a verified service token with no recognized app-token header identifies nothing
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
    // page-level authorization for the admin UI (API routes enforce their own checks downstream).
    // Active-state gating happens here via the resolved access requirement: most admin pages require
    // an active caller unless they are an administrator (see ADMIN_PAGE_STRUCTURE / satisfiesAccess).
    if (path_components[0] === "admin" && !satisfiesAccess(adminPageAccess(path_components), constructed_identity)) {
        return middlewareErrorResponder(context.request, 403, comment_403, constructed_identity.email)
    }
    return next()
}
