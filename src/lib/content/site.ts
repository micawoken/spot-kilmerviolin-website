/**
 * lib/content/site.ts
 *
 * Build-time accessor for the site-wide title/description authored in the CMS. The public site is
 * prerendered, so this runs during `astro build` and reads EmDash's built-in General Settings over its
 * HTTP API (see src/lib/build/emdash-api.ts), not the request-scoped `emdash` reader (which needs a bound
 * D1 unavailable at build). EmDash exposes `title` and `tagline` (there is no separate site description
 * field), so the meta description maps to `tagline`. Publishing a settings change requires a site rebuild.
 *
 * The values in src/consts.ts remain the fallback defaults: a blank CMS field — or an unavailable read —
 * falls back to the hardcoded constant rather than rendering an empty title/description. consts.ts is
 * still the source of truth for the admin UI and anywhere a synchronous import is needed.
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

import { fetchSettings } from "../build/emdash-api"
import { SITE_TITLE, SITE_DESCRIPTION } from "../../consts"

/** The resolved site-wide metadata. */
export interface SiteSettings {
    title: string
    description: string
}

/**
 * Returns the site title and description from EmDash's built-in General Settings, using the src/consts.ts
 * defaults when a field is blank or the settings are unavailable. The meta description maps to EmDash's
 * `tagline` (its settings have no dedicated description field). fetchSettings fails soft to {} on any read
 * error, so the defaults apply.
 *
 * @returns {Promise<SiteSettings>} the resolved title and description
 */
export async function getSiteSettings(): Promise<SiteSettings> {
    const settings = await fetchSettings()
    return {
        title: settings.title?.trim() || SITE_TITLE,
        description: settings.tagline?.trim() || SITE_DESCRIPTION
    }
}
