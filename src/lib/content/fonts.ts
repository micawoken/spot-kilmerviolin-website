/**
 * lib/content/fonts.ts
 *
 * Build-time accessor for the site's web fonts, authored in the design theme (`design_theme.tokens.fonts`).
 * The public site is prerendered, so this runs during `astro build` and reads the published theme over
 * EmDash's HTTP API (see src/lib/build/design-api.ts, fetchPublishedTheme). Publishing a font change
 * requires a site rebuild.
 *
 * Fonts are a whole-site concern, so this is consumed by layouts/PublicPage.astro (every public page),
 * not only the compositor's design pages. It fails soft: any read error, a missing theme, or no fonts all
 * resolve to "no font links", so the font system can never break a public page build.
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
 *
 * This license is also subject to additional terms as specified in the README.md.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { fetchPublishedTheme } from "../build/design-api"
import { WEB_FONT_PRECONNECT_ORIGINS, webFontsHref } from "../compositor/tokens"

/** The head links needed to load the site's web fonts; empty when no font is authored. */
export interface WebFontLinks {
    /** origins to preconnect; empty when there is no stylesheet to load */
    preconnect: readonly string[]
    /** the Google Fonts stylesheet URL, or null when no font is authored */
    stylesheet: string | null
}

const NO_FONTS: WebFontLinks = { preconnect: [], stylesheet: null }

/**
 * Returns the preconnect + stylesheet links for the theme's web fonts, or empty links when none are
 * authored or the theme cannot be read. Never throws — a font-read failure degrades to system fonts
 * rather than failing the page build.
 *
 * @returns {Promise<WebFontLinks>} the font head links to render
 */
export async function getWebFontLinks(): Promise<WebFontLinks> {
    try {
        const theme = await fetchPublishedTheme()
        const stylesheet = theme ? webFontsHref(theme.fonts ?? []) : null
        return stylesheet ? { preconnect: WEB_FONT_PRECONNECT_ORIGINS, stylesheet } : NO_FONTS
    } catch {
        return NO_FONTS
    }
}
