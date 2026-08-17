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
        // built HTML
        optimizeEmdashMedia(),
        // Resolves the published theme's self-hosted web fonts in a real-Node build hook
        themeFonts(),
        react(),
        markdoc(),
        // Fails the build if a prerendered page emits markup the public CSP in public/_headers blocks
        cspGuard(),
        // EmDash runs alongside the existing flat-file content readers during the staged migration; it does
        // not manage any route we render
        emdash({
            database: d1({ binding: "EMDASH_DB" }),
            // publicUrl makes EmDash resolve media to a public URL instead of the Access-gated
            // /_emdash/api/media/file proxy
            storage: r2({ binding: "EMDASH_MEDIA", publicUrl: process.env.EMDASH_MEDIA_PUBLIC_URL }),
            // KV object cache for EmDash's own request-time reads
            objectCache: kvCache({ binding: "KV_DB_CACHE" }),
            auth: access({
                teamDomain: "nrnnet.cloudflareaccess.com",
                audienceEnvVar: "CF_ACCESS_AUD",
                // EmDash Role.EDITOR default
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
            assetsInlineLimit: (filePath, content) =>
                filePath.endsWith(".js") ? false : content.length < 4096
        }
    }
})
