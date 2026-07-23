/**
 * lib/build/theme-fonts.ts
 *
 * Self-hosts the design theme's Google Fonts (tokens.ts's `WebFont[]`) instead of linking straight to
 * fonts.googleapis.com.
 *
 * Root cause fixed: `webFontsHref`'s `display=optional` (kills theme-font initial-load layout shift,
 * docs/dev/miscellaneous.txt "initial load layout shift") gives the browser only ~100ms to have the
 * font ready at first paint, but Google's css2 stylesheet can't be `<link rel="preload">`d — the actual
 * font-file URL isn't known until that stylesheet's response resolves. Cold cache (first visit, or
 * evicted font): that round trip routinely blows past 100ms, browser abandons the custom font for the
 * rest of the page load. Self-hosting removes the round trip: each file downloaded once at build time,
 * page can preload it directly — same trick `AdminTypeface.astro` uses for the self-hosted admin Inter.
 *
 * MUST run from a real-Node context, never page-render code: `@astrojs/cloudflare` prerenders by
 * sending requests to an actual workerd instance (prerenderer.d.ts: "prerendering happens in the same
 * runtime that will serve the pages"), and workerd has no writable local disk. `node:fs`
 * `mkdir`/`writeFile` from a `.astro` page's frontmatter (runs inside that sandbox during both
 * `astro build`'s prerender step and `astro dev`) throws EPERM for every font block — confirmed live:
 * calling this straight from `theme-head.ts`/`PublicPage.astro` silently produced ZERO font files every
 * build, permanently falling back to the typography token's next stack entry. Why `getThemeHead` no
 * longer imports `localizeThemeFonts` directly — `integrations/theme-fonts.mjs` calls it instead from
 * `astro:build:start`/`astro:server:setup` hooks (always the real orchestrating Node process), writes
 * the result to `theme-fonts-manifest.generated.json` for `theme-head.ts` to pick up via a plain source
 * import — resolved by Vite while bundling server code, before the prerenderer's workerd ever starts,
 * so page-render code never touches the filesystem.
 *
 * Written to `public/fonts/theme/` only: the build-start hook fires before Vite's client-asset build
 * copies `publicDir` into `dist/client`, so that copy step picks the files up on its own.
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

// Preloaded + font-display: optional (no flash, only guaranteed ready by first paint). Picked for a
// Western classical-music composer database — accented Latin (e.g. "Dvořák") routine, other scripts
// not. Every other subset (cyrillic, greek, vietnamese, …) still self-hosts, via swap, no preload.
const PRELOADED_SUBSETS = new Set(["latin", "latin-ext"])

const FONT_DIR_SEGMENTS = ["fonts", "theme"] as const

export interface LocalizedFonts {
    /** inline `@font-face` rules, one per (family, weight, style, subset) Google block, rewritten to
     *  point at the locally self-hosted file. */
    fontFaceCss: string
    /** local `/fonts/theme/<hash>.woff2` paths to `<link rel="preload">`, one per preloaded subset. */
    preloadHrefs: string[]
}

/**
 * Self-hosts the theme's web fonts. Call once per build/dev-server start (file header: must run from a
 * real-Node build hook, not page-render code) — does its own network I/O and disk writes each call, no
 * memoization of its own.
 *
 * Fails soft: fetch/parse/download problem resolves to `null` (+ console warning), never throws — the
 * theme font is skipped for this build rather than breaking every public page, matching
 * `fetchPublishedTheme`'s contract.
 */
export async function localizeThemeFonts(fonts: WebFont[]): Promise<LocalizedFonts | null> {
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
 * Downloads one Google-hosted font file, writes it to `public/fonts/theme/` (file header: why only
 * that directory, why this must run from a real-Node build hook). Filename is a hash of the remote
 * URL — Google versions the URL per family/weight/subset, so repeated downloads are naturally
 * content-addressed and idempotent.
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
