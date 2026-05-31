/**
 * src/middleware/identity.ts
 * 
 * Supplies a middleware function to determine if authentication and authorization is necessary, and if so, performs said authorization and adds it to context.locals
 * 
 */

import { env } from "cloudflare:workers"
import type { MiddlewareHandler } from "astro"
import { parseJWT, retrieveCredential } from "../lib/api/authenticate"
import authorize from "../lib/api/authorize"

const error_http = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <link rel="icon" href="/favicon.ico" type="image/x-icon">
    <link rel="stylesheet" href="/style.css">
    <title>{errorCode} {errorName}</title>
</head>
<body>
    <div class="global">
        <h1 class="title">{errorCode} {errorName}</h1>
    </div>
    <div class="global body">
        <p>{errorDescription}</p>
        <p>Please do not repeat this request.</p>
    </div>
    <div class="global body">
        <p><a href="javascript:history.back()">Back</a> | <a href="/">Home</a></p>
    </div>
    <div class="global body">
        <p>Need to report a security concern? Contact the webmaster at <a href="mailto:contact@michaelwongmusic.com">contact@michaelwongmusic.com</a>.</p>
    </div>
</body>
</html>`


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
            return new Response(error_http.replaceAll("{errorCode}", "401")
                    .replaceAll("{errorName}", "Unauthorized")
                    .replaceAll("{errorDescription}", "You have not provided valid authentication credentials."),
                {
                    status: 401,
                    statusText: "Unauthorized",
                    headers: {
                        "Content-Type": "text/html"
                    }
                }
            )
        }
        const validation: BaseIdentity | null | undefined = await parseJWT(credential_data[1], env.CF_ACCESS_AUD)
        if (validation === undefined) {
            // no credential provided, unauthorized
            return new Response(error_http.replaceAll("{errorCode}", "401")
                    .replaceAll("{errorName}", "Unauthorized")
                    .replaceAll("{errorDescription}", "You have not provided valid authentication credentials."),
                {
                    status: 401,
                    statusText: "Unauthorized",
                    headers: {
                        "Content-Type": "text/html"
                    }
                }
            )
        }
        if (validation === null) {
            // credential invalid, unauthorized
            return new Response(error_http.replaceAll("{errorCode}", "401")
                    .replaceAll("{errorName}", "Unauthorized")
                    .replaceAll("{errorDescription}", "You have not provided valid authentication credentials."),
                {
                    status: 401,
                    statusText: "Unauthorized",
                    headers: {
                        "Content-Type": "text/html"
                    }
                }
            )
        }
        // credential is authenticated, construct the identity information
        const constructed_identity: Identity = await authorize(validation)
        // verify the credential can be used, or is unusable but enrollable
        if (!constructed_identity.allowed) {
            if (!constructed_identity.enrollable) {
                // credential is inactive and not enrollable, so reject
                return new Response(error_http.replaceAll("{errorCode}", "403")
                        .replaceAll("{errorName}", "Forbidden")
                        .replaceAll("{errorDescription}", "Your user account is not authorized to access this resource."),
                    {
                        status: 403,
                        statusText: "Forbidden",
                        headers: {
                            "Content-Type": "text/html"
                        }
                    }
                )
            }
            // enrollable credentials must be permissionless; verify it is
            if (constructed_identity.roles.length != 0 || constructed_identity.admin || constructed_identity.active) {
                // enrollable credential has permissions, which should be impossible, so reject
                return new Response(error_http.replaceAll("{errorCode}", "403")
                        .replaceAll("{errorName}", "Forbidden")
                        .replaceAll("{errorDescription}", "Your user account is not authorized to access this resource."),
                    {
                        status: 403,
                        statusText: "Forbidden",
                        headers: {
                            "Content-Type": "text/html"
                        }
                    }
                )
            }
            // credential is enrollable and permissionless, so can be set
        } else if (constructed_identity.allowed && constructed_identity.enrollable) {
            // also impossible - a credential cannot be both allowed and enrollable
            return new Response(error_http.replaceAll("{errorCode}", "403")
                    .replaceAll("{errorName}", "Forbidden")
                    .replaceAll("{errorDescription}", "Your user account is not authorized to access this resource."),
                {
                    status: 403,
                    statusText: "Forbidden",
                    headers: {
                        "Content-Type": "text/html"
                    }
                }
            )
        }
        // credential is useable, so set to locals
        context.locals.identity = constructed_identity
        return next()
    }
    // path does not require authentication and authorization
    return next()
}