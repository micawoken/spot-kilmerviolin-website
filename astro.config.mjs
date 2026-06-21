/**
 * astro.config.mjs
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

// @ts-check
import { defineConfig } from "astro/config"
import mdx from "@astrojs/mdx"
import sitemap from "@astrojs/sitemap"

import cloudflare from "@astrojs/cloudflare"

import optimizeFiles from "./integrations/optimize-files.mjs"

import react from "@astrojs/react"
import markdoc from "@astrojs/markdoc"

// https://astro.build/config
export default defineConfig({
    site: "https://example.com", // will set later
    integrations: [mdx(), sitemap(), optimizeFiles(), react(), markdoc()],
    adapter: cloudflare(),
    trailingSlash: "never",
    output: "server", // prerender needs to be enabled on the relevant pages
    redirects: {
        "/admin/logout": "/cdn-cgi/access/logout" // Cloudflare Access logout
    },
    security: {
        allowedDomains: [
            {
                hostname: "example.com", // will set later
                protocol: "https"
            },
            {
                hostname: "www.example.com", // will set later
                protocol: "https"
            }
        ],
        checkOrigin: import.meta.env.PROD
    }
})
