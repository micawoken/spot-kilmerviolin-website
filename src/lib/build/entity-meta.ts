/**
 * lib/build/entity-meta.ts
 *
 * Meta-description generator for entity detail pages (`pages/entity/[noun]/[id].astro`)
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

import { countryCodeName, titleCaseRole } from "../../scripts/format"
import { isRecord } from "../compositor/types"
import type { EntityNoun } from "../compositor/entity-fields"

// Google/Facebook truncate a meta description around this length
const DESCRIPTION_MAX_LENGTH = 160

/** Trims and truncates free text to a search/social-friendly length, adding an ellipsis only when text
 *  was actually cut. */
function truncate(text: string, maxLength: number): string {
    const trimmed = text.trim().replace(/\s+/g, " ")
    if (trimmed.length <= maxLength) return trimmed
    return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`
}

/** Non-blank string field, or undefined — the shared "is this field usable" check every generator below needs. */
function str(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined
}

/** Non-blank display name off a resolved reference field (`entity-records.ts`'s `ResolvedReference`). */
function refName(value: unknown): string | undefined {
    return isRecord(value) ? str(value.name) : undefined
}

function composerDescription(entry: Record<string, unknown>): string {
    const bio = str(entry.bio)
    if (bio) return truncate(bio, DESCRIPTION_MAX_LENGTH)

    const name = str(entry.name) ?? "This composer"
    const role = str(entry.role)
    const country = str(entry.country)
    const details = [str(entry.life_span), country ? countryCodeName(country) : undefined].filter(
        (detail): detail is string => Boolean(detail)
    )

    let sentence = role ? `${name}, ${titleCaseRole(role)}` : name
    if (details.length > 0) sentence += ` (${details.join(", ")})`
    return `${sentence}.`
}

function contributorDescription(entry: Record<string, unknown>): string {
    const bio = str(entry.bio)
    if (bio) return truncate(bio, DESCRIPTION_MAX_LENGTH)

    const name = str(entry.name) ?? "This contributor"
    const major = str(entry.major)
    const classYear = typeof entry.class_year === "number" ? entry.class_year : undefined
    const details = [major, classYear !== undefined ? `class of ${classYear}` : undefined].filter(
        (detail): detail is string => Boolean(detail)
    )

    return details.length > 0 ? `${name}, ${details.join(", ")}.` : `${name}.`
}

function compositionDescription(entry: Record<string, unknown>): string {
    const notes = str(entry.notes_historical)
    if (notes) return truncate(notes, DESCRIPTION_MAX_LENGTH)

    const name = str(entry.name) ?? "This work"
    const composer = refName(entry.composer)
    const type = str(entry.type)

    let sentence = composer ? `${name} by ${composer}` : name
    if (type) sentence += ` (${type})`
    return `${sentence}.`
}

/** Builds a per-record meta description for one entity detail page: the record's own bio/historical
 *  notes when present (truncated), otherwise a short sentence generated from its structured fields. */
export function entityMetaDescription(noun: EntityNoun, entry: Record<string, unknown>): string {
    switch (noun) {
        case "composer":
            return composerDescription(entry)
        case "contributor":
            return contributorDescription(entry)
        case "composition":
            return compositionDescription(entry)
    }
}
