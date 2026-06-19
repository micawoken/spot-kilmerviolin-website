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
    "usa": "US",
    "u.s.a.": "US",
    "u.s.": "US",
    "america": "US",
    "united states of america": "US",
    "uk": "GB",
    "u.k.": "GB",
    "britain": "GB",
    "great britain": "GB",
    "england": "GB",
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
    } else if (type_name === "composer" && key === "death_year" && value === -1) {
        // a composer death_year of -1 denotes a living composer (mirrors the ComposerInfo SSR view)
        return "Present"
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
