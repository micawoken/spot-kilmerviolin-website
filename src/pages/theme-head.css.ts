/**
 * pages/theme-head.css.ts
 *
 * Prerendered, build-time CSS file for the theme's site-wide @font-face rules and --dtk-* custom-property
 * block
 *
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
