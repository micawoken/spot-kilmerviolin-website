/**
 * tests/build/bundled-file-alt.test.ts
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

import { describe, it, expect, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"

import { loadBundledFileAlt } from "../../src/lib/build/bundled-file-alt"

let tmp_dir: string | null = null

async function makeTmpDir(): Promise<string> {
    tmp_dir = await fs.mkdtemp(path.join(os.tmpdir(), "bundled-file-alt-"))
    return tmp_dir
}

afterEach(async () => {
    if (tmp_dir) {
        await fs.rm(tmp_dir, { recursive: true, force: true })
        tmp_dir = null
    }
})

describe("loadBundledFileAlt", () => {
    it("returns an empty object when the directory does not exist", async () => {
        const alt = await loadBundledFileAlt("/does/not/exist")
        expect(Object.keys(alt)).toHaveLength(0)
    })

    it("keys a raster image's alt text by its published (.webp) name", async () => {
        const dir = await makeTmpDir()
        await fs.writeFile(path.join(dir, "composer-portrait.jpg.txt"), "Portrait of the composer")
        const alt = await loadBundledFileAlt(dir)
        expect(alt["composer-portrait.webp"]).toBe("Portrait of the composer")
    })

    it("keys a non-raster asset's alt text by its own (unchanged) name", async () => {
        const dir = await makeTmpDir()
        await fs.writeFile(path.join(dir, "logo.svg.txt"), "Site logo")
        const alt = await loadBundledFileAlt(dir)
        expect(alt["logo.svg"]).toBe("Site logo")
    })

    it("trims sidecar content and omits an empty sidecar", async () => {
        const dir = await makeTmpDir()
        await fs.writeFile(path.join(dir, "a.jpg.txt"), "  Padded alt  \n")
        await fs.writeFile(path.join(dir, "b.jpg.txt"), "   \n")
        const alt = await loadBundledFileAlt(dir)
        expect(alt["a.webp"]).toBe("Padded alt")
        expect("b.webp" in alt).toBe(false)
    })
})
