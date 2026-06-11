/**
 * lib/api/environment.ts
 *
 * Determines the runtime environment from the request hostname and the build mode,
 * replacing the former AUTH_ENABLED and RICH_ERRORS wrangler vars
 *
 * Environment rules:
 *  - production build (import.meta.env.PROD) served from a workers.dev hostname -> staging
 *  - production build served from any other hostname -> production
 *  - development build served from localhost or 127.0.0.1 -> development
 *  - any other combination is invalid and throws
 *
 */

export type RuntimeEnvironment = "development" | "staging" | "production"

/**
 * Detects the runtime environment for a request
 *
 * @param {Request} request - the original Request object, used to read the hostname
 * @returns {RuntimeEnvironment} the detected environment
 * @throws {Error} if a development build is served from a hostname other than localhost or 127.0.0.1
 */
export function detectEnvironment(request: Request): RuntimeEnvironment {
    const hostname = new URL(request.url).hostname
    if (import.meta.env.PROD) {
        return hostname.includes("workers.dev") ? "staging" : "production"
    }
    if (hostname === "localhost" || hostname === "127.0.0.1") {
        return "development"
    }
    // a development build must never be reachable from a non-local hostname
    throw new Error(`Invalid runtime environment: development build served from hostname "${hostname}"`)
}

/**
 * Whether the identity middleware and authentication primitives are active; false only during development
 *
 * @param {Request} request - the original Request object
 * @returns {boolean} true on staging and production, false on development
 */
export function authEnabled(request: Request): boolean {
    return detectEnvironment(request) !== "development"
}

/**
 * Whether API error responses may include underlying error details; true only during development
 *
 * @param {Request} request - the original Request object
 * @returns {boolean} true on development, false on staging and production
 */
export function richErrors(request: Request): boolean {
    return detectEnvironment(request) === "development"
}
