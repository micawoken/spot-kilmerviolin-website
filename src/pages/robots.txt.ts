/**
 * pages/robots.txt.ts
 *
 * Generates a dynamic robots.txt with a default-deny based on env
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
import type { APIRoute } from "astro"

export const prerender = true

const allowIndexing = (import.meta.env.SITE_ALLOW_INDEXING ?? process.env.SITE_ALLOW_INDEXING) === "true"

export const GET: APIRoute = ({ site }) => {
    const body = allowIndexing
        ? `User-agent: *\nDisallow:\n\nSitemap: ${new URL("/sitemap.xml", site).href}\n`
        : `#  indexing is disabled by config\nUser-agent: *\nDisallow: /\n`

    return new Response(body, { headers: { "Content-Type": "text/plain" } })
}
