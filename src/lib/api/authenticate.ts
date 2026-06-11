/**
 * lib/api/authenticate.ts
 * 
 * Retrieves the Cloudflare Access JWT from a request, if it exists
 * Validates the JWT with the given Access policy
 * Returns a BaseIdentity object for a validated identity
 * 
 * 
 * No internal dependencies; dependent on env (Workers) and jose
 * 
 * 
 * Portions of this file borrow code from the mwm-go-shorturl project (mwmsc.net) by
 * Michael Wong; for questions, contact him at contact@michaelwongmusic.com
 * 
 */


import { env } from "cloudflare:workers"
import { jwtVerify, createRemoteJWKSet } from "jose"
import { parseCookieHeader } from "./common.ts"

type CredentialResult = ["cookie" | "Cf-Header" | "Auth-Header", string]
// the credential source type is provided for convenience, but is not expected to be actually useful beyond logs

/**
 * Retrieves the Cloudflare Access JWT from a request, if it exists
 * 
 * @param {Request} request - the original Request object
 * @returns {Promise<CredentialResult | null>} a Promise resolving to the credential or null if not found
 */
export async function retrieveCredential(request: Request): Promise<CredentialResult | null> {
    // borrowed from the mwm-go-shorturl project

    // reads the request headers to determine if the credential is present
    
    // credential priority: cookie, cf-access header, authorization header
    
    const cookie_header = request.headers.get("Cookie")
        if (cookie_header == null) {

            // fix later - possible issue since the absence of the cookie header will prevent checks for the other steps
            // however, unlikely to cause issue, so not urgent

            return null // no cookies, so no credential
        }
    const parsed_cookies = parseCookieHeader(cookie_header)
    // search for the cookie
    if ("CF_Authorization" in parsed_cookies) {
        // cookie found, return it
        return ["cookie", parsed_cookies["CF_Authorization"]]
    } 

    const cf_jwt_header = request.headers.get("Cf-Access-Jwt-Assertion")

    // check headers first, then cookies as fallback
    if (cf_jwt_header != null) {
        return ["Cf-Header", cf_jwt_header] // Cloudflare Access JWT in header, which is the standard when using Cloudflare Access; takes precedence over Authorization header
    } 
    const auth_header = request.headers.get("Authorization")
    if (auth_header == null) {
        return null // no authorization header, so no credential
    }

    if (!(auth_header.startsWith("Bearer "))) {
        // credential is not a Bearer token, reject
        return null
    } else {
        return ["Auth-Header", auth_header.slice(7)] // Bearer token in Authorization header, which is a common standard for transmitting JWTs; only accepted if it starts with "Bearer "
    }
    // code is unreachable here, so no return statement is needed   
        
}

/**
 * Parses and validates a Cloudflare Access JWT
 * 
 * @param {string | null} token - the JWT as a string, or null if no credential was found
 * @param {string} aud - the expected audience claim for the JWT, which should match the CF Access application audience
 * @returns {Promise<BaseIdentity | null | undefined>} a Promise resolving to a BaseIdentity object if the token is valid, null if the token is invalid, or undefined if the token is missing or the audience is not specified
 */
export async function parseJWT(token: string | null, aud: string): Promise<BaseIdentity | null | undefined> {
    // also borrowed from mwm-go-shorturl, but now returns a BaseIdentity object

    // returning null indicates 403 error
    // returning undefined indicates 401 error

    function construct(sub: string, email: string, nbf: number, exp: number): BaseIdentity {
        return {
            sub: sub,
            email: email,
            nbf: nbf,
            exp: exp
        }
    }

    // during local development, the identity middleware bypasses authentication entirely
    // (see src/middleware/identity.ts), so no development bypass is needed here

    // a bypass during staging can be set, but it will not be implemented at the authentication level

    if (aud === "") {
        return undefined
    }

    if (!token) {
        return undefined
    }

    try {
        const JWKS = createRemoteJWKSet(new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`));

        const { payload } = await jwtVerify(token, JWKS, {
          issuer: env.TEAM_DOMAIN,
          audience: aud,
        });
        
        // jwtVerify interface shape is defined at https://github.com/panva/jose/blob/main/docs/types/interfaces/JWTPayload.md
        // this time (in this project, unlike mwm-go-shorturl), the interface is defined in env.d.ts
        const sub: string | null = payload.sub ? payload.sub : null; // see RFC 7519; property is the subject of the JWT, which is the Access ID
        const email: string | null = payload.email // Access JWT's include an email claim
        const nbf_time: number = payload.nbf ? payload.nbf : 0; // not before time, in seconds since epoch; if not specified, it is epoch 0
        const exp_time: number = payload.exp ? payload.exp : Infinity; // expiration time, in seconds since epoch; if not specified, it is infinite

        /**
         * BaseIdentity includes an nbf and exp time, but it is unlikely that these times will be used because:
         * 1. Zero Trust is assumed, so the JWT is re-validated after every request; and
         * 2. Time in Cloudflare Workers is frozen unless there is I/O.
         * 
         * For these reasons, if a JWT does not include an nbf and/or an exp claim, it fails open - there is
         * no practical use for these claims, and the absence of the claims does not invalidate the authenticated identity.
         * 
         * However, if an nbf and/or an exp claim is provided, it may be checked before certain security-sensitive operations.
         */

        if (!sub || !email) {
            return null
            // JWT does not provide an identity to establish
        }

        // since jwtVerify didn't throw an error, the token is cryptographically valid
        // so, only checks left are that it is active and unexpired
        const current_time: number = Math.floor(Date.now() / 1000) // in seconds since epoch
        if (current_time < nbf_time || current_time > exp_time) {
            return null
        }
        // token is valid, active, and unexpired, so authorize the user
        return construct(sub, email, nbf_time, exp_time)
    } catch (error) {
        console.log(error)
        // jwt validation failed - not cryptographically valid
        return null
    }
}

/**
 * Validates the nbf and exp claims
 * 
 * @param {BaseIdentity} result - the result of JWT validation, which includes nbf and exp claims if they were provided in the JWT
 * @returns {boolean} true if the current time is within the nbf and exp window, or if neither claim is provided;
 */
export function canUse(result: BaseIdentity): boolean {
    // validates if the authentication result is usable in the current context
    if ("nbf" in result && "exp" in result) {
        const current_time: number = Math.floor(Date.now() / 1000) // in seconds since epoch
        if (current_time < result.nbf || current_time > result.exp) {
            return false
        }
    }
    // as noted earlier, time may not advance during execution of a Cloudflare Worker isolate
    return true
}