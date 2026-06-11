/**
 * src/middleware/ratelimit.ts
 * 
 * Supplies a middleware function to perform rate limiting
 * 
 */

import type { MiddlewareHandler } from "astro"
import { RLScope, ratelimit } from "../lib/public/ratelimit"
import { middlewareErrorResponder } from "../lib/api/http"

export const rateLimit: MiddlewareHandler = async (context, next) => {
    // determine if the request path requires rate limiting
    const url = new URL(context.request.url)
    const path_components = url.pathname.split("/").filter(component => component.length > 0)

    if (path_components.length === 0) {
        return next()
    }

    if (path_components[0] === "api" || path_components[0] === "admin" || path_components[0] === "services") {
        if (path_components[0] === "services" && path_components.length < 2) {
            return next()
        } else if (path_components[0] === "services" && path_components[1] !== "search") {
            return next()
        }
    }

    // determine the appropriate rate limit scope
    let scopes: RLScope[] = []
    if (path_components[0] === "api") {
        scopes.push(RLScope.ENDPOINT_API_ADMIN_GLOBAL, RLScope.ENDPOINT_API_ADMIN_USER)
    } else if (path_components[0] === "admin") {
        scopes.push(RLScope.ENDPOINT_PAGERENDER_ADMIN)
    } else if (path_components[0] === "services" && path_components[1] === "search") {
        scopes.push(RLScope.ENDPOINT_API_PUBLIC)
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