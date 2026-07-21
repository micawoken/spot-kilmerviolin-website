/**
 * lib/build/theme-fonts.ts
 *
 * Self-hosts the design theme's Google Fonts (tokens.ts's `WebFont[]`) instead of the public site
 * linking straight to fonts.googleapis.com.
 *
 * Root cause this fixes: `webFontsHref`'s `display=optional` (chosen to kill the theme font's
 * initial-load layout shift, docs/dev/miscellaneous.txt's "initial load layout shift") gives the
 * browser only ~100ms to have the font ready at first paint, and Google's css2 stylesheet cannot be
 * `<link rel="preload">`d — its actual font-file URL isn't known until that stylesheet's own response
 * resolves. On a cold cache (first visit, or once the browser evicts the font) that extra round trip
 * routinely blows past 100ms, so the browser abandons the custom font for the rest of that page load —
 * "the font usually doesn't load". Self-hosting removes the round trip: each file is downloaded once
 * at build time, so the page can `<link rel="preload">` it directly, the same trick
 * `AdminTypeface.astro` already relies on for the self-hosted admin Inter face.
 *
 * Downloaded files are written to BOTH `public/fonts/theme/` and `dist/client/fonts/theme/`: `astro
 * dev` serves `public/` live, so a file only written there is enough locally; but for `astro build`,
 * Vite's client-asset build (which copies `publicDir`) finishes before pages are prerendered, so a
 * file written to `public/` mid-render would never reach the shipped `dist/client` — hence writing
 * directly into that directory too. `dist/client` mirrors wrangler.jsonc's `assets.directory` and
 * package.json's `pagefind --site dist/client`; if either changes, update FONT_DIR_SEGMENTS's callers.
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

import { webFontsHref, type WebFont } from "../compositor/tokens"

// Google serves woff/ttf to an unrecognized User-Agent and only serves woff2 (what we want to
// self-host) to a modern browser UA — Node's default fetch UA gets the legacy format.
const GOOGLE_FONTS_FETCH_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

// Google's own per-block subset names that get preloaded + font-display: optional (no flash, but only
// guaranteed to render if ready by first paint). Picked for a Western classical-music composer
// database, where accented Latin names (e.g. "Dvořák") are routine but other scripts are not. Every
// other subset (cyrillic, greek, vietnamese, …) still self-hosts and loads, just via
// font-display: swap and no preload — present, but not flash-guarded.
const PRELOADED_SUBSETS = new Set(["latin", "latin-ext"])

const FONT_DIR_SEGMENTS = ["fonts", "theme"] as const

export interface LocalizedFonts {
    /** inline `@font-face` rules, one per (family, weight, style, subset) Google block, rewritten to
     *  point at the locally self-hosted file. */
    fontFaceCss: string
    /** local `/fonts/theme/<hash>.woff2` paths to `<link rel="preload">`, one per preloaded subset. */
    preloadHrefs: string[]
}

/** Build-time cache backing {@link localizeThemeFonts}, the same rationale as design-api.ts's
 *  `themeCache`: every public page's render would otherwise re-fetch and re-download the same theme
 *  fonts once per page. */
let cache: Promise<LocalizedFonts | null> | null = null

/**
 * Self-hosts the theme's web fonts, memoized for the life of one build process.
 *
 * Fails soft: a fetch/parse/download problem for any reason resolves to `null` (with a console
 * warning), never throwing — the theme font is simply skipped for this build rather than breaking
 * every public page, matching `fetchPublishedTheme`'s contract.
 *
 * @param {WebFont[]} fonts - the theme's declared web fonts (`design_theme.tokens.fonts`)
 * @returns {Promise<LocalizedFonts | null>} the local `@font-face` CSS and preload hrefs, or null when
 *   there is no valid font or self-hosting failed
 */
export function localizeThemeFonts(fonts: WebFont[]): Promise<LocalizedFonts | null> {
    if (!cache) {
        cache = resolveLocalizedFonts(fonts)
    }
    return cache
}

async function resolveLocalizedFonts(fonts: WebFont[]): Promise<LocalizedFonts | null> {
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
            `[build/theme-fonts] could not fetch the theme's Google Fonts stylesheet (${reason}) — ` +
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
                    `${block.weight} ${block.style}) from Google Fonts (${reason}) — this block is SKIPPED.`
            )
            continue
        }
        const preload = PRELOADED_SUBSETS.has(block.subset)
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
 * Parses Google's css2 response into one entry per `/* subset *\/ @font-face { … }` block. Not a
 * general CSS parser — relies on Google's stable, machine-generated output shape (a subset comment
 * immediately before each block, exactly one `src: url(...)` per block).
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
 * Downloads a single Google-hosted font file and writes it to both `public/fonts/theme/` and
 * `dist/client/fonts/theme/` (see the file-level comment for why both). The filename is a hash of the
 * remote URL, which Google itself versions per family/weight/subset, so repeated downloads of the same
 * font are naturally content-addressed and idempotent.
 *
 * @param {string} url - the font file URL from a parsed Google `@font-face` block
 * @returns {Promise<string>} the local `/fonts/theme/<hash>.woff2` href
 */
async function downloadFont(url: string): Promise<string> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    const hash = createHash("sha256").update(url).digest("hex").slice(0, 20)
    const filename = `${hash}.woff2`
    const relDir = path.join(...FONT_DIR_SEGMENTS)
    for (const root of [path.resolve(process.cwd(), "public"), path.resolve(process.cwd(), "dist", "client")]) {
        const dir = path.join(root, relDir)
        await mkdir(dir, { recursive: true })
        await writeFile(path.join(dir, filename), bytes)
    }
    return `/${FONT_DIR_SEGMENTS.join("/")}/${filename}`
}
