/**
 * lib/content/nav.ts
 *
 * Build-time accessor for the header navigation links authored in the CMS. The public site is prerendered,
 * so this runs during `astro build` and reads EmDash's built-in `primary` menu over its HTTP API (see
 * src/lib/build/emdash-api.ts, fetchPrimaryMenu), not the request-scoped `emdash` reader. Publishing a
 * menu change requires a site rebuild.
 *
 * The header renders a flat list, so only the menu's top-level items are used (nested children are
 * ignored). Each EmDash menu item exposes `label` and `url`, mapped here to {label, href}.
 *
 * Consumed by components/PublicHeader.astro.
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

import { fetchPrimaryMenu } from "../build/emdash-api"

/** A single header navigation entry. */
export interface NavLink {
    /** the visible link text */
    label: string
    /** an on-site path (e.g. /about) or a full external URL */
    href: string
}

/**
 * Returns the header navigation links from EmDash's built-in `primary` menu. fetchPrimaryMenu already
 * drops incomplete items (an item needs both a label and a destination) and fails soft to [] when the
 * menu is missing or the read fails; this maps each item's `url` to the component's `href`.
 *
 * @returns {Promise<NavLink[]>} the navigation links to render, in authored order
 */
export async function getNav(): Promise<NavLink[]> {
    const items = await fetchPrimaryMenu()
    return items.map((item) => ({ label: item.label, href: item.url }))
}
