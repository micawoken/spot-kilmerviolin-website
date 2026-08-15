/**
 * lib/api/validation.ts
 *
 * Provides validation functions used server and client-side
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

import { MAX_ALT_TEXT_LENGTH } from "../../consts"

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
export const PITCH_RANGE_PATTERN = /^([A-Ga-g])([#b]?)(\d{1,2})-([A-Ga-g])([#b]?)(\d{1,2})$/

/** Semitone value (0=C .. 11=B) of each natural note letter, using scientific pitch notation's convention
 *  that the octave begins at C (so B is the last note of an octave, not the first). Also used by
 *  {@link ../sanitize.ts} to respell double-accidental notes. */
export const NOTE_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/**
 * Semitone offset of an accidental marker: "#" raises a pitch class by one, "b" lowers it by one, and no
 * marker leaves it unchanged.
 *
 * @param {string} accidental - "#", "b", or ""
 * @returns {number} the semitone offset
 */
function accidentalOffset(accidental: string): number {
    return accidental === "#" ? 1 : accidental === "b" ? -1 : 0
}

/**
 * Whether a string is a valid two-note pitch range (see PITCH_RANGE_PATTERN) whose left (low) note is
 * strictly lower in pitch than its right (high) note. Notes are compared by octave first; when the octaves
 * are equal, they're compared by pitch class (so enharmonic ties, e.g. "C#3-Db3", are rejected as not
 * strictly ascending).
 *
 * @param {string} value - the candidate range
 * @returns {boolean} - true if the trimmed value is a valid, ascending pitch range
 */
export function isValidPitchRange(value: string): boolean {
    const match = PITCH_RANGE_PATTERN.exec(value.trim())
    if (match === null) {
        return false
    }
    const [, lowLetter, lowAccidental, lowOctave, highLetter, highAccidental, highOctave] = match
    const lowOctaveNum = parseInt(lowOctave, 10)
    const highOctaveNum = parseInt(highOctave, 10)
    if (lowOctaveNum !== highOctaveNum) {
        return lowOctaveNum < highOctaveNum
    }
    const lowPitchClass = NOTE_SEMITONE[lowLetter.toUpperCase()] + accidentalOffset(lowAccidental)
    const highPitchClass = NOTE_SEMITONE[highLetter.toUpperCase()] + accidentalOffset(highAccidental)
    return lowPitchClass < highPitchClass
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
 * Only https is accepted for external references
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
 * Validates a candidate alt-text value: required (non-empty after trimming) and within
 * MAX_ALT_TEXT_LENGTH characters
 *
 * @param {string} value - the trimmed candidate alt text
 * @returns {string | null} - an error message if invalid, or null if the value is acceptable
 */
export function validateAltText(value: string): string | null {
    if (value === "") {
        return "Alt text is required"
    }
    if (value.length > MAX_ALT_TEXT_LENGTH) {
        return `Alt text must be ${MAX_ALT_TEXT_LENGTH} characters or fewer`
    }
    return null
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
 * Classifies a citation value by sniffing its shape: an https link, a DOI, or an ISBN. Unlike a
 * composition's own
 * publication_info, a citation carries no separate declared uri_type field, so the type is inferred
 * from the value itself rather than looked up.
 *
 * @param {string} value - the candidate citation value
 * @returns {"https" | "doi" | "isbn" | null} the detected type, or null if it matches none
 */
export function classifyCitationValue(value: string): "https" | "doi" | "isbn" | null {
    const trimmed = value.trim()
    if (trimmed === "") {
        return null
    }
    if (validateURIForType("https", trimmed)) {
        return "https"
    }
    if (validateURIForType("doi", trimmed)) {
        return "doi"
    }
    if (isValidISBN(trimmed)) {
        return "isbn"
    }
    return null
}

/**
 * Validates a candidate citations map: an optional key-value object where each key is a non-blank source
 * name (the link's display text) and each value is an https link, a DOI, or an ISBN. An empty object is
 * valid (citations are optional); a non-object/array value, a blank key, or a value matching none of the
 * three accepted formats is rejected.
 *
 * @param {unknown} value - the candidate citations value (already known to be present)
 * @returns {string | null} an error message if invalid, or null if the value is acceptable
 */
export function validateCitations(value: unknown): string | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return "Citations must be a key-value object"
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (key.trim() === "") {
            return "A citation's source name cannot be blank"
        }
        if (typeof entry !== "string" || classifyCitationValue(entry) === null) {
            return `Citation "${key}" must be an https link, a DOI, or an ISBN`
        }
    }
    return null
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
