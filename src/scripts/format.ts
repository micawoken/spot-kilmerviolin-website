/**
 * scripts/format.ts
 *
 * Value/display formatters for the admin entity info cards. These turn stored record values into the
 * human-readable text shown in the READ view, mirroring the SSR `disp` helpers in the entity Info
 * components (ComposerInfo / CompositionInfo / ContributorInfo) so the client-side READ flow renders
 * identically.
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
import { NOT_PROVIDED } from "../consts"

// the display instance falls back to the code so an unexpected value still renders (validation of the
// code happens elsewhere, in lib/api/validation.ts).
const region_display = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" })

/**
 * Resolves a country code to its English display name, falling back to the normalized code itself when
 * the runtime cannot resolve it.
 *
 * @param {string} code the ISO 3166-1 alpha-2 country code
 * @returns {string} the English country name, or the normalized code if it cannot be resolved
 */
export function countryCodeName(code: string): string {
    const normalized = code.trim().toUpperCase()
    try {
        return region_display.of(normalized) ?? normalized
    } catch {
        return normalized
    }
}

// A handful of common informal names that Intl.DisplayNames does not resolve on its own, mapped to their
// ISO 3166-1 alpha-2 codes so a user can type the everyday name rather than the formal one.
const COUNTRY_NAME_ALIASES: Record<string, string> = {
    usa: "US",
    "u.s.a.": "US",
    "u.s.": "US",
    america: "US",
    "united states of america": "US",
    uk: "GB",
    "u.k.": "GB",
    britain: "GB",
    "great britain": "GB",
    england: "GB"
}

// Lazily-built reverse index from a country's English display name (lowercased) to its ISO 3166-1 alpha-2
// code. Built by resolving every alpha-2 code through region_display, the same resolver countryCodeName
// uses, so the names accepted here are exactly the names rendered elsewhere.
let country_name_index: Map<string, string> | null = null

function buildCountryNameIndex(): Map<string, string> {
    const index = new Map<string, string>()
    for (let first = 65; first <= 90; first++) {
        for (let second = 65; second <= 90; second++) {
            const code = String.fromCharCode(first, second)
            let name: string | undefined
            try {
                name = region_display.of(code)
            } catch {
                continue
            }
            // region_display falls back to the code itself for codes it cannot resolve; skip those
            if (!name || name === code) continue
            index.set(name.toLowerCase(), code)
        }
    }
    // overlay the informal aliases (these take precedence is irrelevant — the keys do not overlap)
    for (const [alias, code] of Object.entries(COUNTRY_NAME_ALIASES)) {
        index.set(alias, code)
    }
    return index
}

/**
 * Resolves a country's common English name (e.g. "France", "South Korea", "USA") to its ISO 3166-1 alpha-2
 * code, case-insensitively. Returns null when the name is blank or not recognised. Used to let a user enter
 * a country name in the composer country field, which is converted to the code the API requires.
 *
 * @param {string} name the country name to resolve
 * @returns {string | null} the ISO 3166-1 alpha-2 code, or null if unrecognised
 */
export function countryNameToCode(name: string): string | null {
    const key = name.trim().toLowerCase()
    if (key === "") return null
    if (!country_name_index) country_name_index = buildCountryNameIndex()
    return country_name_index.get(key) ?? null
}

/**
 * Resolves a composer's death_year to its display text: the "Present" sentinel for a living composer
 * (stored as -1), or the year itself otherwise. The single source of truth for that conversion — reused
 * by {@link formatInfoValue} and {@link formatLifespan}, and by `catalog.tsx`'s `ContentField` outlet, so
 * the public entity pages, the admin READ view, and the client-side READ flow can never render this
 * sentinel differently from one another.
 *
 * @param {number} deathYear the stored death_year value
 * @returns {string} "Present" for -1, otherwise the year as a string
 */
export function formatDeathYear(deathYear: number): string {
    return deathYear === -1 ? "Present" : String(deathYear)
}

/**
 * Builds a composer's birth–death year range for display, e.g. "1841–1904" or "1841–Present" (see
 * {@link formatDeathYear}). Mirrors `ComposerInfo.astro`'s birth/death infoline, joined with the same
 * en dash, as a single pre-built string a template can bind as one content field.
 *
 * @param {number} birthYear the composer's birth year
 * @param {number} deathYear the composer's death year (or -1 if living)
 * @returns {string} the "birth–death" range
 */
export function formatLifespan(birthYear: number, deathYear: number): string {
    return `${birthYear}–${formatDeathYear(deathYear)}`
}

/**
 * Title-cases a role string for public display (e.g. "primary author" -> "Primary Author"). Splits on
 * whitespace so multi-word roles are cased consistently regardless of how an editor typed them.
 *
 * @param {string} role the stored role text
 * @returns {string} the title-cased role
 */
export function titleCaseRole(role: string): string {
    return role
        .split(" ")
        .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
        .join(" ")
}

/**
 * Formats a scalar record field value for the entity info card, mirroring the SSR `disp` helper: a
 * null/undefined/blank/empty-array value renders as the shared "not provided" marker, and per-entity
 * special cases (living-composer death year, country code → name, top-level id "ID #" prefix, contributor
 * admin account type, plain booleans) are rendered as their human-readable forms.
 *
 * Image, publication-URI, and phases fields are handled separately by the caller (they require markup or
 * a distinct label) and are not passed here.
 *
 * @param {string} type_name the entity type ("composer" | "composition" | "contributor")
 * @param {string} key the field key
 * @param {unknown} value the stored field value
 * @param {boolean} top_level whether the field is a top-level field (not a nested object member)
 * @returns {string} the display text to assign to the field element
 */
export function formatInfoValue(type_name: string, key: string, value: unknown, top_level: boolean): string {
    if (value === null || value === undefined) {
        return NOT_PROVIDED
    } else if (Array.isArray(value)) {
        return value.length > 0 ? value.join(", ") : NOT_PROVIDED
    } else if (typeof value === "string" && value.trim() === "") {
        return NOT_PROVIDED
    } else if (type_name === "composer" && key === "death_year" && typeof value === "number") {
        // a composer death_year of -1 denotes a living composer (mirrors the ComposerInfo SSR view)
        return formatDeathYear(value)
    } else if (type_name === "composer" && key === "country" && typeof value === "string") {
        // composer countries are stored as ISO 3166-1 alpha-2 codes; render the English name (mirrors the ComposerInfo SSR view)
        return countryCodeName(value)
    } else if (key === "id" && top_level) {
        // the SSR Info components render the id element as "ID #<n>"; mirror that here so the client-side
        // READ flow does not overwrite the "ID #" prefix with a bare number (the id element is top-level only)
        return `ID #${String(value)}`
    } else if (type_name === "contributor" && key === "admin" && typeof value === "boolean") {
        // the ContributorInfo SSR card renders admin as an account type rather than a bare boolean
        return value ? "Administrator" : "Standard"
    } else if (typeof value === "boolean") {
        // bare booleans render as "Yes"/"No" (mirrors the SSR `disp` helper in the entity Info components)
        return value ? "Yes" : "No"
    } else {
        return String(value)
    }
}

/**
 * Formats a stored epoch-millisecond timestamp (a record's entry_date/change_date) into a human-readable
 * date-and-time string for display, using the same format as the admin footer (see AdminFooter.astro). A
 * missing value renders as the shared "not provided" marker, and an unparseable value falls back to the
 * raw value (stringified) so nothing is silently dropped. Shared by the metadata page's SSR view and its
 * client-side fetch.
 *
 * @param {number | null | undefined} epochMs the epoch-millisecond timestamp, or null/undefined when absent
 * @param {string} [timeZone] the IANA time zone to render in (e.g. the visitor's Cloudflare cf.timezone on
 *   the server); when omitted, the runtime's default zone is used (the browser's local zone on the client)
 * @returns {string} the formatted timestamp, the raw value if unparseable, or the "not provided" marker
 */
export function formatTimestamp(epochMs: number | null | undefined, timeZone?: string): string {
    if (epochMs === null || epochMs === undefined) {
        return NOT_PROVIDED
    }
    const parsed = new Date(epochMs)
    if (isNaN(parsed.getTime())) {
        // not a valid timestamp; surface the raw stored value rather than an empty/incorrect render
        return String(epochMs)
    }
    // mirrors the date/time format the admin footer renders
    const options: Intl.DateTimeFormatOptions = {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short"
    }
    if (timeZone) {
        options.timeZone = timeZone
    }
    try {
        return parsed.toLocaleString("en-US", options)
    } catch {
        // an unrecognized time zone string would throw; fall back to the runtime default zone
        delete options.timeZone
        return parsed.toLocaleString("en-US", options)
    }
}
