/**
 * lib/build/theme-fonts.ts
 *
 * Self-hosts the design theme's Google Fonts (tokens.ts's `WebFont[]`) instead of linking straight to
 * fonts.googleapis.com
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

import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { fontFaceKey, webFontsHref, type WebFont } from "../compositor/tokens"

// Google serves woff/ttf to an unrecognized User-Agent and only serves woff2 to modern browsers
const GOOGLE_FONTS_FETCH_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

// Preloaded + font-display
const PRELOADED_SUBSETS = new Set(["latin", "latin-ext"])

/** Whether this face is one the theme's typography tokens actually reference (`referencedFontFaces`) */
function isReferenced(referencedFaces: ReadonlySet<string>, block: ParsedFontFaceBlock): boolean {
    return referencedFaces.size === 0 || referencedFaces.has(fontFaceKey(block.family, block.weight))
}

const FONT_DIR_SEGMENTS = ["fonts", "theme"] as const

export interface LocalizedFonts {
    /** inline `@font-face` rules, one per (family, weight, style, subset) Google block, rewritten to
     *  point at the locally self-hosted file. */
    fontFaceCss: string
    /** local `/fonts/theme/<hash>.woff2` paths to `<link rel="preload">`, one per preloaded subset of a
     *  face the theme's typography tokens reference. */
    preloadHrefs: string[]
}

/**
 * Font URLs declared `font-display: optional` that carry no matching preload
 *
 * @param {LocalizedFonts} fonts - a resolved manifest
 * @returns {string[]} offending font URLs, empty when the invariant holds
 */
export function unpreloadedOptionalFaces(fonts: LocalizedFonts): string[] {
    const preloaded = new Set(fonts.preloadHrefs)
    const offenders: string[] = []
    for (const [, body] of fonts.fontFaceCss.matchAll(/@font-face\{([^}]*)\}/g)) {
        if (!/font-display:\s*optional/.test(body)) continue
        const url = body.match(/url\("([^"]+)"\)/)?.[1]
        if (url && !preloaded.has(url)) offenders.push(url)
    }
    return offenders
}

/**
 * Self-hosts the theme's web fonts
 *
 * @param {WebFont[]} fonts - the theme's authored web fonts
 * @param {ReadonlySet<string>} referencedFaces - `fontFaceKey` values worth preloading; empty preloads all
 */
export async function localizeThemeFonts(
    fonts: WebFont[],
    referencedFaces: ReadonlySet<string> = new Set()
): Promise<LocalizedFonts | null> {
    const href = webFontsHref(fonts)
    if (!href) return null

    let css: string
    try {
        const res = await fetch(href, { headers: { "User-Agent": GOOGLE_FONTS_FETCH_UA } })
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        css = await res.text()
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        console.warn(
            `[build/theme-fonts] could not fetch the theme's Google Fonts stylesheet (${reason}) - ` +
                "the theme font is SKIPPED for this build."
        )
        return null
    }

    const blocks = parseFontFaceBlocks(css)
    if (blocks.length === 0) return null

    const cssParts: string[] = []
    const preloadHrefs: string[] = []
    for (const block of blocks) {
        let localHref: string
        try {
            localHref = await downloadFont(block.url)
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            console.warn(
                `[build/theme-fonts] could not download "${block.family}" (${block.subset}, ` +
                    `${block.weight} ${block.style}) from Google Fonts (${reason}) - this block is SKIPPED.`
            )
            continue
        }
        const preload = PRELOADED_SUBSETS.has(block.subset) && isReferenced(referencedFaces, block)
        if (preload) preloadHrefs.push(localHref)
        cssParts.push(
            `@font-face{font-family:"${block.family}";src:url("${localHref}") format("woff2");` +
                `font-weight:${block.weight};font-style:${block.style};unicode-range:${block.unicodeRange};` +
                `font-display:${preload ? "optional" : "swap"};}`
        )
    }
    if (cssParts.length === 0) return null
    return { fontFaceCss: cssParts.join("\n"), preloadHrefs }
}

interface ParsedFontFaceBlock {
    family: string
    subset: string
    weight: string
    style: string
    unicodeRange: string
    url: string
}

/**
 * Parses Google's css2 response into one entry per `/* subset *\/ @font-face { … }` block
 */
function parseFontFaceBlocks(css: string): ParsedFontFaceBlock[] {
    const blocks: ParsedFontFaceBlock[] = []
    const blockPattern = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g
    for (const match of css.matchAll(blockPattern)) {
        const [, subset, body] = match
        const family = body.match(/font-family:\s*'([^']+)'/)?.[1]
        const style = body.match(/font-style:\s*(\w+)/)?.[1]
        const weight = body.match(/font-weight:\s*([\d\s]+)/)?.[1]?.trim()
        const url = body.match(/src:\s*url\(([^)]+)\)/)?.[1]
        const unicodeRange = body.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim()
        if (!family || !style || !weight || !url || !unicodeRange) continue
        blocks.push({ family, subset, weight, style, unicodeRange, url })
    }
    return blocks
}

/**
 * Downloads one Google-hosted font file, writes it to `public/fonts/theme/`
 */
async function downloadFont(url: string): Promise<string> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    const hash = createHash("sha256").update(url).digest("hex").slice(0, 20)
    const filename = `${hash}.woff2`
    const dir = path.resolve(process.cwd(), "public", ...FONT_DIR_SEGMENTS)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, filename), bytes)
    return `/${FONT_DIR_SEGMENTS.join("/")}/${filename}`
}
