/**
 * scripts/publication.ts
 *
 * Publication-URI display helper shared by the SSR CompositionInfo card and the client-side READ flow
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
 * Whether a URI carries a web scheme safe to place in an href
 */
function isLinkableHttpUri(uri: string): boolean {
    let parsed: URL
    try {
        parsed = new URL(uri)
    } catch {
        return false
    }
    return parsed.protocol === "https:"
}

export function renderPublicationUri(
    uri_type: string | null | undefined,
    uri: string | null | undefined,
    placeholder: string
): string {
    if (uri === null || uri === undefined || uri.trim() === "") {
        return escapeHtml(placeholder)
    }
    const safe = escapeHtml(uri.trim())
    switch (uri_type) {
        case "https":
            // defense-in-depth: only emit an anchor when the stored value is actually an http(s) URL; a
            // value that bypassed write-time validation (e.g. javascript:) renders as inert escaped text
            if (!isLinkableHttpUri(uri.trim())) {
                return safe
            }
            return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`
        case "doi":
            return `<a href="https://doi.org/${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`
        case "isbn": {
            const href = escapeHtml(`https://www.worldcat.org/isbn/${uri.trim().replace(/[\s-]/g, "")}`)
            return `<a href="${href}" target="_blank" rel="noopener noreferrer">${safe}</a>`
        }
        default:
            // unknown type (the server validates uri_type, so this should not occur): render the bare value
            return safe
    }
}
