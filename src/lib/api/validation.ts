/**
 * lib/api/validation.ts
 *
 * Small, dependency-free validators shared by the admin pages, the client-side forms, and the server
 * record validators. These pull in no Cloudflare or database bindings, so they are safe to import into
 * Astro page frontmatter (server-side), API routes, and client-side scripts alike.
 */

// Pragmatic email check: a single @ separating non-empty, space-free local and (dotted) domain parts.
// This is deliberately lenient — it guards links/prefills against junk, not against every RFC edge case.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Reports whether a string looks like a valid email address.
 *
 * @param {string} value - the candidate email
 * @returns {boolean} - true if the value is a plausibly valid email address
 */
export function isValidEmail(value: string): boolean {
    return EMAIL_PATTERN.test(value.trim())
}

/**
 * Reads an identity-email query parameter from a URL and returns it only if it is a valid email,
 * otherwise "". Used by the admin IAM pages to prefill the identity-email field when reached from a
 * link in the user list.
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

// ---------------------------------------------------------------------------
// Numbers, identifiers, and years
// ---------------------------------------------------------------------------

/**
 * Reports whether a string is a positive integer (a bare, unsigned whole number ≥ 1).
 *
 * Used for ID and phase-number inputs, which must reference real (1-based) records.
 *
 * @param {string} value - the candidate string
 * @returns {boolean} - true if the trimmed value is a positive integer
 */
export function isPositiveIntegerString(value: string): boolean {
    const trimmed = value.trim()
    return /^\d+$/.test(trimmed) && parseInt(trimmed, 10) >= 1
}

/**
 * Reports whether a number is a valid year value: a positive integer, or (when allow_living is set,
 * for a composer's death year) the -1 sentinel that denotes a living composer.
 *
 * @param {unknown} value - the candidate value
 * @param {boolean} [allow_living] - whether the -1 "still living" sentinel is permitted
 * @returns {boolean} - true if the value is an acceptable year
 */
export function isValidYear(value: unknown, allow_living: boolean = false): boolean {
    if (typeof value !== "number" || !Number.isInteger(value)) {
        return false
    }
    return value >= 1 || (allow_living && value === -1)
}

// ---------------------------------------------------------------------------
// Pitch range (composition "range" field)
// ---------------------------------------------------------------------------

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
 * Reports whether a string is a valid two-note pitch range (see PITCH_RANGE_PATTERN).
 *
 * @param {string} value - the candidate range
 * @returns {boolean} - true if the trimmed value is a valid pitch range
 */
export function isValidPitchRange(value: string): boolean {
    return PITCH_RANGE_PATTERN.test(value.trim())
}

/** Uppercases only the leading note letter, leaving the accidental (b/#) and octave untouched. */
function normalizeNote(note: string): string {
    return note.charAt(0).toUpperCase() + note.slice(1)
}

/**
 * Normalizes a (pre-validated) pitch range to its canonical stored form: each note letter uppercased,
 * with the flat marker "b" preserved in lowercase (see PITCH_RANGE_PATTERN).
 *
 * @param {string} value - a valid pitch range
 * @returns {string} - the normalized range
 */
export function normalizePitchRange(value: string): string {
    const [low, high] = value.trim().split("-")
    return `${normalizeNote(low)}-${normalizeNote(high)}`
}

// ---------------------------------------------------------------------------
// Highest position (composition "position_highest" field)
// ---------------------------------------------------------------------------

/** A positive 1–2 digit integer, the alternative input form for a position. */
export const POSITION_INTEGER_PATTERN = /^[1-9][0-9]?$/
// a valid (uppercase) Roman numeral 1–99: tens via XC/XL/L?X{0,3}, units via IX/IV/V?I{0,3}, with a
// leading lookahead that requires at least one numeral so the empty string is rejected
const ROMAN_NUMERAL_PATTERN = /^(?=[IVXLC])(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/

/**
 * Reports whether a string is a valid violin position: a Roman numeral (case-insensitive on input) or a
 * positive 1–2 digit integer.
 *
 * @param {string} value - the candidate position
 * @returns {boolean} - true if the trimmed value is a valid position
 */
export function isValidPosition(value: string): boolean {
    const trimmed = value.trim()
    return POSITION_INTEGER_PATTERN.test(trimmed) || ROMAN_NUMERAL_PATTERN.test(trimmed.toUpperCase())
}

/**
 * Converts an integer in 1–99 to its Roman-numeral representation.
 *
 * @param {number} value - the integer to convert
 * @returns {string} - the Roman numeral
 */
export function integerToRoman(value: number): string {
    const table: [number, string][] = [[90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]]
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
 * Normalizes a (pre-validated) position to its canonical stored form: always an uppercase Roman numeral.
 * An integer input is converted to a Roman numeral; a Roman numeral is uppercased.
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

// ---------------------------------------------------------------------------
// Image URL
// ---------------------------------------------------------------------------

// internal asset paths served by the site: R2-backed files (/api/v1/files/<key>) and build-time
// bundled assets (/files/<name>). Anything else must be an absolute http(s) URL.
const INTERNAL_IMAGE_PATTERN = /^\/(?:api\/v\d+\/files|files)\/\S+$/

/**
 * Reports whether a string is an acceptable image reference: an absolute http(s) URL, or an internal
 * asset path (/api/v1/files/<key> for uploaded files, /files/<name> for bundled assets).
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
    return parsed.protocol === "https:" || parsed.protocol === "http:"
}

// ---------------------------------------------------------------------------
// Comma-separated lists
// ---------------------------------------------------------------------------

/**
 * Reports whether a comma-separated input contains stray (empty) segments — a leading, trailing, or
 * doubled comma that yields a blank entry. These are silently dropped on submission (client and server),
 * but are flagged so the user can fix an unintended comma rather than lose data.
 *
 * @param {string} value - the raw comma-separated input
 * @returns {boolean} - true if any segment is empty
 */
export function hasStrayCommaSegments(value: string): boolean {
    if (value.trim() === "") {
        return false
    }
    return value.split(",").some(segment => segment.trim() === "")
}

// ---------------------------------------------------------------------------
// Publication URI (shared by the client form and the server record validators)
// ---------------------------------------------------------------------------

// supported publication URI types; the uri_type is authoritative and a stored URI must match the shape
// of its declared type
export const SUPPORTED_URI_TYPES = ["https", "isbn", "doi"]

/**
 * Validates an ISBN-10 or ISBN-13 by its checksum (hyphens and spaces are ignored).
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
 * Validates that a publication URI matches its declared uri_type (the type is authoritative).
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

// ---------------------------------------------------------------------------
// Country code (composer/contributor country field)
// ---------------------------------------------------------------------------

// fallback "none" makes .of() return undefined for codes the runtime cannot resolve, which is the signal
// used for validation. The display-name resolver (countryCodeName) lives in the client format module.
const region_validator = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" })

/**
 * Normalizes a country code to the canonical ISO 3166-1 alpha-2 form (trimmed and uppercased).
 *
 * @param {string} code the raw country code
 * @returns {string} the trimmed, uppercased code
 */
export function normalizeCountryCode(code: string): string {
    return code.trim().toUpperCase()
}

/**
 * Whether the given string is a valid ISO 3166-1 alpha-2 country code.
 *
 * Enforces the two-letter alpha-2 shape (so numeric region codes such as "001" are rejected) and then
 * defers to Intl.DisplayNames: the code is valid iff the runtime resolves it to a region name.
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
