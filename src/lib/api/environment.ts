/**
 * lib/api/environment.ts
 *
 * Provides for runtime environment detection to auto-set certain environment variables
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

import { PRODUCTION_HOSTS } from "../../consts"

export type RuntimeEnvironment = "development" | "staging" | "production"

/**
 * The URL of the request currently being served, recorded once per request by the requestContext
 * middleware.
 */
let activeRequestUrl: string | null = null

/**
 * Records the URL of the request currently being served
 *
 * @param {string} url - the value of context.request.url for the in-flight request
 */
export function setActiveRequestUrl(url: string): void {
    activeRequestUrl = url
}

/**
 * Detects the runtime environment from a request hostname. Fail-closed: an unrecognized hostname is a
 * preview ("staging"), never production.
 *
 * @param {string} hostname - the request hostname
 * @returns {RuntimeEnvironment} the detected environment
 * @throws {Error} if a development build is served from a hostname other than localhost or 127.0.0.1
 */
function detectEnvironmentFromHostname(hostname: string): RuntimeEnvironment {
    if (import.meta.env.PROD) {
        // Only a configured production hostname is production; every other hostname the worker can be
        // reached on is a preview and gets the reduced surface. That covers the "staging" preview alias
        // (staging-<worker>.<subdomain>.workers.dev), the bare workers.dev hostname, and the per-version
        // preview URLs `preview_urls: true` mints — the last of which carry a random hex prefix, so a rule
        // keyed on a "staging-" prefix classified them as production and served /admin, /api and /_emdash
        // against the production bindings, with writes enabled and no Access in front.
        return PRODUCTION_HOSTS.includes(hostname) ? "production" : "staging"
    }
    if (hostname === "localhost" || hostname === "127.0.0.1") {
        return "development"
    }
    // a development build must never be reachable from a non-local hostname
    throw new Error(`Invalid runtime environment: development build served from hostname "${hostname}"`)
}

/**
 * Detects the runtime environment for a request
 *
 * @param {Request} request - the original Request object, used to read the hostname
 * @returns {RuntimeEnvironment} the detected environment
 * @throws {Error} if a development build is served from a hostname other than localhost or 127.0.0.1
 */
export function detectEnvironment(request: Request): RuntimeEnvironment {
    return detectEnvironmentFromHostname(new URL(request.url).hostname)
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

/**
 * Whether the currently active request (as recorded by the requestContext middleware) is a local
 * development request. Intended for code paths that cannot receive a Request directly, such as
 * guardedRead in page_auth.ts.
 *
 * @returns {boolean} true when the in-flight request is on localhost/127.0.0.1 in a dev build
 */
export function isActiveRequestDev(): boolean {
    if (!activeRequestUrl) return false
    try {
        return detectEnvironmentFromHostname(new URL(activeRequestUrl).hostname) === "development"
    } catch {
        return false
    }
}

/**
 * Whether the database primitives are allowed to perform write operations; false during staging since the API and admin are disabled
 *
 * @param {Request} [request] - the original Request object; when omitted, the request URL recorded by
 *   the requestContext middleware is used, which is how the D1 write gate resolves the environment
 * @returns {boolean} true on development and production, false on staging
 */
export function dbWriteEnabled(request?: Request): boolean {
    const url = request?.url ?? activeRequestUrl
    // Without a request context (e.g. unit tests, or a write issued outside the request lifecycle)
    // there is no hostname to identify staging, so writes default on — matching the previous
    // DB_ENABLE_WRITE default. Staging is always reached through the middleware that records the
    // URL, so its writes remain gated.
    if (!url) {
        return true
    }
    return detectEnvironmentFromHostname(new URL(url).hostname) !== "staging"
}
