/**
 * lib/build/bundled-file-alt.ts
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

import { promises as fs } from "node:fs"
import path from "node:path"

// integrations/optimize-files.mjs's astro:build:done hook writes dist/files-manifest.json (with alt),
// but runs AFTER page rendering in the same `astro build` - too late for getStaticPaths. Reads the
// same src/files sidecar convention directly instead

const SRC_DIR = "src/files"
const RASTER_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"])

/**
 * Reads every bundled image's alt text from its src/files/<name>.txt sidecar, keyed by the name
 * optimize-files.mjs publishes it under (the /files/<key> suffix a D1 entity's `image` field stores).
 */
export async function loadBundledFileAlt(srcDir: string = SRC_DIR): Promise<Record<string, string>> {
    const alt: Record<string, string> = {}
    const src_root = path.resolve(srcDir)
    let entries
    try {
        entries = await fs.readdir(src_root, { withFileTypes: true })
    } catch {
        return alt
    }
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".txt")) continue
        const source_name = entry.name.slice(0, -4) // strip the sidecar's own ".txt"
        const ext = path.extname(source_name).toLowerCase()
        const published_name = RASTER_EXT.has(ext) ? `${source_name.slice(0, -ext.length)}.webp` : source_name
        let raw: string
        try {
            raw = await fs.readFile(path.join(src_root, entry.name), "utf-8")
        } catch {
            continue
        }
        const trimmed = raw.trim()
        if (trimmed !== "") {
            alt[published_name] = trimmed
        }
    }
    return alt
}
