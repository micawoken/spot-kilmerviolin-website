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
 */
import { escapeHtml } from "./escape"

export function renderPublicationUri(uri_type: string | null | undefined, uri: string | null | undefined, placeholder: string): string {
    if (uri === null || uri === undefined || uri.trim() === "") {
        return escapeHtml(placeholder)
    }
    const safe = escapeHtml(uri.trim())
    switch (uri_type) {
        case "https":
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
