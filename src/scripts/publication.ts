/**
 * scripts/publication.ts
 *
 * Publication-URI display helper shared by the SSR CompositionInfo card and the client-side READ flow.
 *
 * A composition's publication URI is rendered according to its declared uri_type (the type is
 * authoritative; the server validates the type/URI pairing in lib/api/d1.ts):
 *   https -> the URL rendered as a clickable link
 *   isbn  -> the literal text "isbn:{value}" (an ISBN is not directly resolvable, so it is not linked)
 *   doi   -> the bare DOI text linked to its doi.org resolver (https://doi.org/{doi})
 *
 * The returned string is HTML: every interpolated value is HTML-entity-encoded with escapeHtml first
 * (including inside href attributes, where escapeHtml's quote escaping keeps the value contained), so the
 * result is markup-safe and can be emitted via `set:html` (SSR) or `innerHTML` (client) without injection
 * risk. A null/undefined/blank URI yields the supplied placeholder.
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
import { escapeHtml } from "./escape"

/**
 * Whether a URI carries a web scheme safe to place in an href. Entity-encoding a value does not stop a
 * javascript:/data: URI from executing when clicked, so the scheme must be checked before linking; a
 * value that fails this is rendered as inert escaped text instead. Only https is linkable: the "https"
 * URI type is, by definition, an https address, and constraining the scheme keeps a plaintext http link
 * from ever being emitted (mirrors the https-only image policy in lib/api/validation.ts).
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
        case "isbn":
            return `isbn:${safe}`
        default:
            // unknown type (the server validates uri_type, so this should not occur): render the bare value
            return safe
    }
}
