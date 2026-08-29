/**
 * tests/spam.test.ts
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

import { describe, it, expect } from "vitest"
import { scoreSubmission, type SpamScoreInput } from "../src/lib/public/spam"

function makeInput(overrides: Partial<SpamScoreInput> = {}): SpamScoreInput {
    return {
        subject: "Question about a composer",
        name: "Ada Lovelace",
        email: "ada@example.test",
        phone: "",
        body: "I noticed the birth year on this page looks off. Could you double check it?",
        ...overrides
    }
}

describe("scoreSubmission", () => {
    it("scores a clean, ordinary message at zero with no flags", () => {
        const result = scoreSubmission(makeInput())
        expect(result).toEqual({ score: 0, flags: [] })
    })

    it("flags a wordlist match", () => {
        const result = scoreSubmission(makeInput({ body: "check out this fuck great deal" }))
        expect(result.flags).toContain("wordlist-match")
        expect(result.score).toBeGreaterThan(0)
    })

    it("flags many links, distinctly from a single link", () => {
        const single = scoreSubmission(makeInput({ body: "See https://example.test/page for details." }))
        expect(single.flags).toContain("has-link")
        expect(single.flags).not.toContain("many-links")

        const many = scoreSubmission(
            makeInput({
                body: "https://a.test https://b.test https://c.test"
            })
        )
        expect(many.flags).toContain("many-links")
        expect(many.score).toBeGreaterThan(single.score)
    })

    it("flags a short, link-heavy body", () => {
        const result = scoreSubmission(makeInput({ body: "https://spam.test/x" }))
        expect(result.flags).toContain("link-heavy")
    })

    it("flags a bare-IP link", () => {
        const result = scoreSubmission(makeInput({ body: "Visit http://203.0.113.5/offer for a surprise." }))
        expect(result.flags).toContain("bare-ip-link")
    })

    it("flags a punycode link", () => {
        const result = scoreSubmission(makeInput({ body: "Check http://xn--exmple-cua.test/ out." }))
        expect(result.flags).toContain("punycode-link")
    })

    it("flags an all-caps body", () => {
        const result = scoreSubmission(makeInput({ body: "THIS MESSAGE IS ENTIRELY SHOUTED AT YOU RIGHT NOW" }))
        expect(result.flags).toContain("all-caps")
    })

    it("does not flag all-caps for a short body under the letter-count floor", () => {
        const result = scoreSubmission(makeInput({ body: "HI" }))
        expect(result.flags).not.toContain("all-caps")
    })

    it("flags a long repeated-character run", () => {
        const result = scoreSubmission(makeInput({ body: "soooooooo good!!!!!!" }))
        expect(result.flags).toContain("char-repeat")
    })

    it("flags mixed-script (Latin text mixed with Cyrillic/Greek) content", () => {
        // Cyrillic small letter er
        const cyrillicR = String.fromCodePoint(0x0440)
        const result = scoreSubmission(makeInput({ body: `Please${cyrillicR}espond soon, thanks.` }))
        expect(result.flags).toContain("mixed-script")
    })

    it("does not flag legitimate Greek or Cyrillic text", () => {
        const greek = String.fromCodePoint(0x0393, 0x03b5, 0x03b9, 0x03ac)
        const cyrillic = String.fromCodePoint(0x041f, 0x0440, 0x0438, 0x0432, 0x0435, 0x0442)
        expect(
            scoreSubmission(makeInput({ subject: "", name: greek, body: `${greek} ${cyrillic}` })).flags
        ).not.toContain("mixed-script")
    })

    it("flags zero-width characters used to evade wordlist matching", () => {
        // Zero-width space
        const zeroWidthSpace = String.fromCodePoint(0x200b)
        const result = scoreSubmission(makeInput({ body: `Hel${zeroWidthSpace}lo there, just saying hi.` }))
        expect(result.flags).toContain("zero-width-chars")
    })

    it("flags a subject that exactly duplicates the body", () => {
        const result = scoreSubmission(makeInput({ subject: "Same text", body: "Same text" }))
        expect(result.flags).toContain("duplicate-subject")
    })

    it("does not flag duplicate-subject when the subject is blank", () => {
        const result = scoreSubmission(makeInput({ subject: "", body: "" }))
        expect(result.flags).not.toContain("duplicate-subject")
    })

    it("accumulates points across multiple independent signals", () => {
        const result = scoreSubmission(
            makeInput({
                subject: "URGENT OFFER URGENT OFFER URGENT OFFER URGENT OFFER",
                body: "URGENT OFFER URGENT OFFER URGENT OFFER URGENT OFFER"
            })
        )
        expect(result.flags).toContain("all-caps")
        expect(result.flags).toContain("duplicate-subject")
        expect(result.flags.length).toBeGreaterThanOrEqual(2)
    })
})
