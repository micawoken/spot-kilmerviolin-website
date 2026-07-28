/**
 * middleware/ratelimit.ts
 *
 * Supplies a middleware function to perform rate limiting
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

import type { MiddlewareHandler } from "astro"
import { RLScope, ratelimit, scopeKeyType } from "../lib/public/ratelimit"
import { middlewareErrorResponder } from "../lib/api/http"
import { detectEnvironment } from "../lib/api/environment"

/**
 * Every scope that applies to a request path, regardless of when it can be evaluated.
 *
 * @param {string[]} path_components - the non-empty path segments of the request URL
 * @param {string} method - the request method
 * @returns {RLScope[]} the applicable scopes, empty when the path is unmetered
 */
function scopesForPath(path_components: string[], method: string): RLScope[] {
    const scopes: RLScope[] = []
    if (path_components[0] === "api") {
        scopes.push(RLScope.ENDPOINT_API_PUBLIC, RLScope.ENDPOINT_API_ADMIN_GLOBAL, RLScope.ENDPOINT_API_ADMIN_USER)
        // the files API additionally meters R2 operations against dedicated bindings: object reads
        // (GET /api/v1/files/{id}) count as Class B; lists/uploads/replacements/deletions count as Class A
        if (path_components[2] === "files") {
            if (method === "GET" && path_components.length >= 4) {
                scopes.push(RLScope.ENDPOINT_API_FILES_READ)
            } else {
                scopes.push(RLScope.ENDPOINT_API_FILES_WRITE)
            }
        }
    } else if (path_components[0] === "admin") {
        scopes.push(RLScope.ENDPOINT_PAGERENDER_ADMIN)
    } else if (path_components[0] === "_emdash") {
        // The CMS surface was entirely unmetered: it fell through the api/admin branches to next(), so
        // neither its D1 content reads nor its R2 object reads counted against anything.
        scopes.push(RLScope.IP_GLOBAL)
        // /_emdash/api/media/file/* serves R2 objects (Class B, capped at 10M/mo on the free plan), so it
        // shares the binding that exists to bound exactly that volume
        if (path_components[1] === "api" && path_components[2] === "media" && path_components[3] === "file") {
            scopes.push(RLScope.ENDPOINT_API_FILES_READ)
        }
    }
    return scopes
}

/** Whether rate limiting applies at all — the bindings are Cloudflare-only, so skip local development. */
function metered(request: Request): boolean {
    return detectEnvironment(request) !== "development"
}

/** Splits a request path's scopes into those evaluable without an identity and those needing one. */
function partitionScopes(request: Request): { preIdentity: RLScope[]; postIdentity: RLScope[] } {
    const path_components = new URL(request.url).pathname.split("/").filter((component) => component.length > 0)
    const scopes = scopesForPath(path_components, request.method)
    return {
        preIdentity: scopes.filter((scope) => scopeKeyType(scope) !== "user"),
        postIdentity: scopes.filter((scope) => scopeKeyType(scope) === "user")
    }
}

/**
 * IP- and globally-keyed limiting, applied BEFORE authentication.
 *
 * Rate limiting used to run last in the chain, after identity. Every rejection path in identity.ts
 * returns a Response instead of calling next(), so a request that failed authentication was never
 * metered at all — an unauthenticated caller could flood /api/* and /admin/* without limit, each request
 * costing a Worker invocation and a JWKS signature verification. These scopes need no identity, so they
 * run first and cover rejected requests too.
 */
export const rateLimitIp: MiddlewareHandler = async (context, next) => {
    if (!metered(context.request)) {
        return next()
    }
    const { preIdentity } = partitionScopes(context.request)
    if (preIdentity.length === 0) {
        return next()
    }
    if (!(await ratelimit(context.request, preIdentity, context.locals.identity))) {
        return middlewareErrorResponder(context.request, 429)
    }
    return next()
}

/**
 * User-keyed limiting, applied AFTER identity has been constructed.
 *
 * auto_global is false: the shared per-IP frequency limit (RL_FREQ) was already applied by the
 * pre-identity pass, and counting one request against it twice would halve the effective allowance.
 */
export const rateLimitUser: MiddlewareHandler = async (context, next) => {
    if (!metered(context.request)) {
        return next()
    }
    const { postIdentity } = partitionScopes(context.request)
    if (postIdentity.length === 0) {
        return next()
    }
    if (!(await ratelimit(context.request, postIdentity, context.locals.identity, false))) {
        return middlewareErrorResponder(context.request, 429)
    }
    return next()
}
