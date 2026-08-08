/**
 * integrations/optimize-emdash-media.mjs
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

// integrations/optimize-emdash-media.mjs
//
// Astro integration that re-encodes EmDash-sourced media referenced by the built site.
//
// EmDash (the CMS) manages its own media bucket (EMDASH_MEDIA, publicUrl EMDASH_MEDIA_PUBLIC_URL) and its
// own upload pipeline — unlike this project's own R2_FILES bucket, which every upload already passes
// through optimizeImage (lib/api/images.ts, re-encoded to webp / capped at MAX_IMAGE_WIDTH). EmDash media
// referenced by a compositor Image/ContentImage/MediaText component (lib/compositor/catalog.tsx) is
// therefore the R2 original untouched — a Lighthouse audit on / flagged exactly this: a several-hundred-KB
// JPEG shipped at full resolution to every viewport.
//
// This mirrors optimize-files.mjs's approach (same sharp constants: TARGET_QUALITY, capped long edge) but
// can't reuse its build-start timing or its input (a fixed local src/files directory) — the set of EmDash
// media a build actually references isn't known ahead of render; it depends on which designs are published
// and what an editor picked in the compositor. Rather than duplicating getStaticPaths' page/template/entry
// enumeration just to predict that set, this runs at astro:build:done and scans the ALREADY-RENDERED HTML
// for `<img src="...">` pointing at the EmDash media origin — the emitted markup is authoritative for what
// a page actually references, covers every current and future consumer (Image, ContentImage, MediaText)
// uniformly, and needs no change to catalog.tsx/media.ts's render path. `og:image`/`twitter:image` meta
// tags use `content=`, not `src=`, so they're untouched by design — those want full quality, not a capped
// thumbnail.
//
// Fails soft per image, same contract as theme-fonts.ts: a fetch/decode error leaves that one image's
// `src` pointing at the original EMDASH_MEDIA_PUBLIC_URL rather than failing the build. An unset
// EMDASH_MEDIA_PUBLIC_URL (local dev without it configured) skips the integration entirely.
//
// Output is content-hashed (sha256 of the source URL, matching theme-fonts.ts's filename scheme) under
// dist/client/images/emdash/ — public/_headers marks that path immutable, same as /fonts/*.

import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import sharp from "sharp"

// Mirrors optimize-files.mjs's TARGET_QUALITY (itself mirroring TARGET_IMAGE_QUALITY / lib/api/images.ts).
const TARGET_QUALITY = 82
// Mirrors the MAX_IMAGE_WIDTH wrangler var / CANON_* long edge in lib/api/images.ts — this project's
// existing ceiling for "how big does a rendered image ever need to be".
const MAX_LONG_EDGE = 1600
const OUT_SUBDIR = "images/emdash"
// EmDash storage keys are `{ulid}{ext}` (media.ts) — the extension is always present in the URL. Anything
// outside this set (an SVG icon, an unrecognized type) passes through unrewritten rather than risk a bad
// rasterization.
const RASTER_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"])

async function findHtmlFiles(root) {
    const out = []
    async function walk(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                await walk(full)
            } else if (entry.name.endsWith(".html")) {
                out.push(full)
            }
        }
    }
    await walk(root)
    return out
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export default function optimizeEmdashMedia() {
    return {
        name: "optimize-emdash-media",
        hooks: {
            "astro:build:done": async ({ dir, logger }) => {
                const mediaBaseUrl = process.env.EMDASH_MEDIA_PUBLIC_URL
                if (!mediaBaseUrl) {
                    logger.info("EMDASH_MEDIA_PUBLIC_URL not set; skipping EmDash media optimization")
                    return
                }
                let originPrefix
                try {
                    originPrefix = `${new URL(mediaBaseUrl).origin}/`
                } catch {
                    logger.warn(
                        `EMDASH_MEDIA_PUBLIC_URL ("${mediaBaseUrl}") is not a valid URL; skipping EmDash media optimization`
                    )
                    return
                }

                const out_root = fileURLToPath(dir)
                const html_files = await findHtmlFiles(out_root)

                const src_re = new RegExp(`src="(${escapeRegExp(originPrefix)}[^"]+)"`, "g")
                const referenced = new Set()
                const fileContents = new Map()
                for (const file of html_files) {
                    const html = await fs.readFile(file, "utf-8")
                    fileContents.set(file, html)
                    for (const match of html.matchAll(src_re)) {
                        referenced.add(match[1])
                    }
                }
                if (referenced.size === 0) {
                    logger.info("no EmDash media referenced in the built output; skipping EmDash media optimization")
                    return
                }

                const out_dir = path.join(out_root, OUT_SUBDIR)
                await fs.mkdir(out_dir, { recursive: true })

                const rewrites = new Map()
                for (const url of referenced) {
                    let ext
                    try {
                        ext = path.extname(new URL(url).pathname).toLowerCase()
                    } catch {
                        continue
                    }
                    if (!RASTER_EXT.has(ext)) {
                        continue
                    }
                    try {
                        const res = await fetch(url)
                        if (!res.ok) {
                            throw new Error(`${res.status} ${res.statusText}`)
                        }
                        const input = Buffer.from(await res.arrayBuffer())
                        const out_bytes = await sharp(input)
                            .resize({
                                width: MAX_LONG_EDGE,
                                height: MAX_LONG_EDGE,
                                fit: "inside",
                                withoutEnlargement: true
                            })
                            .webp({ quality: TARGET_QUALITY })
                            .toBuffer()
                        const hash = createHash("sha256").update(url).digest("hex").slice(0, 20)
                        const out_name = `${hash}.webp`
                        await fs.writeFile(path.join(out_dir, out_name), out_bytes)
                        rewrites.set(url, `/${OUT_SUBDIR}/${out_name}`)
                    } catch (error) {
                        const reason = error instanceof Error ? error.message : String(error)
                        logger.warn(
                            `could not optimize EmDash media "${url}" (${reason}) — page(s) referencing it keep the original R2 URL`
                        )
                    }
                }
                if (rewrites.size === 0) {
                    logger.info("no EmDash media could be optimized; skipping HTML rewrite")
                    return
                }

                let rewritten_files = 0
                for (const [file, html] of fileContents) {
                    let next = html
                    let changed = false
                    for (const [original, local] of rewrites) {
                        const needle = `src="${original}"`
                        if (next.includes(needle)) {
                            next = next.split(needle).join(`src="${local}"`)
                            changed = true
                        }
                    }
                    if (changed) {
                        await fs.writeFile(file, next)
                        rewritten_files++
                    }
                }
                logger.info(
                    `optimized ${rewrites.size} EmDash media image(s) (of ${referenced.size} referenced), rewritten across ${rewritten_files} page(s)`
                )
            }
        }
    }
}
