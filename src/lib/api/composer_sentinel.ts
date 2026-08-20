/**
 * lib/api/composer_sentinel.ts
 *
 * Specifies data about the comoposer sentinels: unknown and traditional
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

import { AuthorRole } from "./common.ts"

/** Trims/lowercases/collapses whitespace for exact alias-set lookups (mirrors import_build.ts's normalizeName) */
function normalizeForLookup(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ")
}

/** Spellings donated CSV data commonly uses for "the composer is not known" */
const UNKNOWN_COMPOSER_ALIASES = new Set(["unknown", "unknown composer", "unk", "n/a", "na"])

/** Spellings for a work with no individual composer (the folk/anonymous-authorship case) */
const TRADITIONAL_COMPOSER_ALIASES = new Set(["traditional", "trad"])

/** The two canonical name-only "no data" composer identities */
export const SENTINEL_COMPOSER_NAMES: readonly string[] = ["Unknown", "Traditional"]

/**
 * Collapses a composer-name cell to one of the two canonical sentinel names - Unknown and Traditional if matched
 */
export function sentinelComposerName(raw: string): string {
    const key = normalizeForLookup(raw).replace(/\.+$/, "")
    if (UNKNOWN_COMPOSER_ALIASES.has(key)) return "Unknown"
    if (TRADITIONAL_COMPOSER_ALIASES.has(key)) return "Traditional"
    return raw
}

/** Whether a name (in any of its recognized spellings) resolves to one of the sentinel identities */
export function isSentinelComposerName(name: string): boolean {
    const key = normalizeForLookup(name).replace(/\.+$/, "")
    return UNKNOWN_COMPOSER_ALIASES.has(key) || TRADITIONAL_COMPOSER_ALIASES.has(key)
}

/**
 * The default values written for a sentinel composer's otherwise-NOT-NULL columns
 */
export const SENTINEL_COMPOSER_PLACEHOLDER = {
    role: AuthorRole.COMPOSER,
    birth_year: 1,
    death_year: 1,
    // ISO 3166-1 / CLDR "Unknown Region"
    country: "ZZ",
    bio: ""
} as const

/**
 * Canonicalizes a sentinel name (e.g. "unk" -> "Unknown") and fills the required-but-meaningless
 * fields
 *
 * @param record the record being validated (a plain object, prior to type-assertion)
 */
export function applySentinelComposerDefaults(record: Record<string, any>): void {
    if (typeof record.name !== "string" || !isSentinelComposerName(record.name)) {
        return
    }
    record.name = sentinelComposerName(record.name)
    record.role = SENTINEL_COMPOSER_PLACEHOLDER.role
    if (typeof record.birth_year !== "number") {
        record.birth_year = SENTINEL_COMPOSER_PLACEHOLDER.birth_year
    }
    if (typeof record.death_year !== "number") {
        record.death_year = SENTINEL_COMPOSER_PLACEHOLDER.death_year
    }
    if (typeof record.country !== "string" || record.country.trim() === "") {
        record.country = SENTINEL_COMPOSER_PLACEHOLDER.country
    }
    if (typeof record.bio !== "string") {
        record.bio = SENTINEL_COMPOSER_PLACEHOLDER.bio
    }
    if (typeof record.image !== "string" && record.image !== null) {
        record.image = null
    }
}

/**
 * Build-time removal of a sentinel composer's placeholder data
 *
 * @param record the composer record as read from D1
 * @returns the same record for a non-sentinel name, otherwise a copy with the placeholder fields nulled
 */
export function stripSentinelComposerData<T extends { name: string }>(record: T): T {
    if (!isSentinelComposerName(record.name)) {
        return record
    }
    return { ...record, birth_year: null, death_year: null, country: null }
}
