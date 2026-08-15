/**
 * lib/api/authenticate.ts
 *
 * Retrieves the Cloudflare Access JWT from a request, if it exists
 * Validates the JWT with the given Access policy
 * Returns a BaseIdentity object for a validated identity
 *
 *
 * Portions of this file borrow code from the mwm-go-shorturl project (mwmsc.net) by
 * Michael Wong: said portions are authored by Michael Wong and are used by permission;
 * for questions, contact them at contact@michaelwongmusic.com
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
 *
 */

import { env } from "cloudflare:workers"
import { jwtVerify, createRemoteJWKSet } from "jose"
import { parseCookieHeader } from "./common.ts"

type CredentialResult = ["cookie" | "Cf-Header" | "Auth-Header", string]
// the credential source type is provided for convenience, but is not expected to be actually useful beyond logs

// createRemoteJWKSet is meant to be created once and reused: it caches the fetched key set internally
// (with a cooldown before refetching), so re-creating it on every call — as a request-scoped local would —
// defeats that cache and forces a network round-trip to Access's /cdn-cgi/access/certs endpoint on every
// request. env.TEAM_DOMAIN cannot be read at module-evaluation time (no request context yet), so the
// singleton is built lazily on first use and reused for the isolate's remaining lifetime.
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined
let jwksTeamDomain: string | undefined

function getJWKS(team_domain: string): ReturnType<typeof createRemoteJWKSet> {
    if (jwks === undefined || jwksTeamDomain !== team_domain) {
        jwks = createRemoteJWKSet(new URL(`${team_domain}/cdn-cgi/access/certs`))
        jwksTeamDomain = team_domain
    }
    return jwks
}

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

    // only inspect the cookie when a Cookie header is present; its absence must not short-circuit
    // the header-based checks below (Cf-Access-Jwt-Assertion / Authorization), which API and
    // service-token clients rely on
    const cookie_header = request.headers.get("Cookie")
    if (cookie_header !== null) {
        const parsed_cookies = parseCookieHeader(cookie_header)
        // search for the cookie
        if ("CF_Authorization" in parsed_cookies) {
            // cookie found, return it
            return ["cookie", parsed_cookies["CF_Authorization"]]
        }
    }

    const cf_jwt_header = request.headers.get("Cf-Access-Jwt-Assertion")

    // check headers first, then cookies as fallback
    if (cf_jwt_header !== null) {
        return ["Cf-Header", cf_jwt_header] // Cloudflare Access JWT in header, which is the standard when using Cloudflare Access; takes precedence over Authorization header
    }
    const auth_header = request.headers.get("Authorization")
    if (auth_header === null) {
        return null // no authorization header, so no credential
    }

    if (!auth_header.startsWith("Bearer ")) {
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
        const JWKS = getJWKS(env.TEAM_DOMAIN)

        const { payload } = await jwtVerify(token, JWKS, {
            issuer: env.TEAM_DOMAIN,
            audience: aud
        })

        // jwtVerify interface shape is defined at https://github.com/panva/jose/blob/main/docs/types/interfaces/JWTPayload.md
        const sub: string | null = payload.sub ? payload.sub : null // see RFC 7519; property is the subject of the JWT, which is the Access ID
        // Cloudflare Access stores and compares emails case-insensitively (lowercased); normalize the
        // claim here, at the single point identities are minted, so every downstream lookup and
        // comparison against the stored identity_email matches regardless of the casing in the JWT
        const email: string | null = payload.email ? String(payload.email).toLowerCase() : null // Access JWT's include an email claim
        const nbf_time: number = typeof payload.nbf === "number" ? payload.nbf : 0
        if (typeof payload.exp !== "number") {
            return null
        }
        const exp_time: number = payload.exp

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
        // jwt validation failed - not cryptographically valid
        console.error("JWT validation failed:", error)
        return null
    }
}

/**
 * Determines if a service principal (i.e., a Service Token) is used for authentication
 *
 * @param {object} payload - the verified JWT payload claims
 * @returns {boolean} true when the claims identify a service principal
 */
export function isServicePrincipalClaims(payload: Record<string, unknown>): boolean {
    return !payload.email && typeof payload.common_name === "string" && payload.common_name.length > 0
}

/**
 * Verifies whether a service token is cryptographically valid
 *
 * @param {string} token - the JWT presented in the Cf-Access-Jwt-Assertion header
 * @param {string} aud - the expected audience claim (the CF Access application audience)
 * @returns {Promise<boolean>} a Promise resolving to true only for a valid service-token JWT
 */
export async function isServiceTokenJWT(token: string, aud: string): Promise<boolean> {
    if (aud === "" || !token) {
        return false
    }
    try {
        const JWKS = getJWKS(env.TEAM_DOMAIN)
        const { payload } = await jwtVerify(token, JWKS, {
            issuer: env.TEAM_DOMAIN,
            audience: aud
        })
        // same nbf/exp policy as parseJWT: an absent nbf defaults to 0 (extends nothing), but an absent
        // exp is refused rather than treated as "never expires"
        if (typeof payload.exp !== "number") {
            return false
        }
        const current_time = Math.floor(Date.now() / 1000)
        if (current_time < (payload.nbf ?? 0) || current_time > payload.exp) {
            return false
        }
        return isServicePrincipalClaims(payload)
    } catch {
        // not cryptographically valid for this audience/issuer
        return false
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
