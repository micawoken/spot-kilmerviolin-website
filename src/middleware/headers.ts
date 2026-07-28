/**
 * middleware/headers.ts
 *
 * Applies security response headers.
 *
 * Two tiers. Site-wide: HSTS, nosniff and Referrer-Policy — none of which affect resource loading, so
 * there is no reason to withhold them from the public site. Admin-only: a Content-Security-Policy and
 * frame protection, because the admin pages emit dynamic record data through a number of HTML sinks
 * (set:html / innerHTML, all routed through escapeHtml) and the policy keeps injected markup from
 * executing as script if a single escape were ever missed. The public site's resource loading is
 * separately reviewed and a public CSP is still owed; the compositor's emitted markup and the Pagefind
 * search bundle need verifying against one first.
 *
 * Skipped entirely in local development, where the Astro dev server injects the inline HMR client that a
 * strict script-src would block, and where an HSTS pin on localhost would break other local projects.
 *
 * CAVEAT: prerendered public pages may be served straight from the ASSETS binding without passing through
 * Astro middleware at all. Confirm with a live request against a static page after deploying; if they
 * bypass this, the site-wide three need a Cloudflare Transform Rule instead.
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
 * The admin Content-Security-Policy, assembled from directives joined by "; ".
 *
 *  - default-src 'self'        only same-origin by default (covers font-src, etc.)
 *  - script-src 'self'         Astro bundles every page <script> into a hashed same-origin module; no inline JS
 *  - style-src adds 'unsafe-inline' for Astro scoped <style> blocks and the few inline style attributes
 *
 * Two constraints follow from script-src 'self', both load-bearing:
 *
 *  - Admin pages cannot use an Astro client directive (`client:only`, `client:load`, …). Astro emits its
 *    island bootstrap as inline <script> tags with no nonce or hash (getPrescripts, astro/runtime/server/
 *    scripts), so the island silently never hydrates. Mount React from a page <script> that carries a real
 *    import instead — that stays an external hashed module. See pages/admin/advanced/designs/edit.astro.
 *  - Astro's own `csp` config is not the way out: it always emits a hash-based style-src, and a source list
 *    containing hashes makes 'unsafe-inline' inert, which would block the runtime <style> the compositor
 *    injects into the Puck canvas (DesignEditor.tsx) — and it would extend CSP to the public site and
 *    /_emdash, which this policy deliberately leaves alone.
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
    // skip local development so the dev server's inline HMR client runs, and so HSTS is never pinned
    // against http://localhost (a browser that caches it there breaks every other local project)
    let isDevelopment = false
    try {
        isDevelopment = detectEnvironment(context.request) === "development"
    } catch {
        // detectEnvironment throws only on an invalid dev hostname; fail closed and apply the headers
    }
    if (isDevelopment) {
        return response
    }

    // Applied site-wide, not just to /admin. Scoping the whole set to the admin UI left the public site
    // with no security headers at all; these three are behaviour-neutral for a static prerendered site,
    // so withholding them bought nothing.
    //
    // HSTS is the consequential one, and its absence applied to /admin too: without it a first visit can
    // be downgraded to http://, exposing the CF_Authorization cookie to an active network attacker on
    // that request. `preload` is deliberately NOT set — it is effectively irreversible, and
    // includeSubDomains binds every subdomain including the public R2 media domains.
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    response.headers.set("X-Content-Type-Options", "nosniff")
    // strict-origin-when-cross-origin, not the admin's same-origin: it keeps full referrers within the
    // site (which analytics and internal navigation want) while sending only the origin off-site
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")

    // the admin UI additionally gets the CSP and frame protection; its record-data HTML sinks are the
    // reason that policy exists (see the module header)
    if (path === "/admin" || path.startsWith("/admin/")) {
        response.headers.set("Content-Security-Policy", ADMIN_CSP)
        // frame-ancestors covers modern browsers; X-Frame-Options backstops older ones
        response.headers.set("X-Frame-Options", "DENY")
        response.headers.set("Referrer-Policy", "same-origin")
    }
    return response
}
