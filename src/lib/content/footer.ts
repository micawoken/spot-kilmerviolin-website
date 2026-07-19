/**
 * lib/content/footer.ts
 *
 * Build-time accessor for the static footer content. EmDash has no footer concept, so the footer reuses
 * its built-in General Settings (read over the HTTP API, see src/lib/build/emdash-api.ts fetchSettings):
 * the copyright organization is the site `title` and the footer line is the site `tagline`. The public
 * site is prerendered, so publishing a settings change requires a site rebuild. The copyright year is
 * computed at render time in the footer component; only the static parts (organization, tagline) live here.
 *
 * Consumed by components/PublicFooter.astro.
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

import { fetchSettings } from "../build/emdash-api"
import { SITE_TITLE } from "../../consts"

/** The resolved footer content; a field is null when left blank in the CMS. */
export interface FooterContent {
    organization: string | null
    tagline: string | null
}

/**
 * Returns the footer content derived from EmDash's built-in General Settings: the copyright organization
 * is the site `title` (falling back to the src/consts.ts default so the footer credit matches the header),
 * and the footer line is the site `tagline`. Blank or missing values normalize to null so the component
 * can omit them. Fails soft on read error.
 *
 * @returns {Promise<FooterContent>} the resolved organization and tagline
 */
export async function getFooter(): Promise<FooterContent> {
    const settings = await fetchSettings()
    return {
        organization: settings.title?.trim() || SITE_TITLE,
        tagline: settings.tagline?.trim() || null
    }
}
