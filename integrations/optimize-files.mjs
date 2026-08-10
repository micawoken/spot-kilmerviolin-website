/**
 * integrations/optimize-files.mjs
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

// integrations/optimize-files.mjs
//
// Astro integration that publishes the build-time file pool in src/files.
//
// Every file in src/files is processed on `astro:build:done`: raster images are optimized with sharp
// (scaled down to a maximum width and re-encoded to WebP) and written to dist/files; SVGs and
// non-images are copied through unchanged. A manifest (dist/files-manifest.json) listing each
// published file is emitted for the admin file picker to read. All files are published even if no
// record references them.
//
// The optimization parameters mirror lib/api/images.ts so bundled assets and uploaded assets are
// optimized consistently. Like uploads, each raster image is cropped and scaled to exactly one of the two
// canonical shapes (portrait 1280x1600 or landscape 1600x1280); the closest shape to the source aspect is
// chosen, and a warning is emitted when the source is not already that ratio (since it will be cropped).
// The IMAGES binding used for uploads is a runtime-only Worker API and is not available during this Node
// build step, so sharp is used here instead.
//
// Alt text: every image asset (raster or
// SVG) must carry a sidecar text file at "<name>.txt" alongside it (e.g. photo.jpg's alt text lives in
// photo.jpg.txt) with 1-256 characters of alt text. A missing or oversized sidecar fails the build — this
// mirrors the R2 upload API's hard "alt is required" validation (see lib/api/validation.ts), just enforced
// at build time here since bundled assets are added by committing files, not through that endpoint.
// Non-image files (if any) are published without an alt requirement.

import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

// This build-time integration runs under Node (not the Worker runtime) and cannot read the Cloudflare
// `env`, so these mirror the runtime config literally: TARGET_QUALITY tracks the TARGET_IMAGE_QUALITY
// wrangler var, CANON tracks CANON_PORTRAIT / CANON_LANDSCAPE in src/lib/api/images.ts, and
// MAX_ALT_LENGTH tracks MAX_ALT_TEXT_LENGTH in src/consts.ts. Keep in sync.
const TARGET_QUALITY = 82
const CANON = { portrait: { w: 1280, h: 1600 }, landscape: { w: 1600, h: 1280 } }
const PORTRAIT_RATIO = CANON.portrait.w / CANON.portrait.h // 0.8
const LANDSCAPE_RATIO = CANON.landscape.w / CANON.landscape.h // 1.25
const MAX_ALT_LENGTH = 256

const SRC_DIR = "src/files"
const OUT_SUBDIR = "files"
const RASTER_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"])
const IMAGE_EXT = new Set([...RASTER_EXT, ".svg"])
const ALT_SIDECAR_EXT = ".txt"

/**
 * Reads and validates an image asset's required alt-text sidecar ("<name>.txt"), throwing a
 * build-blocking error when it is missing, empty, or over MAX_ALT_LENGTH characters.
 */
async function readAltSidecar(srcRoot, name) {
    const sidecarPath = path.join(srcRoot, `${name}${ALT_SIDECAR_EXT}`)
    let raw
    try {
        raw = await fs.readFile(sidecarPath, "utf-8")
    } catch {
        throw new Error(
            `[build] src/files/${name} is missing its required alt-text sidecar: src/files/${name}${ALT_SIDECAR_EXT} ` +
                `(1-${MAX_ALT_LENGTH} characters). Add the sidecar file or remove the image.`
        )
    }
    const alt = raw.trim()
    if (alt === "") {
        throw new Error(`[build] src/files/${name}${ALT_SIDECAR_EXT} is empty; alt text is required.`)
    }
    if (alt.length > MAX_ALT_LENGTH) {
        throw new Error(
            `[build] src/files/${name}${ALT_SIDECAR_EXT} is ${alt.length} characters; alt text must be ${MAX_ALT_LENGTH} or fewer.`
        )
    }
    return alt
}

export default function optimizeFiles() {
    return {
        name: "optimize-src-files",
        hooks: {
            "astro:build:done": async ({ dir, logger }) => {
                const out_root = fileURLToPath(dir) // the build output directory (dist)
                const src_root = path.resolve(SRC_DIR)
                let entries
                try {
                    entries = await fs.readdir(src_root, { withFileTypes: true })
                } catch {
                    logger.info("no src/files directory found; skipping file pool optimization")
                    return
                }
                const out_dir = path.join(out_root, OUT_SUBDIR)
                await fs.mkdir(out_dir, { recursive: true })
                const manifest = []
                for (const entry of entries) {
                    if (!entry.isFile()) {
                        continue
                    }
                    const name = entry.name
                    const ext = path.extname(name).toLowerCase()
                    // alt-text sidecars are metadata for another entry, not a publishable asset themselves
                    if (ext === ALT_SIDECAR_EXT) {
                        continue
                    }
                    const is_image = IMAGE_EXT.has(ext)
                    const alt = is_image ? await readAltSidecar(src_root, name) : null
                    const input = await fs.readFile(path.join(src_root, name))
                    if (RASTER_EXT.has(ext)) {
                        // crop+scale to the closest canonical shape, matching the upload pipeline (optimizeImage)
                        const meta = await sharp(input).metadata()
                        const ratio = meta.width && meta.height ? meta.width / meta.height : PORTRAIT_RATIO
                        const aspect = Math.abs(ratio - PORTRAIT_RATIO) <= Math.abs(ratio - LANDSCAPE_RATIO) ? "portrait" : "landscape"
                        const target = CANON[aspect]
                        // warn when the source isn't already the canonical ratio, since it will be center-cropped
                        if (Math.abs(ratio - target.w / target.h) > 1e-3) {
                            logger.warn(`${name}: aspect ${ratio.toFixed(3)} is neither 4:5 nor 5:4; after downscaling it will be center-cropped to ${aspect} (${target.w}x${target.h})`)
                        }
                        // enlarge a smaller source to fill the canvas (fit: cover) and sharpen to limit pixelation
                        const upscaling = (meta.width ?? 0) < target.w || (meta.height ?? 0) < target.h
                        let pipe = sharp(input).resize({ width: target.w, height: target.h, fit: "cover", position: "centre", withoutEnlargement: false })
                        if (upscaling) {
                            pipe = pipe.sharpen()
                        }
                        const out_bytes = await pipe.webp({ quality: TARGET_QUALITY }).toBuffer()
                        const out_name = `${name.slice(0, name.length - ext.length)}.webp`
                        await fs.writeFile(path.join(out_dir, out_name), out_bytes)
                        manifest.push({ name, url: `/${OUT_SUBDIR}/${out_name}`, w: target.w, h: target.h, alt })
                    } else {
                        // SVGs and non-images are published verbatim
                        await fs.writeFile(path.join(out_dir, name), input)
                        manifest.push({ name, url: `/${OUT_SUBDIR}/${name}`, w: null, h: null, alt })
                    }
                }
                await fs.writeFile(path.join(out_root, "files-manifest.json"), JSON.stringify(manifest, null, 2))
                logger.info(`published ${manifest.length} file(s) from src/files to ${OUT_SUBDIR}/`)
            }
        }
    }
}
