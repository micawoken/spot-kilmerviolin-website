/**
 * lib/api/fallback.ts
 *
 * Generates and identifies fallback identity emails
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

import { env } from "cloudflare:workers"

/**
 * Returns the reserved domain for fallback identity emails, read from the FALLBACK_EMAIL_DOMAIN
 * wrangler var so it isn't hardcoded to this deployment's domain.
 *
 * @returns {string} - the configured fallback email domain
 */
export function fallbackEmailDomain(): string {
    return env.FALLBACK_EMAIL_DOMAIN
}

/**
 * Escapes characters with special meaning in a regular expression, so an arbitrary string (such as a
 * configured domain) can be embedded literally in one.
 *
 * @param {string} str - the string to escape
 * @returns {string} - the escaped string
 */
function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Builds the pattern matching any address whose local part begins with the "fallback+" subaddress
 * prefix at the reserved domain, case-insensitively. Built fresh from the configured domain on each
 * call rather than compiled once at module load, since env is not guaranteed to be populated yet at
 * that point.
 *
 * @returns {RegExp} - the fallback email pattern
 */
function fallbackEmailPattern(): RegExp {
    return new RegExp(`^fallback\\+[^@]*@${escapeRegExp(fallbackEmailDomain())}$`, "i")
}

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
    return fallbackEmailPattern().test(email.trim())
}

/**
 * Builds a placeholder identity email
 *
 * Formatted as fallback+{slug}-{suffix}@{fallbackEmailDomain()}
 *
 * @param {string} name - the contributor's name, used to make the address human-recognizable
 * @returns {string} - a generated fallback identity email
 */
export function generateFallbackEmail(name: string): string {
    const slug = name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "")
    // a name that slugifies to nothing (empty or all-special) still needs a stable, valid local part
    const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, "0")
    return `fallback+${slug || "contributor"}-${suffix}@${fallbackEmailDomain()}`
}

/**
 * Returns an identity email, either using the provided email or by generating a fallback
 *
 * @param {unknown} email - the submitted identity_email value (may be missing, null, or blank)
 * @param {string} name - the contributor's name, used to generate a fallback when needed
 * @returns {string} - the email to persist
 */
export function resolveIdentityEmail(email: unknown, name: string): string {
    if (typeof email === "string" && email.trim() !== "") {
        // store lowercased so it matches the (case-insensitive) Cloudflare Access address and the
        // lowercased JWT email used for identity lookups
        return email.trim().toLowerCase()
    }
    return generateFallbackEmail(name)
}
