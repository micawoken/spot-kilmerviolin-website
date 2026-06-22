/**
 * lib/api/validation.ts
 *
 * Provides validation functions used server and client-side
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

// Pragmatic email check: a single @ separating non-empty, space-free local and (dotted) domain parts.
// This is deliberately lenient — it guards links/prefills against junk, not against every RFC edge case.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Whether the string appears to be a valid email address
 *
 * @param {string} value - the candidate email
 * @returns {boolean} - true if the value is a plausibly valid email address
 */
export function isValidEmail(value: string): boolean {
    return EMAIL_PATTERN.test(value.trim())
}

/**
 * Reads an email from a URL and returns it if valid
 *
 * @param {URL} url - the request URL (e.g. Astro.url)
 * @param {string} param - the query parameter name (default "identity_email")
 * @returns {string} - the validated, trimmed email, or "" when the param is absent or invalid
 */
export function emailFromParam(url: URL, param: string = "identity_email"): string {
    const raw = url.searchParams.get(param)
    if (!raw) {
        return ""
    }
    const trimmed = raw.trim()
    return isValidEmail(trimmed) ? trimmed : ""
}

// GitHub username rules: 1–39 characters, alphanumeric or single hyphens, may not begin or end with a
// hyphen, and may not contain consecutive hyphens. The negative lookahead on each hyphen enforces the
// "no trailing / no doubled hyphen" rule, while the leading class forbids a leading hyphen.
const GITHUB_USERNAME_PATTERN = /^[a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38}$/

/**
 * Whether a string is a syntactically valid GitHub username (login)
 *
 * This is a syntax check only; it does not verify the account exists (that resolution happens server-side
 * against the GitHub API when a username is linked). See lib/api/github_repo_mgmt.ts.
 *
 * @param {string} value - the candidate username
 * @returns {boolean} - true if the trimmed value is a syntactically valid GitHub username
 */
export function isValidGithubUsername(value: string): boolean {
    return GITHUB_USERNAME_PATTERN.test(value.trim())
}

/**
 * Whether a supplied string rep of a number is a positive integer
 *
 * @param {string} value - the candidate string
 * @returns {boolean} - true if the trimmed value is a positive integer
 */
export function isPositiveIntegerString(value: string): boolean {
    const trimmed = value.trim()
    return /^\d+$/.test(trimmed) && parseInt(trimmed, 10) >= 1
}

/**
 * Whether a number is a valid year value (a positive integer, or -1 if allow_living is true)
 *
 * @param {unknown} value - the candidate value
 * @param {boolean} [allow_living] - whether the -1 "still living" signal is allowed
 * @returns {boolean} - true if the value is an acceptable year
 */
export function isValidYear(value: unknown, allow_living: boolean = false): boolean {
    if (typeof value !== "number" || !Number.isInteger(value)) {
        return false
    }
    return value >= 1 || (allow_living && value === -1)
}

/**
 * Whether the birth year is consistent with the death year (birth year before death year)
 *
 * If the death year is -1, birth year check is skipped since they're still living
 *
 * @param {number} birth_year - the composer's birth year
 * @param {number} death_year - the composer's death year (or -1 if living)
 * @returns {boolean} - true if death_year is the -1 sentinel, or is greater than or equal to birth_year
 */
export function isDeathYearConsistent(birth_year: number, death_year: number): boolean {
    return death_year === -1 || death_year >= birth_year
}

/**
 * Two notes separated by a dash, each a letter A–G with an optional accidental (# sharp or b flat) and
 * a 1–2 digit octave, e.g. "G3-A5" or "Bb3-C6". Letters may be entered in either case.
 *
 * Note: the flat marker is the lowercase letter "b"; it is deliberately distinct from the note letter
 * "B", so "Bb" is B-flat. This is why normalization (see normalizePitchRange) uppercases only the note
 * letter and never the accidental — uppercasing the whole string would corrupt flats.
 */
export const PITCH_RANGE_PATTERN = /^[A-Ga-g][#b]?\d{1,2}-[A-Ga-g][#b]?\d{1,2}$/

/**
 * Whether a string is a valid two-note pitch range (see PITCH_RANGE_PATTERN)
 *
 * @param {string} value - the candidate range
 * @returns {boolean} - true if the trimmed value is a valid pitch range
 */
export function isValidPitchRange(value: string): boolean {
    return PITCH_RANGE_PATTERN.test(value.trim())
}

/**
 * Uppercases only the leading note letter, leaving the accidental (b/#) and octave untouched.
 *
 * @param {string} note - a pitch range note (e.g. "Bb3")
 * @returns {string} the normalized note
 */
function normalizeNote(note: string): string {
    return note.charAt(0).toUpperCase() + note.slice(1)
}

/**
 * Normalizes a (pre-validated) pitch range to its canonical stored form
 *
 * Format: uppercase note letters, accidental and octave unchanged, separated by a dash with no spaces (e.g. "Bb3-C6")
 *
 * @param {string} value - a valid pitch range
 * @returns {string} - the normalized range
 */
export function normalizePitchRange(value: string): string {
    const [low, high] = value.trim().split("-")
    return `${normalizeNote(low)}-${normalizeNote(high)}`
}

/**
 * Pattern matching a positive 1–2 digit integer, the alternative input form for a position
 */
export const POSITION_INTEGER_PATTERN = /^[1-9][0-9]?$/

/**
 * Pattern matching a Roman numeral representing 1–99, the canonical stored form for a position
 */
const ROMAN_NUMERAL_PATTERN = /^(?=[IVXLC])(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/

/**
 * Whether a string is a valid position: a Roman numeral (case-insensitive on input) or a
 * positive 1–2 digit integer
 *
 * @param {string} value - the candidate position
 * @returns {boolean} - true if the trimmed value is a valid position
 */
export function isValidPosition(value: string): boolean {
    const trimmed = value.trim()
    return POSITION_INTEGER_PATTERN.test(trimmed) || ROMAN_NUMERAL_PATTERN.test(trimmed.toUpperCase())
}

/**
 * Converts an integer in 1–99 to its Roman-numeral representation
 *
 * @param {number} value - the integer to convert
 * @returns {string} - the Roman numeral
 */
export function integerToRoman(value: number): string {
    const table: [number, string][] = [
        [90, "XC"],
        [50, "L"],
        [40, "XL"],
        [10, "X"],
        [9, "IX"],
        [5, "V"],
        [4, "IV"],
        [1, "I"]
    ]
    let remaining = value
    let out = ""
    for (const [magnitude, symbol] of table) {
        while (remaining >= magnitude) {
            out += symbol
            remaining -= magnitude
        }
    }
    return out
}

/**
 * Normalizes a (pre-validated) position to its canonical stored form: always an uppercase Roman numeral
 *
 * @param {string} value - a valid position (Roman numeral or integer)
 * @returns {string} - the normalized Roman numeral
 */
export function normalizePosition(value: string): string {
    const trimmed = value.trim()
    if (POSITION_INTEGER_PATTERN.test(trimmed)) {
        return integerToRoman(parseInt(trimmed, 10))
    }
    return trimmed.toUpperCase()
}

/**
 * Pattern matching internal asset paths: either /api/v1/files/<key> for uploaded files, or /files/<name> for bundled assets
 */
const INTERNAL_IMAGE_PATTERN = /^\/(?:api\/v\d+\/files|files)\/\S+$/

/**
 * Whether a string is an acceptable image reference: an absolute https URL, or an internal
 * asset path (/api/v1/files/<key> for uploaded files, /files/<name> for bundled assets)
 *
 * Only https is accepted for external references. A stored image value is loaded automatically into an
 * <img src> whenever an admin views the owning record (both in the SSR Info cards and the client READ
 * flow in scripts/interface.ts), so permitting http would let a record author force the viewer's browser
 * into a plaintext, mixed-content request to an arbitrary host (a tracking-pixel / IP-leak vector). The
 * scheme is constrained here, at the single write-time validation point, rather than at each render site.
 *
 * @param {string} value - the candidate image URL or path
 * @returns {boolean} - true if the trimmed value is an acceptable image reference
 */
export function isValidImageUrl(value: string): boolean {
    const trimmed = value.trim()
    if (INTERNAL_IMAGE_PATTERN.test(trimmed)) {
        return true
    }
    let parsed: URL
    try {
        parsed = new URL(trimmed)
    } catch {
        return false
    }
    return parsed.protocol === "https:"
}

/**
 * Whether a MIME type denotes an image (any image/* subtype)
 *
 * Used by the admin file upload pages to ensure that only images are uploaded
 *
 * @param {string} type - the candidate MIME type (e.g. a File's .type)
 * @returns {boolean} - true if the trimmed, lowercased type begins with "image/"
 */
export function isImageMimeType(type: string): boolean {
    return type.trim().toLowerCase().startsWith("image/")
}

/**
 * Whether a comma-separated input contains stray (empty) segments — a leading, trailing, or
 * doubled comma that yields a blank entry
 *
 * Used client-side to validate input responses (the server has separate logic that removes blank entries automatically)
 *
 * @param {string} value - the raw comma-separated input
 * @returns {boolean} - true if any segment is empty
 */
export function hasStrayCommaSegments(value: string): boolean {
    if (value.trim() === "") {
        return false
    }
    return value.split(",").some((segment) => segment.trim() === "")
}

/**
 * Supported URI types for composer/contributor external links, used to determine validation mode
 */
export const SUPPORTED_URI_TYPES = ["https", "isbn", "doi"]

/**
 * Validates an ISBN-10 or ISBN-13 by its checksum (hyphens and spaces are ignored)
 *
 * @param {string} value - the candidate ISBN string
 * @returns {boolean} - true if value is a checksum-valid ISBN-10 or ISBN-13
 */
export function isValidISBN(value: string): boolean {
    const digits = value.replace(/[\s-]/g, "")
    if (/^\d{9}[\dXx]$/.test(digits)) {
        // ISBN-10: weighted sum (10..1) must be divisible by 11; a trailing X counts as 10
        let sum = 0
        for (let i = 0; i < 9; i++) {
            sum += (10 - i) * parseInt(digits[i], 10)
        }
        sum += digits[9].toUpperCase() === "X" ? 10 : parseInt(digits[9], 10)
        return sum % 11 === 0
    }
    if (/^\d{13}$/.test(digits)) {
        // ISBN-13: alternating 1/3 weighted sum must be divisible by 10
        let sum = 0
        for (let i = 0; i < 13; i++) {
            sum += (i % 2 === 0 ? 1 : 3) * parseInt(digits[i], 10)
        }
        return sum % 10 === 0
    }
    return false
}

/**
 * Validates that a publication URI matches its declared uri_type (the type is authoritative)
 *
 * URI Types:
 *   https -> must parse as a URL with the https scheme
 *   isbn  -> must be a checksum-valid ISBN-10 or ISBN-13
 *   doi   -> must match DOI syntax (10.<registrant>/<suffix>); stored bare, the doi.org resolver is added in the view
 *
 * @param {string} uri_type - the declared URI type (assumed to be one of SUPPORTED_URI_TYPES)
 * @param {string} uri - the URI value to validate against uri_type
 * @returns {boolean} - true if uri is consistent with uri_type
 */
export function validateURIForType(uri_type: string, uri: string): boolean {
    const value = uri.trim()
    switch (uri_type) {
        case "https": {
            let parsed: URL
            try {
                parsed = new URL(value)
            } catch {
                return false
            }
            return parsed.protocol === "https:"
        }
        case "isbn":
            return isValidISBN(value)
        case "doi":
            return /^10\.\d{4,9}\/\S+$/.test(value)
        default:
            return false
    }
}

/**
 * Intl.DisplayNames instance configured to resolve ISO 3166-1 alpha-2 region codes to country names
 */
const region_validator = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" })

/**
 * Normalizes a country code to the canonical ISO 3166-1 alpha-2 form (trimmed and uppercased)
 *
 * @param {string} code the raw country code
 * @returns {string} the trimmed, uppercased code
 */
export function normalizeCountryCode(code: string): string {
    return code.trim().toUpperCase()
}

/**
 * Whether the given string is a valid ISO 3166-1 alpha-2 country code
 *
 * @param {string} code the country code to validate
 * @returns {boolean} whether the code is a resolvable ISO 3166-1 alpha-2 code
 */
export function isValidCountryCode(code: string): boolean {
    const normalized = normalizeCountryCode(code)
    if (!/^[A-Z]{2}$/.test(normalized)) {
        return false
    }
    try {
        return region_validator.of(normalized) !== undefined
    } catch {
        // Intl.DisplayNames throws a RangeError for structurally invalid input; treat it as invalid
        return false
    }
}
