/**
 * middleware/headers.ts
 *
 * Applies security response headers to the SSR surface.
 *
 * SCOPE: this covers only what the worker actually renders — /admin, /api and /_emdash. Prerendered
 * public pages are served straight from the Workers ASSETS binding and never enter the middleware chain
 * at all (confirmed: the Cloudflare adapter resolves assets.directory to the client build, and
 * run_worker_first is off), so their headers come from public/_headers instead. The public CSP lives
 * there, with integrations/csp-guard.mjs failing the build if a page emits markup it would block.
 *
 * Every SSR route gets HSTS, nosniff and Referrer-Policy, then a CSP and frame protection: ADMIN_CSP
 * under /admin, PUBLIC_CSP everywhere else. The admin pages emit dynamic record data through a number of
 * HTML sinks (set:html / innerHTML, all routed through escapeHtml), and the policy keeps injected markup
 * from executing as script if a single escape were ever missed.
 *
 * PUBLIC_CSP applies to nothing today — /api returns JSON, and every public page is prerendered. It is
 * here for the case a public page sets `prerender = false`: that route leaves the reach of both
 * public/_headers and csp-guard at once, and before this it would have shipped with no policy at all.
 *
 * /_emdash is the sole exemption; see the check in the handler for why.
 *
 * Skipped entirely in local development, where the Astro dev server injects the inline HMR client that a
 * strict script-src would block, and where an HSTS pin on localhost would break other local projects.
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

/**
 * The public Content-Security-Policy, for everything that is neither /admin nor /_emdash.
 *
 * MUST stay byte-identical to the Content-Security-Policy line in public/_headers, which is what actually
 * covers the site today: every public route is currently prerendered and served from the ASSETS binding,
 * so this copy applies to nothing yet. It exists so that a public page switching to `prerender = false`
 * does not silently ship with no policy at all — the failure that motivated it, since the build-time
 * guard in integrations/csp-guard.mjs only ever sees prerendered output. tests/public-csp.test.ts pins the
 * two copies together.
 *
 * Differs from ADMIN_CSP in both directions, which is why the two are separate rather than one shared
 * base: the public site needs 'wasm-unsafe-eval' and the Cloudflare beacon, the admin needs blob: images
 * for the ImageCrop preview. Neither is a superset of the other.
 *
 *  - script-src                'self' covers Astro's hashed page modules and the dynamic import of
 *                              /pagefind/pagefind.js. 'wasm-unsafe-eval' is required because Pagefind
 *                              compiles its index with WebAssembly.instantiate. The beacon is pinned to
 *                              its exact URL rather than its origin
 *  - style-src 'unsafe-inline' unavoidable: the compositor emits theme tokens through <style set:html>.
 *                              CSS injection is blocked at the source instead, in lib/compositor/tokens.ts
 *  - img-src                   record and CMS images come from R2 custom domains and theme values may name
 *                              others; no blob:, which only the admin's crop preview needs
 *  - connect-src               'self' for Pagefind's index fetches; cloudflareinsights.com because the
 *                              beacon is a manual embed and so reports off-origin
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

    // Applied to every SSR route, not just /admin. The public site gets nosniff and Referrer-Policy from
    // public/_headers instead. HSTS appears only here: the zone-wide Cloudflare setting already covers
    // asset responses, and this is the in-app backstop for the case where that setting is ever turned off.
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

    // /_emdash is the one route family with no CSP. It is a third-party React admin whose resource loading
    // this project does not control, and neither policy below was derived against it; a strict script-src
    // would break the CMS with no way to test that here. It keeps the three headers above, which are
    // behaviour-neutral. Revisit only with EmDash's own markup in hand.
    if (path === "/_emdash" || path.startsWith("/_emdash/")) {
        return response
    }

    const isAdmin = path === "/admin" || path.startsWith("/admin/")
    // The admin's record-data HTML sinks are the reason ADMIN_CSP exists (see the module header).
    // Everything else — /api, plus any public page that stops being prerendered — gets PUBLIC_CSP, so a
    // route moving to SSR cannot land with no policy at all.
    response.headers.set("Content-Security-Policy", isAdmin ? ADMIN_CSP : PUBLIC_CSP)
    // frame-ancestors covers modern browsers; X-Frame-Options backstops older ones
    response.headers.set("X-Frame-Options", "DENY")
    if (isAdmin) {
        response.headers.set("Referrer-Policy", "same-origin")
    }
    return response
}
