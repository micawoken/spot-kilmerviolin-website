/**
 * tests/image-format-block.test.ts
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

/**
 * Regression coverage for the interim mitigation of security audit SEC-001.
 *
 * `image-size@2.0.2` has no published fix for its ICNS (GHSA-w3rx-r6r6-pgpr) or JXL/HEIF
 * (GHSA-5p2g-fcmc-qvqq) infinite loops, and EmDash calls it on every upload, so the formats that reach
 * those parsers are refused first. An attacker controls both the declared MIME type and the filename, so
 * the magic-number cases are the ones that matter.
 */

import { describe, it, expect } from "vitest"
import { isBlockedImage } from "../src/middleware/emdash_media_capacity"

const ASCII = new TextEncoder()

/** Builds a file whose declared type and name are deliberately innocuous, so only the bytes decide. */
function fileWithMagic(magic: Uint8Array, name = "innocent.png", type = "image/png"): File {
    const bytes = new Uint8Array(32)
    bytes.set(magic, 0)
    return new File([bytes], name, { type })
}

/** An ISOBMFF header: a four-byte box length, the "ftyp" box type, then the four-character major brand. */
function ftyp(brand: string): Uint8Array {
    const bytes = new Uint8Array(16)
    bytes.set(ASCII.encode("ftyp"), 4)
    bytes.set(ASCII.encode(brand), 8)
    return bytes
}

describe("isBlockedImage", () => {
    it("allows the formats the site actually publishes", async () => {
        const png = fileWithMagic(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        const jpeg = fileWithMagic(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "photo.jpg", "image/jpeg")
        const webp = fileWithMagic(ASCII.encode("RIFF    WEBP"), "photo.webp", "image/webp")
        expect(await isBlockedImage(png)).toBe(false)
        expect(await isBlockedImage(jpeg)).toBe(false)
        expect(await isBlockedImage(webp)).toBe(false)
    })

    it("blocks an ICNS payload disguised as a PNG", async () => {
        expect(await isBlockedImage(fileWithMagic(ASCII.encode("icns")))).toBe(true)
    })

    it("blocks a bare JXL codestream disguised as a PNG", async () => {
        expect(await isBlockedImage(fileWithMagic(new Uint8Array([0xff, 0x0a])))).toBe(true)
    })

    it("blocks a JXL container disguised as a PNG", async () => {
        // the ISOBMFF JXL signature box: a 12-byte length, then "JXL " as the box type
        const container = new Uint8Array(16)
        container.set(ASCII.encode("    JXL "), 0)
        expect(await isBlockedImage(fileWithMagic(container))).toBe(true)
    })

    it("blocks every HEIF-family brand that reaches the vulnerable parser", async () => {
        for (const brand of ["avif", "heic", "heix", "hevc", "hevx", "mif1", "msf1"]) {
            expect(await isBlockedImage(fileWithMagic(ftyp(brand)))).toBe(true)
        }
    })

    it("does not block an unrelated ISOBMFF brand", async () => {
        expect(await isBlockedImage(fileWithMagic(ftyp("isom"), "clip.mp4", "video/mp4"))).toBe(false)
    })

    it("blocks on the declared MIME type even when the bytes are unreadable", async () => {
        expect(await isBlockedImage(new File([new Uint8Array(4)], "x", { type: "image/heic" }))).toBe(true)
        expect(await isBlockedImage(new File([new Uint8Array(4)], "x", { type: "image/jxl; q=1" }))).toBe(true)
        expect(await isBlockedImage(new File([new Uint8Array(4)], "x", { type: "IMAGE/AVIF" }))).toBe(true)
    })

    it("blocks on the file extension even when the type is innocuous", async () => {
        for (const extension of [".avif", ".heic", ".heif", ".icns", ".jxl"]) {
            const file = new File([new Uint8Array(4)], `upload${extension}`, { type: "image/png" })
            expect(await isBlockedImage(file)).toBe(true)
        }
    })

    it("handles a file shorter than the sniffed header without throwing", async () => {
        expect(await isBlockedImage(new File([new Uint8Array(2)], "tiny.png", { type: "image/png" }))).toBe(false)
        expect(await isBlockedImage(new File([], "empty.png", { type: "image/png" }))).toBe(false)
    })
})
