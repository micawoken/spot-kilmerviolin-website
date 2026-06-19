import { describe, it, expect } from "vitest"

import { isFallbackEmail, generateFallbackEmail, resolveIdentityEmail, FALLBACK_EMAIL_DOMAIN } from "../src/lib/api/fallback.ts"

describe("isFallbackEmail", () => {
    it("matches generated fallback addresses", () => {
        expect(isFallbackEmail("fallback+first_last-8362@mwmsc.net")).toBe(true)
        expect(isFallbackEmail(generateFallbackEmail("First Last"))).toBe(true)
    })

    it("matches the whole reserved namespace, not just the generated form", () => {
        // any local part beginning fallback+ at the reserved domain is reserved
        expect(isFallbackEmail("fallback+@mwmsc.net")).toBe(true)
        expect(isFallbackEmail("fallback+anything-goes-here@mwmsc.net")).toBe(true)
        // case-insensitive and tolerant of surrounding whitespace
        expect(isFallbackEmail("  FALLBACK+First_Last-1234@MWMSC.NET  ")).toBe(true)
    })

    it("does not match real addresses", () => {
        expect(isFallbackEmail("person@mwmsc.net")).toBe(false)
        expect(isFallbackEmail("fallback@mwmsc.net")).toBe(false) // no + subaddress
        expect(isFallbackEmail("fallback+first_last-8362@example.com")).toBe(false) // wrong domain
        expect(isFallbackEmail("")).toBe(false)
    })
})

describe("generateFallbackEmail", () => {
    it("slugifies the name: lowercase, spaces to underscores, other chars stripped", () => {
        const email = generateFallbackEmail("First Last")
        expect(email).toMatch(/^fallback\+first_last-\d{4}@mwmsc\.net$/)
    })

    it("strips characters that are not alphanumeric or underscore (including hyphens)", () => {
        // hyphens are stripped so the -{nnnn} suffix stays an unambiguous delimiter
        const email = generateFallbackEmail("Ada O'Neil-Smith, Jr.")
        expect(email).toMatch(/^fallback\+ada_oneilsmith_jr-\d{4}@mwmsc\.net$/)
    })

    it("always ends with a four-digit suffix and the reserved domain", () => {
        const email = generateFallbackEmail("Someone")
        expect(email.endsWith(`@${FALLBACK_EMAIL_DOMAIN}`)).toBe(true)
        expect(email).toMatch(/-\d{4}@/)
    })

    it("falls back to a stable local part when the name slugifies to nothing", () => {
        const email = generateFallbackEmail("！＠＃")
        expect(email).toMatch(/^fallback\+contributor-\d{4}@mwmsc\.net$/)
    })

    it("produces addresses recognized as fallback emails", () => {
        for (const name of ["First Last", "x", "！＠＃", "Multiple   Spaces"]) {
            expect(isFallbackEmail(generateFallbackEmail(name))).toBe(true)
        }
    })
})

describe("resolveIdentityEmail", () => {
    it("returns a real supplied email unchanged", () => {
        expect(resolveIdentityEmail("person@example.com", "First Last")).toBe("person@example.com")
    })

    it("normalizes a supplied email to lowercase (matching the case-insensitive Access address)", () => {
        // a mixed-case address must persist lowercased so it matches the lowercased JWT email used at
        // identity lookup; otherwise a User@Example.com login would miss its own contributor record
        expect(resolveIdentityEmail("User@Example.com", "First Last")).toBe("user@example.com")
        expect(resolveIdentityEmail("  Mixed.Case@Domain.COM  ", "First Last")).toBe("mixed.case@domain.com")
    })

    it("generates a fallback when the email is blank, whitespace, null, or omitted", () => {
        expect(isFallbackEmail(resolveIdentityEmail("", "First Last"))).toBe(true)
        expect(isFallbackEmail(resolveIdentityEmail("   ", "First Last"))).toBe(true)
        expect(isFallbackEmail(resolveIdentityEmail(null, "First Last"))).toBe(true)
        expect(isFallbackEmail(resolveIdentityEmail(undefined, "First Last"))).toBe(true)
    })
})
