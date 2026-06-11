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
import authorize from "../lib/api/authorize"


const comment_401 = "You have not provided valid credentials to access this resource. Please log in and try again."
const comment_403 = "Your user account is not authorized to access this resource."


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

        // on local development, authentication and authorization are bypassed if:
        // 1. authentication is manually disabled,
        // 2. the request origin is localhost, and
        // 3. Astro indicates that the environment is not production
        // if any are false, the identity authentication and authorization process proceeds as normal
        if (!env.AUTH_ENABLED && url.hostname === "localhost" && !import.meta.env.PROD) {
            return next()
        }

        // retrieve the credential and perform JWT validation
        const credential_data = await retrieveCredential(context.request)
        if (credential_data === null) {
            // no credential, unauthorized
            return middlewareErrorResponder(context.request, 401, comment_401)
        }

        // check if auth is enabled
        if (!env.AUTH_ENABLED && import.meta.env.PROD) {
            // authentication is disabled in vars, but the environment is production
            return middlewareErrorResponder(context.request, 503, "Authentication is currently unavailable. Please try again later.")
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
        return next()
    }
    // path does not require authentication and authorization
    return next()
}