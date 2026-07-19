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
import { RLScope, ratelimit } from "../lib/public/ratelimit"
import { middlewareErrorResponder } from "../lib/api/http"
import { detectEnvironment } from "../lib/api/environment"

export const rateLimit: MiddlewareHandler = async (context, next) => {
    // rate limit bindings are Cloudflare-only; skip entirely in local development
    if (detectEnvironment(context.request) === "development") {
        return next()
    }

    // determine if the request path requires rate limiting
    const url = new URL(context.request.url)
    const path_components = url.pathname.split("/").filter((component) => component.length > 0)

    if (path_components.length === 0) {
        return next()
    }

    // determine the appropriate rate limit scope
    let scopes: RLScope[] = []
    if (path_components[0] === "api") {
        scopes.push(RLScope.ENDPOINT_API_ADMIN_GLOBAL, RLScope.ENDPOINT_API_ADMIN_USER)
        // the files API additionally meters R2 operations against dedicated bindings: object reads
        // (GET /api/v1/files/{id}) count as Class B; lists/uploads/replacements/deletions count as Class A
        if (path_components[2] === "files") {
            if (context.request.method === "GET" && path_components.length >= 4) {
                scopes.push(RLScope.ENDPOINT_API_FILES_READ)
            } else {
                scopes.push(RLScope.ENDPOINT_API_FILES_WRITE)
            }
        }
    } else if (path_components[0] === "admin") {
        scopes.push(RLScope.ENDPOINT_PAGERENDER_ADMIN)
    }
    if (scopes.length === 0) {
        return next()
    }
    const outcome = await ratelimit(context.request, scopes, context.locals.identity)
    if (!outcome) {
        return middlewareErrorResponder(context.request, 429)
    }
    return next()
}
