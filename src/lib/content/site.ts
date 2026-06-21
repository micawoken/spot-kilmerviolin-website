/**
 * lib/content/site.ts
 *
 * Build-time accessor for the site-wide title/description authored in the CMS (the "site_settings" file,
 * stored at src/content/settings/site.json). Like the other CMS settings files the JSON is imported
 * directly so it is baked into the build (see lib/content/nav.ts for the rationale).
 *
 * The values in src/consts.ts remain the fallback defaults: a blank CMS field falls back to the
 * hardcoded constant rather than rendering an empty title/description. consts.ts is still the source of
 * truth for the admin UI and anywhere a synchronous import is needed.
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

import siteData from "../../content/settings/site.json"
import { SITE_TITLE, SITE_DESCRIPTION } from "../../consts"

/** The resolved site-wide metadata. */
export interface SiteSettings {
    title: string
    description: string
}

const data = siteData as { title?: string; description?: string }

/**
 * Returns the site title and description, using the src/consts.ts defaults when a CMS field is blank.
 *
 * @returns {SiteSettings} the resolved title and description
 */
export function getSiteSettings(): SiteSettings {
    return {
        title: data.title?.trim() || SITE_TITLE,
        description: data.description?.trim() || SITE_DESCRIPTION
    }
}
