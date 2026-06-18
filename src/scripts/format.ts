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
