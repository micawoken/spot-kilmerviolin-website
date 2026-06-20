/**
 * middleware/headers.ts
 *
 * Applies security response headers to the admin UI. The admin pages emit dynamic record data through a
 * number of HTML sinks (set:html / innerHTML, all routed through escapeHtml), so a Content-Security-Policy
 * is added as defense-in-depth: if a single escape were ever missed, the policy keeps injected markup from
 * executing as script. The policy is paired with frame/sniff/referrer hardening.
 *
 * Scoped to /admin only — the public site is left untouched so its (separately reviewed) resource loading
 * is not disturbed — and skipped in local development, where the Astro dev server injects the inline HMR
 * client that a strict script-src would block.
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
 *
 * This license is also subject to additional terms as specified in the README.md.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import type { MiddlewareHandler } from "astro"
import { detectEnvironment } from "../lib/api/environment"

/**
 * The admin Content-Security-Policy, assembled from directives joined by "; ".
 *
 *  - default-src 'self'        only same-origin by default (covers font-src, etc.)
 *  - script-src 'self'         Astro bundles every page <script> into a hashed same-origin module; no inline JS
 *  - style-src adds 'unsafe-inline' for Astro scoped <style> blocks and the few inline style attributes
 *  - img-src allows https/data/blob: external record images, plus the ImageCrop blob: preview
 *  - connect-src 'self'        the connector's fetch() calls (/api, /files-manifest.json) are same-origin
 *  - object-src/base-uri 'none' and frame-ancestors 'none' close plugin, <base>, and clickjacking vectors
 *  - form-action 'self'        forms cannot be repointed at a third-party collector
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

export const securityHeaders: MiddlewareHandler = async (context, next) => {
    const response = await next()
    const path = new URL(context.request.url).pathname
    // only the admin UI is hardened here; skip local development so the dev server's inline HMR client runs
    if (path === "/admin" || path.startsWith("/admin/")) {
        try {
            if (detectEnvironment(context.request) === "development") {
                return response
            }
        } catch {
            // detectEnvironment throws only on an invalid dev hostname; fail closed and apply the headers
        }
        response.headers.set("Content-Security-Policy", ADMIN_CSP)
        // frame-ancestors covers modern browsers; X-Frame-Options backstops older ones
        response.headers.set("X-Frame-Options", "DENY")
        response.headers.set("X-Content-Type-Options", "nosniff")
        response.headers.set("Referrer-Policy", "same-origin")
    }
    return response
}
