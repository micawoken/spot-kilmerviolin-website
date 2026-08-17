/**
 * lib/content/theme-head.ts
 *
 * Build-time accessor for the design theme's head contribution
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

import { fetchPublishedTheme } from "../build/design-api"
import themeFontManifest from "../build/theme-fonts-manifest.generated.json"
import { columnsStackBreakpointCss, EMPTY_TOKEN_CATALOG, tokensToCss, viewTransitionCss } from "../compositor/tokens"

/** The theme's contribution to a public page's <head>: web-font links plus the token custom properties. */
export interface ThemeHead {
    /** local `/fonts/theme/<hash>.woff2` hrefs to `<link rel="preload">`; empty when there is no font
     *  authored or self-hosting it failed for this build (see theme-fonts.ts). */
    preloadHrefs: readonly string[]
    /** inline `@font-face` rules for the theme's self-hosted web fonts, or "" when none apply */
    fontFaceCss: string
    /** the `:root { --dtk-* }` block for the published theme, or "" when no valid theme is published */
    tokenCss: string
    /** the `Columns` stacking `@media` rule (`columnsStackBreakpointCss`); always present, theme or not,
     *  since it replaces what used to be a hardcoded rule in the static `compositor.css`. */
    columnsBreakpointCss: string
    /** the `@view-transition { … }` rule (`viewTransitionCss`), or "" when the theme disables it; always
     *  enabled when no theme is published, matching the site's historical always-on `global.css` rule. */
    viewTransitionCss: string
}

// No published theme still needs the Columns breakpoint rule at its historical fixed cutoff, and view
// transitions default to enabled - both used to be unconditionally present in the static stylesheets,
// theme or not.
const NO_THEME_HEAD: ThemeHead = {
    preloadHrefs: [],
    fontFaceCss: "",
    tokenCss: "",
    columnsBreakpointCss: columnsStackBreakpointCss(EMPTY_TOKEN_CATALOG),
    viewTransitionCss: viewTransitionCss(EMPTY_TOKEN_CATALOG)
}

/**
 * Returns the published theme's web-font links, `--dtk-*` custom-property block, and Columns breakpoint
 * rule from a single theme read, or empty/fallback values when no theme is authored or the theme cannot
 * be read. Never throws - a theme-read failure degrades to the built-in chrome look rather than failing
 * the page build.
 *
 * @returns {Promise<ThemeHead>} the font links, token CSS, and breakpoint CSS to render into the head
 */
export async function getThemeHead(): Promise<ThemeHead> {
    try {
        const theme = await fetchPublishedTheme()
        if (!theme) return NO_THEME_HEAD
        return {
            preloadHrefs: themeFontManifest.preloadHrefs,
            fontFaceCss: themeFontManifest.fontFaceCss,
            tokenCss: tokensToCss(theme),
            columnsBreakpointCss: columnsStackBreakpointCss(theme),
            viewTransitionCss: viewTransitionCss(theme)
        }
    } catch {
        return NO_THEME_HEAD
    }
}
