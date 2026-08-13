/**
 * content.config.ts
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

import { glob } from "astro/loaders"
import { defineCollection } from "astro:content"
import { z } from "astro/zod"

const docs = defineCollection({
    loader: glob({ base: "./src/content/docs", pattern: "**/*.md" }),
    schema: z.object({
        title: z.string(),
        description: z.string(),
        author: z.string()
    })
})

// The public-facing `pages` collection moved from flat markdoc files into EmDash (the `pages` content type
// in EMDASH_DB) and is prerendered: src/pages/[...slug].astro reads it at build time over EmDash's HTTP
// API (src/lib/build/emdash-api.ts). Only the internal developer `docs` collection remains a build-time
// flat-file collection here.
export const collections = { docs }
