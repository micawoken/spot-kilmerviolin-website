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
