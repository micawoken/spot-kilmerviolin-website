/**
 * lib/content/nav.ts
 *
 * Build-time accessor for the header navigation links authored in the CMS (the "navigation" file, stored
 * at src/content/settings/navigation.json). The JSON is imported directly so it is baked into the Worker
 * bundle at build time — there is no per-request fetch and no runtime store to read, which keeps the
 * navigation effectively static (the worker has no filesystem to read content at runtime, and KV would
 * only add a runtime read this data does not need). A change publishes the same way page content does:
 * edit in the CMS -> commit -> rebuild bakes the new links in.
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

import navData from "../../content/settings/navigation.json"

/** A single header navigation entry. */
export interface NavLink {
    /** the visible link text */
    label: string
    /** an on-site path (e.g. /about) or a full external URL */
    href: string
}

// the JSON is cast through unknown because an empty seed array would otherwise be inferred as never[];
// the data is what the CMS guarantees it writes for the navigation schema.
const data = navData as unknown as { links?: NavLink[] }

/**
 * Returns the configured header navigation links, dropping any incomplete entries (an entry is only
 * usable with both a label and a destination).
 *
 * @returns {NavLink[]} the navigation links to render, in authored order
 */
export function getNav(): NavLink[] {
    return (data.links ?? []).filter((link) => Boolean(link && link.label && link.href))
}
