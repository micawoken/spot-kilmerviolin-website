/**
 * lib/content/nav.ts
 *
 * Build-time accessors for the CMS-authored navigation menus. The public site is prerendered, so these
 * run during `astro build` and read EmDash's built-in menus over its HTTP API (see
 * src/lib/build/emdash-api.ts, fetchMenu), not the request-scoped `emdash` reader. Publishing a menu
 * change requires a site rebuild.
 *
 * The header and footer each render a flat list, so only a menu's top-level items are used (nested
 * children are ignored). Each EmDash menu item exposes `label` and `url`, mapped here to {label, href}.
 *
 * Consumed by components/PublicHeader.astro (primary) and components/PublicFooter.astro (footer).
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

import { fetchMenu } from "../build/emdash-api"

/** A single navigation entry, used by both the header and footer menus. */
export interface NavLink {
    /** the visible link text */
    label: string
    /** an on-site path (e.g. /about) or a full external URL */
    href: string
}

/** Reads a named EmDash menu and maps each item's `url` to the component's `href`. */
async function menuLinks(name: string): Promise<NavLink[]> {
    const items = await fetchMenu(name)
    return items.map((item) => ({ label: item.label, href: item.url }))
}

/**
 * Returns the header navigation links from EmDash's built-in `primary` menu. Fails soft to [] when the
 * menu is missing or the read fails.
 *
 * @returns {Promise<NavLink[]>} the header links to render, in authored order
 */
export async function getNav(): Promise<NavLink[]> {
    return menuLinks("primary")
}

/**
 * Returns the footer navigation links from the CMS-authored `footer` menu. Fails soft to [] when the
 * menu is missing or the read fails, so the footer degrades to its copyright line alone.
 *
 * @returns {Promise<NavLink[]>} the footer links to render, in authored order
 */
export async function getFooterNav(): Promise<NavLink[]> {
    return menuLinks("footer")
}
