/**
 * scripts/citations.ts
 *
 * Citations display helper shared by the SSR ComposerInfo/CompositionInfo cards, catalog.tsx's
 * ContentField outlet (public pages), and the client-side READ flow
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
import { classifyCitationValue } from "../lib/api/validation"

/** Resolves a classified citation value to its link target. */
function citationHref(type: "https" | "doi" | "isbn", value: string): string {
    switch (type) {
        case "https":
            return value
        case "doi":
            return `https://doi.org/${value}`
        case "isbn":
            return `https://openlibrary.org/isbn/${value.replace(/[\s-]/g, "")}`
    }
}

export function renderCitationsList(citations: Record<string, string> | null | undefined, placeholder: string): string {
    if (!citations) {
        return escapeHtml(placeholder)
    }
    const links = Object.entries(citations)
        .filter(([key]) => key.trim() !== "")
        .map(([key, value]) => {
            const type = classifyCitationValue(value)
            if (type === null) {
                return null
            }
            const href = escapeHtml(citationHref(type, value.trim()))
            const label = escapeHtml(key.trim())
            return `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`
        })
        .filter((link): link is string => link !== null)
    return links.length > 0 ? links.join(", ") : escapeHtml(placeholder)
}

/**
 * Parses the citations textarea's "Source Name: value" per-line format into a citations map
 */
export function parseCitationsTextarea(raw: string): Record<string, string> {
    const citations: Record<string, string> = {}
    for (const line of raw.split("\n")) {
        const trimmed = line.trim()
        if (trimmed === "") {
            continue
        }
        const separator = trimmed.indexOf(":")
        if (separator === -1) {
            continue
        }
        const key = trimmed.slice(0, separator).trim()
        const value = trimmed.slice(separator + 1).trim()
        if (key === "" || value === "") {
            continue
        }
        citations[key] = value
    }
    return citations
}

/** Serializes a citations map back to the textarea's "Source Name: value" per-line format, for prefill */
export function citationsToTextarea(citations: Record<string, string> | null | undefined): string {
    if (!citations) {
        return ""
    }
    return Object.entries(citations)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n")
}
