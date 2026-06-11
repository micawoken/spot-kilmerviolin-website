/**
 * src/middleware/preflight.ts
 * 
 * Supplies a middleware function to detect CORS preflight requests and respond to them
 * 
 */

import type { MiddlewareHandler } from "astro"
import { _constructHeaders, cors_fallback_origin, preflight_closed_headers, preflight_headers } from "../lib/api/http"

export const preflight: MiddlewareHandler = async (context, next) => {
    const { request } = context
    if (request.method === "OPTIONS" && request.headers.has("Origin") && request.headers.has("Access-Control-Request-Method")) {
        // check which CORS policy to use
        const path_components = new URL(request.url).pathname.split("/").filter(component => component.length > 0)
        if (path_components.length > 0 && path_components[0] === "api") {
            // the full CORS policy is released on API routes since they necessitate the additional headers
            return new Response(null, {
                status: 204,
                statusText: "No Content",
                headers: _constructHeaders(preflight_headers, {
                    "Access-Control-Allow-Origin": request.headers.get("Origin") || cors_fallback_origin,
                    "Origin": request.headers.get("Origin")! // the if statement indicates the header exists, so null is overridden
                })
            })
        } else if (path_components.length > 0 && path_components[0] === "admin") {
            // admin pages don't need support for some request methods and headers, but still need credential transmission
            return new Response(null, {
                status: 204,
                statusText: "No Content",
                headers: _constructHeaders(preflight_closed_headers, {
                    "Access-Control-Allow-Origin": request.headers.get("Origin") || cors_fallback_origin,
                    "Origin": request.headers.get("Origin")! // the if statement indicates the header exists, so null is overridden
                })
            })
        } 
        // for non-API and non-admin routes, CORS defaults closed
        return new Response(null, {
            status: 204,
            statusText: "No Content",
            headers: _constructHeaders(preflight_closed_headers, {
                "Access-Control-Allow-Origin": request.headers.get("Origin") || cors_fallback_origin,
                "Origin": request.headers.get("Origin")! // the if statement indicates the header exists, so null is overridden
            })
        })

    } else if (request.method === "OPTIONS") {
        // the request is OPTIONS, but not CORS preflight
        return new Response(null, {
            status: 204,
            statusText: "No Content",
            headers: {
                "Allow": "GET, OPTIONS"
            }
        })
    }
    // the request is not OPTIONS
    return next()
}