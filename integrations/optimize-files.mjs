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
// optimized consistently. The IMAGES binding used for uploads is a runtime-only Worker API and is not
// available during this Node build step, so sharp is used here instead.

import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

// keep these in sync with the exports of src/lib/api/images.ts
const MAX_IMAGE_WIDTH = 1600
const TARGET_QUALITY = 82

const SRC_DIR = "src/files"
const OUT_SUBDIR = "files"
const RASTER_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"])

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
                    const input = await fs.readFile(path.join(src_root, name))
                    if (RASTER_EXT.has(ext)) {
                        // optimize: width-capped (never enlarged) WebP, matching the upload pipeline
                        const out_bytes = await sharp(input)
                            .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
                            .webp({ quality: TARGET_QUALITY })
                            .toBuffer()
                        const meta = await sharp(out_bytes).metadata()
                        const out_name = `${name.slice(0, name.length - ext.length)}.webp`
                        await fs.writeFile(path.join(out_dir, out_name), out_bytes)
                        manifest.push({ name, url: `/${OUT_SUBDIR}/${out_name}`, w: meta.width ?? null, h: meta.height ?? null })
                    } else {
                        // SVGs and non-images are published verbatim
                        await fs.writeFile(path.join(out_dir, name), input)
                        manifest.push({ name, url: `/${OUT_SUBDIR}/${name}`, w: null, h: null })
                    }
                }
                await fs.writeFile(path.join(out_root, "files-manifest.json"), JSON.stringify(manifest, null, 2))
                logger.info(`published ${manifest.length} file(s) from src/files to ${OUT_SUBDIR}/`)
            }
        }
    }
}
