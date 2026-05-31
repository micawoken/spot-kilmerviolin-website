/**
 * lib/public/authservice.ts
 * 
 * Provides a common API authorization check function
 */

import { env } from "cloudflare:workers"
import { requiresAllOf } from "../api/authorize"
import { errorAPIPayload } from "../api/common"
import { _constructHeaders, API_headers, cors_fallback_origin } from "../api/http"


/**
 * For a given request and associated identity object, check whether the user is authenticated, then check if they possess the required permissions
 * 
 * @param {Request} request - the Request object, used to supply CORS headers
 * @param {Identity | undefined} identity - the Identity object to check, or undefined if authentication/authorization middleware failed to construct it
 * @param {keyof RoleProfile[]} required_perms - the permissions required to access the resource in question; empty behavior depends on null_mode
 * @param {boolean} fail_closed - if true (default), empty required_perms fails closed (allows only admins); if false, empty required_perms fails open (allows all authenticated users)
 * 
 */
export function auth_check(request: Request, identity: Identity | undefined, required_perms: (keyof RoleProfile)[], fail_closed: boolean = true): Response | null {
    if (env.AUTH_ENABLED === false) {
        return null
    }
    if (identity === undefined) {
        // middleware failed to authenticate and construct authorization info
        return new Response(
            JSON.stringify(errorAPIPayload("Unauthorized")),
            {
                status: 401,
                statusText: "Unauthorized",
                headers: _constructHeaders(API_headers, 
                    {
                        "Access-Control-Allow-Origin": request.headers.get("Origin") || cors_fallback_origin,
                        "Origin": request.headers.get("Origin") || cors_fallback_origin
                    }
                )
            }
        )
    }
    // verify authorization
    if (!identity.admin && !requiresAllOf(required_perms, identity)) {
        // user is authenticated but not authorized to access this resource
        return new Response(
            JSON.stringify(errorAPIPayload("Forbidden")),
            {
                status: 403,
                statusText: "Forbidden",
                headers: _constructHeaders(API_headers, 
                    {
                        "Access-Control-Allow-Origin": request.headers.get("Origin") || cors_fallback_origin,
                        "Origin": request.headers.get("Origin") || cors_fallback_origin
                    }
                )
            }
        )
    }
    // user passes authorization check
    return null
}