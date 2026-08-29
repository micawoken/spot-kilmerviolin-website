/**
 * lib/public/spam.ts
 *
 * Server-side public contact-form spam scoring
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

import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from "obscenity"

/** Sanitized submission fields to score */
export interface SpamScoreInput {
    subject: string
    name: string
    email: string
    phone: string
    body: string
}

/** Spam score and contributing flags */
export interface SpamScoreResult {
    score: number
    flags: string[]
}

// Reused matcher with normalized wordlist input
const wordlistMatcher = new RegExpMatcher({
    ...englishDataset.build(),
    ...englishRecommendedTransformers
})

/** Links in free text */
const LINK_PATTERN = /https?:\/\/([^\s/?#]+)/gi

/** Dotted-quad IPv4 host */
const BARE_IP_HOST = /^\d{1,3}(\.\d{1,3}){3}$/

/** Detects mixed Latin, Greek, or Cyrillic text */
function hasSuspiciousMixedScript(text: string): boolean {
    let latin = false
    let greekOrCyrillic = false
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0
        const isLatin =
            (code >= 0x0041 && code <= 0x005a) ||
            (code >= 0x0061 && code <= 0x007a) ||
            (code >= 0x00c0 && code <= 0x024f)
        const isGreekOrCyrillic = (code >= 0x0370 && code <= 0x03ff) || (code >= 0x0400 && code <= 0x052f)
        if (isLatin) latin = true
        else if (isGreekOrCyrillic) greekOrCyrillic = true
        else if (!/\p{Mark}|\p{Number}/u.test(char)) {
            latin = false
            greekOrCyrillic = false
        }
        if (latin && greekOrCyrillic) return true
    }
    return false
}

/**
 * Detects zero-width characters
 *
 * @param text the candidate text
 * @returns true if any character in text is one of the zero-width/invisible characters above
 */
function hasZeroWidthChar(text: string): boolean {
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0
        if ((code >= 0x200b && code <= 0x200d) || code === 0x2060 || code === 0xfeff) {
            return true
        }
    }
    return false
}

/** Six or more repeated characters */
const LONG_CHAR_RUN = /(.)\1{5,}/

/**
 * Scores a contact-form submission for spam
 *
 * @param input the sanitized submission fields
 * @returns the additive score and the flags that contributed to it (both empty for a clean submission)
 */
export function scoreSubmission(input: SpamScoreInput): SpamScoreResult {
    const flags: string[] = []
    let score = 0

    const add = (points: number, flag: string): void => {
        score += points
        flags.push(flag)
    }

    const body = input.body
    const combinedText = `${input.subject} ${input.name} ${body}`

    if (wordlistMatcher.hasMatch(combinedText)) {
        add(30, "wordlist-match")
    }

    const links = [...body.matchAll(LINK_PATTERN)]
    if (links.length > 2) {
        add(20, "many-links")
    } else if (links.length >= 1) {
        add(5, "has-link")
    }
    // Short link-heavy messages
    if (links.length >= 1 && body.trim().length < 200) {
        add(10, "link-heavy")
    }
    if (links.some((match) => BARE_IP_HOST.test(match[1]))) {
        add(20, "bare-ip-link")
    }
    if (links.some((match) => match[1].toLowerCase().includes("xn--"))) {
        add(15, "punycode-link")
    }

    const letters = body.match(/[A-Za-z]/g) ?? []
    const upper = body.match(/[A-Z]/g) ?? []
    if (letters.length >= 20 && upper.length / letters.length > 0.6) {
        add(15, "all-caps")
    }

    if (LONG_CHAR_RUN.test(body)) {
        add(10, "char-repeat")
    }

    if (hasSuspiciousMixedScript(combinedText)) {
        add(25, "mixed-script")
    }

    if (hasZeroWidthChar(combinedText)) {
        add(20, "zero-width-chars")
    }

    if (input.subject.trim() !== "" && input.subject.trim() === body.trim()) {
        add(10, "duplicate-subject")
    }

    return { score, flags }
}
