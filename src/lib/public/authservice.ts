/**
 * lib/public/authservice.ts
 * 
 * Provides a common API authorization check function
 */

import { env } from "cloudflare:workers"
import { requiresAllOf } from "../api/authorize"
import { authEnabled } from "../api/environment"
import { constructResponse } from "../api/http"


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
    if (!authEnabled(request)) {
        return null
    }
    // verify authentication
    if (identity === undefined) {
        // middleware failed to authenticate and construct authorization info
        return constructResponse(request, null, 401, "Unauthorized - no credential")
    }

    // verify the credential is active or enrollable; the inactive path carries all the branching
    if (!identity.active) {
        return _checkInactiveCredential(request, identity, required_perms, mode)
    }

    // guard
    if (identity.enrollable || !identity.active || !identity.allowed || mode === "enroll") {
        // impossible state
        return constructResponse(request, null, 500, "Internal Server Error - invalid credential state or server mode")
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
        return constructResponse(request, null, 403, "Forbidden")
    }
    // user passes authorization check
    return null
}

/**
 * Resolves the authorization outcome for an inactive credential (identity.active === false), the most
 * branch-heavy path of {@link auth_check}. Returns a Response to reject, or null to allow the request
 * to proceed. Behavior is unchanged from the previously-inlined logic:
 *  - admins with an allowable (non-enrollable) record keep full access outside enroll mode
 *  - non-enrollable credentials are rejected unless the mode is selfmgmt, where an allowable,
 *    permissionless request is permitted
 *  - enrollable credentials are only accepted in enroll mode
 */
function _checkInactiveCredential(request: Request, identity: Identity, required_perms: (keyof RoleProfile)[], mode: "default" | "selfmgmt" | "enroll"): Response | null {
    // the toggle state between allowable and enrollable is enforced by authorize.ts and by the identity middleware - if enrollable is True, then allowed is always False; the reverse is not necessarily true

    if (identity.allowed && !identity.enrollable && identity.admin && mode !== "enroll") {
        // admins with allowable but inactive credentials still retain full authorization
        return null
    }

    if (!identity.enrollable && mode !== "selfmgmt") {
        return constructResponse(request, null, 401, "Unauthorized - credential not active")
    } else if (!identity.enrollable && mode === "selfmgmt") {
        // the credential is inactive, not enrollable, and the mode is for self-manage
        if (!identity.allowed) {
            // credentials that are not enrollable but with no auth info can't be used
            return constructResponse(request, null, 401, "Unauthorized - credential lacking authorization information")
        }
        if (required_perms.length > 0) {
            // even if the page is self-manage, the required permissions cannot be met with an inactive profile
            return constructResponse(request, null, 403, "Forbidden - credential lacking active authorization information")
        }
        return null // credential is inactive, but the authorization mode allows inactive credentials if the page is for self-management
    }
    // credential is enrollable
    if (identity.allowed) {
        // impossible state - guard in case a credential with a record passes through
        return constructResponse(request, null, 500, "Internal Server Error - invalid credential state or server mode")
    }
    if (mode !== "enroll") {
        return constructResponse(request, null, 401, "Unauthorized - credential lacks authorization" + (env.API_USER_SELFENROLL ? "; perform self-enrollment" : ""))
    } else {
        return null // credential is enrollable, and the page requires enrollable credentials
    }
}