/**
 * pages/theme-head.css.ts
 *
 * Prerendered, build-time CSS file for the theme's site-wide @font-face rules and --dtk-* custom-property
 * block (theme-head.ts's fontFaceCss + tokenCss) — the two pieces of PublicPage's fused inline <style>
 * that are identical across every public page of a build, same as compositor.css was before it moved to
 * CompositorStyles.astro. Linked once from PublicPage.astro instead of duplicated inline on every page, so
 * the browser fetches it once (fetchPublishedTheme() is build-lifetime-memoized, so this costs no extra
 * theme read beyond what each page already pays) and reuses it across the whole site.
 *
 * columnsBreakpointCss and viewTransitionCss stay in PublicPage's inline block, not here — see that file
 * for why.
 *
 * No content hash in the filename (unlike the Vite-bundled /_astro/* chunks): this isn't compile-time
 * known, so Vite can't fingerprint it. Workers Static Assets' default `must-revalidate` cache policy
 * (public/_headers' header comment) covers correctness instead — a redeployed theme is never served stale,
 * it just costs a conditional-GET round trip instead of a free cache hit.
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
import type { APIRoute } from "astro"

import { getThemeHead } from "../lib/content/theme-head"

export const prerender = true

export const GET: APIRoute = async () => {
    const themeHead = await getThemeHead()
    const css = [themeHead.fontFaceCss, themeHead.tokenCss].filter(Boolean).join("\n\n")
    return new Response(css, { headers: { "Content-Type": "text/css; charset=utf-8" } })
}
