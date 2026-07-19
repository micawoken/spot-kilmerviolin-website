/**
 * lib/content/theme-head.ts
 *
 * Build-time accessor for the design theme's whole-page head contribution: the site-wide web-font links
 * (`design_theme.tokens.fonts`) and the `--dtk-*` custom-property block (`tokensToCss`). Both are site-wide
 * concerns — the fonts because a family is loaded once for the document, and the tokens because the public
 * chrome (layouts/PublicPage → styles/public-chrome.css) now binds `body`, the header, and the footer to
 * them, not only the compositor's design pages. So this is consumed by layouts/PublicPage.astro (every
 * public page) from a single `fetchPublishedTheme()` read.
 *
 * The public site is prerendered, so this runs during `astro build` and reads the published theme over
 * EmDash's HTTP API (see src/lib/build/design-api.ts, fetchPublishedTheme). Publishing a theme change
 * requires a site rebuild.
 *
 * It fails soft: any read error, a missing theme, or an invalid catalog all resolve to "no links, no
 * tokens", so the theme system can never break a public page build — the chrome simply falls back to its
 * built-in styles/global.css look (every `--dtk-*` binding carries a `--color-*` fallback).
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
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

import { fetchPublishedTheme } from "../build/design-api"
import {
    columnsStackBreakpointCss,
    EMPTY_TOKEN_CATALOG,
    tokensToCss,
    WEB_FONT_PRECONNECT_ORIGINS,
    webFontsHref
} from "../compositor/tokens"

/** The theme's contribution to a public page's <head>: web-font links plus the token custom properties. */
export interface ThemeHead {
    /** origins to preconnect before the font stylesheet; empty when there is no stylesheet to load */
    preconnect: readonly string[]
    /** the Google Fonts stylesheet URL, or null when no font is authored */
    stylesheet: string | null
    /** the `:root { --dtk-* }` block for the published theme, or "" when no valid theme is published */
    tokenCss: string
    /** the `Columns` stacking `@media` rule (`columnsStackBreakpointCss`); always present, theme or not,
     *  since it replaces what used to be a hardcoded rule in the static `compositor.css`. */
    columnsBreakpointCss: string
}

// No published theme still needs the Columns breakpoint rule at its historical fixed cutoff — it used to
// be unconditionally present in the static compositor.css, theme or not.
const NO_THEME_HEAD: ThemeHead = {
    preconnect: [],
    stylesheet: null,
    tokenCss: "",
    columnsBreakpointCss: columnsStackBreakpointCss(EMPTY_TOKEN_CATALOG)
}

/**
 * Returns the published theme's web-font links, `--dtk-*` custom-property block, and Columns breakpoint
 * rule from a single theme read, or empty/fallback values when no theme is authored or the theme cannot
 * be read. Never throws — a theme-read failure degrades to the built-in chrome look rather than failing
 * the page build.
 *
 * @returns {Promise<ThemeHead>} the font links, token CSS, and breakpoint CSS to render into the head
 */
export async function getThemeHead(): Promise<ThemeHead> {
    try {
        const theme = await fetchPublishedTheme()
        if (!theme) return NO_THEME_HEAD
        const stylesheet = webFontsHref(theme.fonts ?? [])
        return {
            preconnect: stylesheet ? WEB_FONT_PRECONNECT_ORIGINS : [],
            stylesheet,
            tokenCss: tokensToCss(theme),
            columnsBreakpointCss: columnsStackBreakpointCss(theme)
        }
    } catch {
        return NO_THEME_HEAD
    }
}
