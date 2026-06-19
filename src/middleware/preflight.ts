/**
 * src/middleware/preflight.ts
 * 
 * Supplies a middleware function to detect CORS preflight requests and respond to them
 * 
 */

import type { MiddlewareHandler } from "astro"
import { constructPreflightResponse, constructOptionsResponse } from "../lib/api/http"

export const preflight: MiddlewareHandler = async (context, next) => {
    const { request } = context
    if (request.method === "OPTIONS" && request.headers.has("Origin") && request.headers.has("Access-Control-Request-Method")) {
        // CORS preflight: the response policy (API/admin/closed) is selected in http.ts by route
        return constructPreflightResponse(request)
    } else if (request.method === "OPTIONS") {
        // the request is OPTIONS, but not CORS preflight
        return constructOptionsResponse(request)
    }
    // the request is not OPTIONS
    return next()
}