/**
 * scripts/references.ts
 *
 * Entity-reference rendering shared by the SSR info cards (CompositionInfo) and the client-side READ
 * flow
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
import { escapeHtml } from "./escape"

/**
 * Formats a single contributor reference for inline display as "id (name)"
 *
 * @param {number | null | undefined} id the contributor id, or null/undefined when no contributor is set
 * @param {string | null | undefined} name the resolved contributor name, if any
 * @param {string} placeholder the text to show when no contributor id is present
 * @returns {string} "id (name)", "id", or the placeholder
 */
export function formatContributorRef(
    id: number | null | undefined,
    name: string | null | undefined,
    placeholder: string
): string {
    if (id === null || id === undefined) return placeholder
    const trimmed = (name ?? "").trim()
    return trimmed === "" ? String(id) : `${id} (${trimmed})`
}

/**
 * Formats a list of contributor references for inline display as "id (name), id (name), ..."
 *
 * @param {number[] | null | undefined} ids the contributor ids
 * @param {string[] | null | undefined} names the resolved contributor names, aligned with ids by position
 * @param {string} placeholder the text to show when there are no contributor ids
 * @returns {string} a comma-separated list of "id (name)"/"id" entries, or the placeholder
 */
export function formatContributorRefs(
    ids: number[] | null | undefined,
    names: string[] | null | undefined,
    placeholder: string
): string {
    if (!ids || ids.length === 0) return placeholder
    return ids.map((id, index) => formatContributorRef(id, names?.[index], "")).join(", ")
}

// ---------------------------------------------------------------------------
// HTML anchor rendering (links to admin info pages)
// ---------------------------------------------------------------------------

/** Builds the admin info-page href for a record id under the given path segment. */
function infoHref(segment: string, id: number): string {
    return `/admin/${segment}/info?id=${encodeURIComponent(String(id))}`
}

/** Renders a single (escaped) anchor element from a href and a label. */
function anchor(href: string, label: string): string {
    return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
}

/**
 * Renders a single contributor reference as an "id (name)" anchor linking to its contributor info page
 *
 * @param {number | null | undefined} id the contributor id, or null/undefined when none is set
 * @param {string | null | undefined} name the resolved contributor name, if any
 * @param {string} placeholder the text to show when no contributor id is present
 * @returns {string} markup-safe HTML: an anchor, or the escaped placeholder
 */
export function renderContributorRefLink(
    id: number | null | undefined,
    name: string | null | undefined,
    placeholder: string
): string {
    if (id === null || id === undefined) return escapeHtml(placeholder)
    const trimmed = (name ?? "").trim()
    const label = trimmed === "" ? String(id) : `${id} (${trimmed})`
    return anchor(infoHref("contributors", id), label)
}

/**
 * Renders a list of contributor references as comma-separated "id (name)" anchors
 *
 * @param {number[] | null | undefined} ids the contributor ids
 * @param {string[] | null | undefined} names the resolved contributor names, aligned with ids by position
 * @param {string} placeholder the text to show when there are no contributor ids
 * @returns {string} markup-safe HTML
 */
export function renderContributorRefLinks(
    ids: number[] | null | undefined,
    names: string[] | null | undefined,
    placeholder: string
): string {
    if (!ids || ids.length === 0) return escapeHtml(placeholder)
    return ids.map((id, index) => renderContributorRefLink(id, names?.[index], "")).join(", ")
}

/**
 * Renders a composer's name as an anchor linking to its composer info page
 *
 * @param {number | null | undefined} id the composer id (the link target), or null/undefined when none
 * @param {string | null | undefined} name the resolved composer name, if any
 * @param {string} placeholder the text to show when the name is blank
 * @returns {string} markup-safe HTML
 */
export function renderComposerNameLink(
    id: number | null | undefined,
    name: string | null | undefined,
    placeholder: string
): string {
    const trimmed = (name ?? "").trim()
    const label = trimmed === "" ? placeholder : trimmed
    if (id === null || id === undefined) return escapeHtml(label)
    return anchor(infoHref("composers", id), label)
}

/**
 * Renders a list of composer names (e.g. secondary authors) as comma-separated anchors, each linking to
 * that composer's info page
 *
 * @param {number[] | null | undefined} ids the composer ids (the link targets)
 * @param {string[] | null | undefined} names the resolved composer names, aligned with ids by position
 * @param {string} placeholder the text to show when there are no composer ids
 * @returns {string} markup-safe HTML
 */
export function renderComposerNameLinks(
    ids: number[] | null | undefined,
    names: string[] | null | undefined,
    placeholder: string
): string {
    if (!ids || ids.length === 0) return escapeHtml(placeholder)
    return ids
        .map((id, index) => {
            const trimmed = (names?.[index] ?? "").trim()
            return anchor(infoHref("composers", id), trimmed === "" ? String(id) : trimmed)
        })
        .join(", ")
}
