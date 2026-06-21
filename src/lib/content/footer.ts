/**
 * lib/content/footer.ts
 *
 * Build-time accessor for the static footer content authored in the CMS (the "footer" file, stored at
 * src/content/settings/footer.json). The JSON is imported directly so it is baked into the build (see
 * lib/content/nav.ts for the rationale). The copyright year is computed at render time in the footer
 * component; only the static parts (organization, tagline) live here.
 *
 * Consumed by components/PublicFooter.astro.
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

import footerData from "../../content/settings/footer.json"

/** The resolved footer content; a field is null when left blank in the CMS. */
export interface FooterContent {
    organization: string | null
    tagline: string | null
}

const data = footerData as { organization?: string; tagline?: string }

/**
 * Returns the static footer content, normalizing blank fields to null so the component can omit them.
 *
 * @returns {FooterContent} the resolved organization and tagline
 */
export function getFooter(): FooterContent {
    return {
        organization: data.organization?.trim() || null,
        tagline: data.tagline?.trim() || null
    }
}
