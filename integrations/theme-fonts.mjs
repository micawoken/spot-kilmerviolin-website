/**
 * integrations/theme-fonts.mjs
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

// Astro integration that resolves the published theme's self-hosted web fonts (src/lib/build/theme-fonts.ts)
// and writes the result to src/lib/build/theme-fonts-manifest.generated.json for theme-head.ts to pick up
// as a plain source import.
//
// This has to be a build-time hook, not code that runs as part of a page's own render: @astrojs/cloudflare
// prerenders pages by dispatching them to an actual workerd instance (its own prerenderer.d.ts says so
// explicitly — "prerendering happens in the same runtime that will serve the pages"), and workerd has no
// writable local disk. localizeThemeFonts's mkdir/writeFile calls throw EPERM ("operation not permitted")
// every time when invoked from there — confirmed against the live theme, where every one of its font
// blocks was silently SKIPPED on every build. Running the download here instead, in astro:build:start /
// astro:server:setup, means it executes in the real Node process Astro itself runs in, where fs access
// works normally. theme-head.ts then statically imports the resulting manifest — Vite resolves that import
// while bundling the server code, before the prerenderer's workerd instance ever starts, so the page-render
// code never touches the filesystem at all.
//
// astro:build:start fires before Vite's client-asset build copies publicDir into dist/client, so writing
// the font files to public/fonts/theme/ is enough — that copy step picks them up on its own (see
// theme-fonts.ts for why only that one directory is written).
//
// Deliberately calls emdashGet directly rather than design-api.ts's fetchPublishedTheme(): that wrapper
// memoizes its result in a module-level `themeCache` for the life of one build process ("every public
// page's render would otherwise re-fetch... once per page"). This hook and the later per-page prerender
// render (inside the workerd sandbox — see theme-fonts.ts) both end up sharing that one build process,
// so calling the memoized wrapper here caches its result and the real prerender render never gets its own
// attempt — confirmed the hard way: this used to call fetchPublishedTheme(), which made this hook's own
// resolution "stick" as the ONLY theme read for the whole build, permanently reporting "CONTENT_API_BASE
// is unset" for every page even though it very much was set. emdashGet itself does no such memoization
// (only a "don't repeat this warning" flag), so calling it directly here can't poison anything later.
//
// Also loads .env itself before calling emdashGet: at astro:build:start, this file has been loaded
// through Astro's own (non-Vite) module resolution, not Vite's SSR pipeline, so import.meta.env/
// process.env don't have .env's values yet the way a page's own frontmatter (bundled by Vite later)
// does — confirmed the hard way too: even after fixing the poisoning above, this hook's own emdashGet
// call kept reporting CONTENT_API_BASE unset while the real prerender, moments later, read it fine.
// `vite`'s own loadEnv would do this, but pnpm's strict linking makes `vite` itself unresolvable from
// here (it's astro's transitive dependency, not this project's) — so this is a deliberately minimal
// parser rather than a new direct dependency on it.

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { emdashGet } from "../src/lib/build/emdash-api.ts"
import { isTokenCatalog } from "../src/lib/compositor/tokens.ts"
import { localizeThemeFonts } from "../src/lib/build/theme-fonts.ts"

const MANIFEST_PATH = fileURLToPath(new URL("../src/lib/build/theme-fonts-manifest.generated.json", import.meta.url))

export default function themeFonts() {
    return {
        name: "theme-fonts",
        hooks: {
            "astro:build:start": async ({ logger }) => resolveAndWrite(logger),
            "astro:server:setup": async ({ logger }) => resolveAndWrite(logger)
        }
    }
}

/** A minimal KEY=VALUE .env reader — comments and blank lines skipped, values optionally quoted. Merges
 *  into process.env without overwriting a value already set there (e.g. by an actual CI env var). */
async function loadDotEnv() {
    let text
    try {
        text = await readFile(path.resolve(process.cwd(), ".env"), "utf-8")
    } catch {
        return
    }
    for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith("#")) continue
        const eq = trimmed.indexOf("=")
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }
        process.env[key] ??= value
    }
}

async function resolveAndWrite(logger) {
    await loadDotEnv()

    let manifest = { fontFaceCss: "", preloadHrefs: [] }
    try {
        const result = await emdashGet("/_emdash/api/content/design_theme?status=published&limit=1")
        const tokens = result?.items?.[0]?.data?.tokens
        const localized = isTokenCatalog(tokens) ? await localizeThemeFonts(tokens.fonts ?? []) : null
        if (localized) manifest = localized
    } catch (error) {
        logger.warn(
            `[theme-fonts] could not resolve the theme's web fonts (${error instanceof Error ? error.message : String(error)}) — continuing without one.`
        )
    }
    await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
}
