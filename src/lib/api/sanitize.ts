/**
 * lib/api/sanitize.ts
 *
 * Data-hygiene helpers shared by the server-side record validators (lib/api/d1.ts) and the client-side CSV
 * import pipeline (scripts/import_build.ts)
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

import { isValidISBN, NOTE_SEMITONE } from "./validation"

/**
 * Whether a character is a non-printable control character: a C0 control other than tab/LF/CR, the DEL
 * character, or a C1 control. Used by {@link stripControlCharacters} to drop exactly these while leaving
 * ordinary whitespace untouched.
 */
function isControlCharacter(char: string): boolean {
    const code = char.codePointAt(0) ?? 0
    const isC0Control = code <= 0x1f && char !== "\t" && char !== "\n" && char !== "\r"
    const isDelOrC1Control = code === 0x7f || (code >= 0x80 && code <= 0x9f)
    return isC0Control || isDelOrC1Control
}

/**
 * Strips non-printable control characters from a string (see {@link isControlCharacter})
 *
 * @param value the candidate string
 * @returns the string with control characters removed
 */
export function stripControlCharacters(value: string): string {
    let result = ""
    for (const char of value) {
        if (!isControlCharacter(char)) {
            result += char
        }
    }
    return result
}

/**
 * Cleans a free-text value for storage: strips control characters, then trims leading/trailing whitespace
 *
 * @param value the candidate string
 * @returns the cleaned string
 */
export function cleanText(value: string): string {
    return stripControlCharacters(value).trim()
}

/**
 * Normalizes a string to Unicode NFC (canonical composition) so two visually-identical strings entered
 * with different Unicode compositions (e.g. a precomposed accented letter vs. the base letter plus a
 * combining accent) compare and dedupe as the same value
 *
 * @param value the candidate string
 * @returns the NFC-normalized string
 */
export function normalizeUnicodeForm(value: string): string {
    return value.normalize("NFC")
}

/**
 * Case-insensitively matches `value` against a string enum's members and returns the member's canonical
 * (correctly-cased) form, or null when none match
 *
 * @param value the candidate string
 * @param members the enum's string values (e.g. `Object.values(WorkType)`)
 * @returns the matching member's canonical form, or null if none match
 */
export function canonicalEnumValue(value: string, members: readonly string[]): string | null {
    const target = value.trim().toLowerCase()
    for (const candidate of members) {
        if (candidate.toLowerCase() === target) {
            return candidate
        }
    }
    return null
}

/** The outcome of {@link sanitizeTags}: the cleaned, deduplicated list, or an error naming what was rejected. */
export interface TagHygieneResult {
    tags: string[]
    error: string | null
}

/**
 * Cleans a candidate tag list: strips control characters and trims each tag, drops blanks, and
 * case-insensitively deduplicates (the first-seen casing wins)
 *
 * @param raw the candidate tag strings
 * @param maxTagLength the maximum length of a single tag
 * @param maxTagCount the maximum number of (deduplicated) tags
 * @returns the cleaned tags, plus an error message when a limit was exceeded
 */
export function sanitizeTags(raw: string[], maxTagLength: number, maxTagCount: number): TagHygieneResult {
    const seen = new Set<string>()
    const tags: string[] = []
    for (const entry of raw) {
        const cleaned = cleanText(entry)
        if (cleaned === "") {
            continue
        }
        const key = cleaned.toLowerCase()
        if (seen.has(key)) {
            continue
        }
        seen.add(key)
        tags.push(cleaned)
    }
    const tooLong = tags.find((tag) => tag.length > maxTagLength)
    if (tooLong !== undefined) {
        return { tags, error: `tag "${tooLong}" exceeds ${maxTagLength} characters` }
    }
    if (tags.length > maxTagCount) {
        return { tags, error: `too many tags (${tags.length}); at most ${maxTagCount} are allowed` }
    }
    return { tags, error: null }
}

/**
 * Converts a checksum-valid ISBN-10 to its canonical ISBN-13 form (prefixed "978", with a recomputed check
 * digit), returned as 13 bare digits with no separators
 *
 * @param value the candidate ISBN (hyphens/spaces are ignored)
 * @returns the converted ISBN-13, or null when `value` is not a checksum-valid ISBN-10
 */
export function isbn10To13(value: string): string | null {
    const digits = value.replace(/[\s-]/g, "")
    if (!/^\d{9}[\dXx]$/.test(digits) || !isValidISBN(digits)) {
        return null
    }
    const first12 = "978" + digits.slice(0, 9)
    let sum = 0
    for (let i = 0; i < 12; i++) {
        sum += (i % 2 === 0 ? 1 : 3) * parseInt(first12[i], 10)
    }
    const check = (10 - (sum % 10)) % 10
    return first12 + check.toString()
}

/**
 * Prefers ISBN-13 over ISBN-10: when `value` is a checksum-valid ISBN-10, returns its converted ISBN-13
 * form; otherwise returns `value` unchanged
 *
 * @param value the candidate ISBN
 * @returns the ISBN-13-preferring form
 */
export function preferIsbn13(value: string): string {
    return isbn10To13(value) ?? value
}

/**
 * Extracts the first run of digits in `text` as a number, or null when none is present. Used to pull a
 * number out of free text a spreadsheet cell was never meant to carry (e.g. "c. 1923" -> 1923, "Level 5
 * stars" -> 5) — CSV-import-only, since a purpose-built form field would just be typed correctly
 *
 * @param text the candidate text
 * @returns the first embedded integer, or null if none is present
 */
export function extractLeadingInt(text: string): number | null {
    const match = /\d+/.exec(text)
    return match === null ? null : parseInt(match[0], 10)
}

/**
 * Splits `text` on runs of non-alphanumeric characters and returns the first resulting token for which
 * `isValid` returns true, or null if none qualifies
 *
 * @param text the candidate text
 * @param isValid the per-token acceptance test
 * @returns the first qualifying token, or null if none qualifies
 */
export function extractFirstValidToken(text: string, isValid: (token: string) => boolean): string | null {
    const tokens = text.split(/[^A-Za-z0-9]+/).filter((token) => token.length > 0)
    for (const token of tokens) {
        if (isValid(token)) {
            return token
        }
    }
    return null
}

/** The seven diatonic letters in pitch order, starting at C (mirrors {@link NOTE_SEMITONE}'s octave convention). */
const LETTER_ORDER = ["C", "D", "E", "F", "G", "A", "B"] as const

/**
 * Respells a double-sharp ("Fx3") or double-flat ("Fbb3") note to enharmonic, since database doesn't
 * support double sharp or flat
 *
 * @param note a single range endpoint (e.g. "Fx3")
 * @returns the respelled note (e.g. "G3"), or null when `note` is not a double-accidental note
 */
export function respellDoubleAccidental(note: string): string | null {
    const match = /^([A-G])(x|bb)(\d{1,2})$/i.exec(note.trim())
    if (match === null) {
        return null
    }
    const letter = match[1].toUpperCase()
    const isSharp = match[2].toLowerCase() === "x"
    const octave = parseInt(match[3], 10)
    const index = LETTER_ORDER.indexOf(letter as (typeof LETTER_ORDER)[number])
    const neighbor = LETTER_ORDER[isSharp ? (index + 1) % 7 : (index + 6) % 7]
    const raw = NOTE_SEMITONE[letter] + (isSharp ? 2 : -2)
    const wrapped = ((raw % 12) + 12) % 12
    const isNatural = wrapped === NOTE_SEMITONE[neighbor]
    const spelling = isNatural ? neighbor : `${neighbor}${isSharp ? "#" : "b"}`
    const crossesUp = isSharp && letter === "B" // Bx -> C(#), which is in the next octave
    const crossesDown = !isSharp && letter === "C" // Cbb -> B(b), which is in the previous octave
    const newOctave = crossesUp ? octave + 1 : crossesDown ? octave - 1 : octave
    return `${spelling}${newOctave}`
}

/**
 * Cleans a range cell for validation (CSV-import-only)
 *
 * @param raw the candidate range cell (e.g. "g3 - a5" or "Fx3-A5")
 * @returns the cleaned range string
 */
export function cleanPitchRangeCell(raw: string): string {
    const trimmed = raw.trim()
    const dashIndex = trimmed.indexOf("-")
    if (dashIndex === -1) {
        return trimmed
    }
    const cleanComponent = (component: string): string => {
        const piece = component.trim()
        const respelled = respellDoubleAccidental(piece)
        if (respelled !== null) {
            return respelled
        }
        return piece.length > 0 ? piece.charAt(0).toUpperCase() + piece.slice(1) : piece
    }
    return `${cleanComponent(trimmed.slice(0, dashIndex))}-${cleanComponent(trimmed.slice(dashIndex + 1))}`
}

/**
 * Infers a publication URI's type by sniffing its shape (CSV-import-only companion to
 * `classifyCitationValue`, which does the same for a citation value): an https link, a DOI, or an ISBN.
 *
 * @param uri the candidate URI value
 * @returns the inferred type, or null if it matches none
 */
export function inferUriType(uri: string): "https" | "doi" | "isbn" | null {
    const trimmed = uri.trim()
    if (trimmed === "") {
        return null
    }
    try {
        if (new URL(trimmed).protocol === "https:") {
            return "https"
        }
    } catch {
        // not a URL at all; fall through to the DOI/ISBN checks
    }
    if (/^10\.\d{4,9}\/\S+$/.test(trimmed)) {
        return "doi"
    }
    if (isValidISBN(trimmed)) {
        return "isbn"
    }
    return null
}
