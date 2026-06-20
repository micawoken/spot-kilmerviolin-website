/**
 * content.config.ts
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

import { glob } from "astro/loaders"
import { defineCollection } from "astro:content"
import { z } from "astro/zod"

const docs = defineCollection({
    loader: glob({ base: "./src/content/docs", pattern: "**/*.{md,mdx}" }),
    schema: z.object({
        title: z.string(),
        description: z.string(),
        author: z.string()
    })
})

export const collections = { docs }
