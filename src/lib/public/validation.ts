/**
 * lib/public/validation.ts
 *
 * Small, dependency-free validators shared by the admin pages. These are safe to import into Astro
 * page frontmatter (server-side) since they pull in no Cloudflare or database bindings.
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
