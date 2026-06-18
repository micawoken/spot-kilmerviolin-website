/**
 * lib/api/fallback.ts
 *
 * Generates and identifies fallback identity emails
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

/**
 * Fallback emails are used when a contributor record cannot be associated with an Access login (such as if the email is not known)
 * 
 * The system auto-generates a fallback using contributor information, and when encountered, fallback emails are denied permissions to use the system
 * 
 */

/** The reserved domain for fallback identity emails. */
export const FALLBACK_EMAIL_DOMAIN = "mwmsc.net"

// matches any address whose local part begins with the "fallback+" subaddress prefix at the reserved
// domain, case-insensitively; the local part is normalized to lowercase elsewhere, but real-world input
// (manual entry, JWT claims) may not be, so the match is deliberately permissive
const FALLBACK_EMAIL_PATTERN = /^fallback\+[^@]*@mwmsc\.net$/i

/**
 * Returns whether an email is (or could be) a system-generated fallback identity email. Any address in
 * the reserved fallback namespace matches, regardless of the specific slug/suffix, so every generated
 * variant — and any hand-crafted lookalike — is recognized and kept out of authentication and Access.
 *
 * @param {string} email - the email address to test
 * @returns {boolean} - true if the address belongs to the reserved fallback namespace
 */
export function isFallbackEmail(email: string): boolean {
    // tolerate non-string/blank input (e.g. a malformed JWT claim) by reporting "not a fallback" rather
    // than throwing, so this verification can never abort the request that is checking an address
    if (typeof email !== "string") {
        return false
    }
    return FALLBACK_EMAIL_PATTERN.test(email.trim())
}

/**
 * Builds a placeholder identity email for a contributor who has no real sign-in email, so the
 * identity_email NOT NULL UNIQUE constraint is preserved. The local part is fallback+{slug}-{nnnn}, where
 * the slug is the lowercased name with whitespace collapsed to underscores and every other character
 * stripped (keeping the local part email-safe), and nnnn is a pseudorandom four-digit number that
 * distinguishes records whose names slugify identically. Example: fallback+first_last-8362@mwmsc.net
 *
 * @param {string} name - the contributor's name, used to make the address human-recognizable
 * @returns {string} - a generated fallback identity email
 */
export function generateFallbackEmail(name: string): string {
    const slug = name.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")
    // a name that slugifies to nothing (empty or all-special) still needs a stable, valid local part
    const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, "0")
    return `fallback+${slug || "contributor"}-${suffix}@${FALLBACK_EMAIL_DOMAIN}`
}

/**
 * Returns the identity email to store for a contributor: the supplied email when the caller provided a
 * real (non-blank) one, otherwise a freshly generated fallback (see generateFallbackEmail). Used by the
 * contributor write endpoints to fill a blank/omitted identity_email before validation.
 *
 * @param {unknown} email - the submitted identity_email value (may be missing, null, or blank)
 * @param {string} name - the contributor's name, used to generate a fallback when needed
 * @returns {string} - the email to persist
 */
export function resolveIdentityEmail(email: unknown, name: string): string {
    if (typeof email === "string" && email.trim() !== "") {
        return email
    }
    return generateFallbackEmail(name)
}
