/**
 * middleware/headers.ts
 *
 * Applies security response headers to the SSR surface
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
import { detectEnvironment } from "../lib/api/environment"

/**
 * Admin content security policy
 */
const ADMIN_CSP = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' https: data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'"
].join("; ")

/**
 * Public content security policy
 */
export const PUBLIC_CSP = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' https: data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com/beacon.min.js",
    "connect-src 'self' https://cloudflareinsights.com"
].join("; ")

export const securityHeaders: MiddlewareHandler = async (context, next) => {
    const response = await next()
    const path = new URL(context.request.url).pathname
    // skip local development so the dev server's inline HMR client runs, and so HSTS is never pinned
    // against http://localhost
    let isDevelopment = false
    try {
        isDevelopment = detectEnvironment(context.request) === "development"
    } catch {
        // detectEnvironment throws only on an invalid dev hostname; fail closed and apply the headers
    }
    if (isDevelopment) {
        return response
    }

    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    response.headers.set("X-Content-Type-Options", "nosniff")

    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")

    if (path === "/_emdash" || path.startsWith("/_emdash/")) {
        return response
    }

    const isAdmin = path === "/admin" || path.startsWith("/admin/")

    response.headers.set("Content-Security-Policy", isAdmin ? ADMIN_CSP : PUBLIC_CSP)
    // frame-ancestors covers modern browsers; X-Frame-Options backstops older ones
    response.headers.set("X-Frame-Options", "DENY")
    if (isAdmin) {
        response.headers.set("Referrer-Policy", "same-origin")
    }
    return response
}
