/**
 * lib/api/country.ts
 *
 * Country code helpers shared by the client interface and the server-side API.
 *
 * Composer countries are standardized to ISO 3166-1 alpha-2 codes. Both validation and display defer to
 * the runtime's Intl.DisplayNames "region" data — which is available in the browser and in the Cloudflare
 * Workers V8 isolate alike — so there is no hand-maintained country table to keep in sync: a code is
 * accepted iff the runtime can resolve it to a region name, and that same resolution is what users see.
 */

// fallback "none" makes .of() return undefined for codes the runtime cannot resolve, which is the signal
// used for validation; the display instance falls back to the code so an unexpected value still renders.
const region_validator = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" })
const region_display = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" })

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

/**
 * Resolves a country code to its English display name, falling back to the normalized code itself when
 * the runtime cannot resolve it.
 *
 * @param {string} code the ISO 3166-1 alpha-2 country code
 * @returns {string} the English country name, or the normalized code if it cannot be resolved
 */
export function countryCodeName(code: string): string {
    const normalized = normalizeCountryCode(code)
    try {
        return region_display.of(normalized) ?? normalized
    } catch {
        return normalized
    }
}
