/**
 * astro.config.mjs
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

// @ts-check
import { defineConfig } from "astro/config"
import sitemap from "@astrojs/sitemap"

import cloudflare from "@astrojs/cloudflare"

import optimizeFiles from "./integrations/optimize-files.mjs"
import optimizeEmdashMedia from "./integrations/optimize-emdash-media.mjs"
import themeFonts from "./integrations/theme-fonts.mjs"
import cspGuard from "./integrations/csp-guard.mjs"

import react from "@astrojs/react"
import markdoc from "@astrojs/markdoc"

// EmDash CMS (replaced Pages CMS). Cloudflare-native: content in its own D1 (EMDASH_DB), media in its
// own R2 bucket (EMDASH_MEDIA), admin at /_emdash/admin.
import emdash from "emdash/astro"
import { d1, r2, access, kvCache } from "@emdash-cms/cloudflare"

// https://astro.build/config
export default defineConfig({
    site: "https://kilmer.nrnnet.xyz",
    integrations: [
        // Admin pages are prerendered too (Access-gated, not secret, but not public content either), so
        // the default crawl would otherwise list the entire admin route tree in the public sitemap.
        // /search and /search/advanced are excluded too: both render an empty static shell (results are
        // client-side Pagefind/JSON-facet lookups, see PublicPage's `noindex` prop on those two pages) —
        // listing them would just spend crawl budget on a page with no server-rendered content.
        sitemap({
            filter: (page) => {
                const pathname = new URL(page).pathname
                return (
                    !pathname.startsWith("/admin") && pathname !== "/search" && pathname !== "/search/advanced"
                )
            }
        }),
        optimizeFiles(),
        // Re-encodes EmDash-sourced media (compositor Image/ContentImage/MediaText) referenced by the
        // built HTML — EmDash's own uploads bypass optimizeFiles/optimizeImage entirely. See that file's
        // header for why this runs as a post-build HTML rewrite rather than at render time.
        optimizeEmdashMedia(),
        // Resolves the published theme's self-hosted web fonts in a real-Node build hook, before the
        // prerenderer's workerd instance starts — see integrations/theme-fonts.mjs for why.
        themeFonts(),
        react(),
        markdoc(),
        // Fails the build if a prerendered page emits markup the public CSP in public/_headers blocks.
        cspGuard(),
        // EmDash runs alongside the existing flat-file content readers during the staged migration; it does
        // not manage any route we render ourselves. Auth is delegated to Cloudflare Access (the same policy
        // the worker manages via src/lib/api/access_iam_mgmt.ts) — passkeys are disabled. audienceEnvVar
        // reads the existing CF_ACCESS_AUD var at runtime (the recommended pattern for Workers). No
        // worker_loaders/sandbox block: plugins are out of scope, so this stays on the Cloudflare free plan.
        // On top of this Access authentication, src/middleware/emdash_access.ts authorizes /_emdash
        // in-app against the cms_editor permission (any enrolled contributor otherwise passes Access).
        emdash({
            database: d1({ binding: "EMDASH_DB" }),
            // publicUrl makes EmDash resolve media to a public URL instead of the Access-gated
            // /_emdash/api/media/file proxy. Required now that public pages are prerendered static assets:
            // an anonymous visitor must be able to load CMS images without passing Cloudflare Access. Set
            // EMDASH_MEDIA_PUBLIC_URL to the emdash-media bucket's public/R2-custom-domain URL (see DEPLOY).
            // When unset it falls back to the proxy (fine for local dev; images won't load for the public).
            storage: r2({ binding: "EMDASH_MEDIA", publicUrl: process.env.EMDASH_MEDIA_PUBLIC_URL }),
            // KV object cache for EmDash's own request-time reads. Public pages and chrome are now
            // prerendered (read at build over the HTTP API, not from D1 at request time), so this no longer
            // sits on the public hot path; it still caches EmDash's admin/preview reads. Reuses the existing
            // KV_DB_CACHE namespace — EmDash namespaces its own keys; preview/visual-edit requests bypass it.
            objectCache: kvCache({ binding: "KV_DB_CACHE" }),
            auth: access({
                teamDomain: "nrnnet.cloudflareaccess.com",
                audienceEnvVar: "CF_ACCESS_AUD",
                // EmDash Role.EDITOR. Must be set explicitly: the adapter's default is 30, which its own
                // doc comment mislabels as "Editor" — 30 is AUTHOR, and EDITOR is 40. At 30 a CMS editor
                // can only touch content they authored, and `schema:read` (Editor+) is denied, which 403s
                // the design editor's outlet field pickers (they list the collection's fields). Everyone
                // reaching /_emdash has already passed the cms_editor gate in middleware/emdash_access.ts,
                // so Editor is the role that gate already implies. Applied at first provisioning only
                // (syncRoles defaults false), so an existing user's row must be migrated by hand.
                defaultRole: 40
            })
        })
    ],
    adapter: cloudflare(),
    trailingSlash: "never",
    output: "server", // prerender needs to be enabled on the relevant pages
    redirects: {
        "/admin/logout": "/cdn-cgi/access/logout" // Cloudflare Access logout
    },
    security: {
        allowedDomains: [
            {
                hostname: "kilmer.nrnnet.xyz",
                protocol: "https"
            }
        ],
        checkOrigin: import.meta.env.PROD
    },
    vite: {
        build: {
            // Astro inlines a page <script> straight into the HTML when its bundled chunk imports nothing
            // and falls under this limit (astro/core/build/plugins/plugin-scripts.js). The public site's
            // CSP is a static header in public/_headers, so it can carry no per-build hash and an inline
            // script is simply blocked — which is how the header search toggle was shipping. Refusing to
            // inline JS keeps every script an external same-origin module that `script-src 'self'` admits.
            //
            // The `.length < 4096` branch restates Vite's own DEFAULT_ASSETS_INLINE_LIMIT: returning
            // undefined would make Astro's stylesheet path compare against `Number(fn)` — NaN — and stop
            // inlining every small stylesheet as a side effect.
            assetsInlineLimit: (filePath, content) =>
                filePath.endsWith(".js") ? false : content.length < 4096
        }
    }
})
