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
 * Execution modes:
 *  - default: a credential must be allowable (has authorization info), active, and meet required permission requirements [default]
 *  - selfmgmt: a credential must be allowable and not enrollable, with any active state (if active, must meet permission requirements; if inactive, must be permissionless) [used for self-management]
 *  - enroll: a credential must be enrollable, not allowable, and inactive [used for self-enrollment only]
 * 
 * @param {Request} request - the Request object, used to supply CORS headers
 * @param {Identity | undefined} identity - the Identity object to check, or undefined if authentication/authorization middleware failed to construct it
 * @param {keyof RoleProfile[]} required_perms - the permissions required to access the resource in question; empty behavior depends on null_mode
 * @param {boolean} fail_closed - if true (default), empty required_perms fails closed (allows only admins); if false, empty required_perms fails open (allows all authenticated users)
 * @param {"default" | "readonly" | "enroll"} mode - the execution mode; see earlier
 * 
 */
export function auth_check(request: Request, identity: Identity | undefined, required_perms: (keyof RoleProfile)[], fail_closed: boolean = true, mode: "default" | "selfmgmt" | "enroll" = "default"): Response | null {
    if (env.AUTH_ENABLED === false) {
        return null
    }
    // verify authentication
    if (identity === undefined) {
        // middleware failed to authenticate and construct authorization info
        return new Response(
            JSON.stringify(errorAPIPayload("Unauthorized - no credential")),
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

    // verify the credential is active or enrollable
    if (!identity.active) {
        // the toggle state between allowable and enrollable is enforced by authorize.ts and by the identity middleware - if enrollable is True, then allowed is always False; the reverse is not necessarily true

        if (identity.allowed && !identity.enrollable && identity.admin && mode !== "enroll") {
            // admins with allowable but inactive credentials still retain full authorization
            return null
        }

        if (!identity.enrollable && mode !== "selfmgmt") {
            return new Response(
                JSON.stringify(errorAPIPayload("Unauthorized - credential not active")),
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
        } else if (!identity.enrollable && mode === "selfmgmt") {
            // the credential is inactive, not enrollable, and the mode is for self-manage
            if (!identity.allowed) {
                // credentials that are not enrollable but with no auth info can't be used
                return new Response(
                    JSON.stringify(errorAPIPayload("Unauthorized - credential lacking authorization information")),
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
            if (required_perms.length > 0) {
                // even if the page is self-manage, the required permissions cannot be met with an inactive profile
                return new Response(
                    JSON.stringify(errorAPIPayload("Forbidden - credential lacking active authorization information")),
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
            return null // credential is inactive, but the authorization mode allows inactive credentials if the page is for self-management
        }
        // credential is enrollable
        if (identity.allowed) {
            // impossible state - guard in case a credential with a record passes through
            return new Response(
                JSON.stringify(errorAPIPayload("Internal Server Error - invalid credential state or server mode")),
                {
                    status: 500,
                    statusText: "Internal Server Error",
                    headers: _constructHeaders(API_headers, 
                        {
                            "Access-Control-Allow-Origin": request.headers.get("Origin") || cors_fallback_origin,
                            "Origin": request.headers.get("Origin") || cors_fallback_origin
                        }
                    )
                }
            )
        }
        if (mode !== "enroll") {
            return new Response(
                JSON.stringify(errorAPIPayload("Unauthorized - credential lacks authorization" + (env.API_USER_SELFENROLL ? "; perform self-enrollment" : ""))),
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
        } else {
            return null // credential is enrollable, and the page requires enrollable credentials
        }
    }

    // guard
    if (identity.enrollable || !identity.active || !identity.allowed || mode === "enroll") {
        // impossible state
        return new Response(
            JSON.stringify(errorAPIPayload("Internal Server Error - invalid credential state or server mode")),
            {
                status: 500,
                statusText: "Internal Server Error",
                headers: _constructHeaders(API_headers, 
                    {
                        "Access-Control-Allow-Origin": request.headers.get("Origin") || cors_fallback_origin,
                        "Origin": request.headers.get("Origin") || cors_fallback_origin
                    }
                )
            }
        )
    }

    /*
     * At this point, it is presumed that:
     * - the credential is allowable - there is a record for the Identity;
     * - the credential is active - the record can be used for default authorization;
     * - the credential is not enrollable; and
     * - default authorization is being used
     */

    // verify authorization
    if (!identity.admin && !requiresAllOf(required_perms, identity, fail_closed)) {
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