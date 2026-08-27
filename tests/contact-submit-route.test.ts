/**
 * Copyright (C) 2026 Michael Wong.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { env } from "cloudflare:workers"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applySqlMigration } from "./helpers/d1"

const environmentState = vi.hoisted(() => ({ dbWriteEnabled: true }))

vi.mock("../src/lib/api/environment", async (importOriginal) => {
    const original = await importOriginal<typeof import("../src/lib/api/environment")>()
    return { ...original, dbWriteEnabled: () => environmentState.dbWriteEnabled }
})

import { POST } from "../src/pages/submit/contact"

const migration = Object.values(
    import.meta.glob("../migrations/0001_contact_responses.sql", {
        query: "?raw",
        import: "default",
        eager: true
    })
)[0] as string

const validBody = {
    name: "Ada Lovelace",
    subject: "Question",
    email: "ada@example.test",
    phone: "",
    body: "Could you tell me more about this page?",
    source_path: "/contact",
    hp_website: "",
    turnstileToken: "verified-token"
}

function request(body: BodyInit, contentType = "application/json", headers: HeadersInit = {}): Request {
    return new Request("http://localhost/submit/contact", {
        method: "POST",
        headers: {
            "Content-Type": contentType,
            Origin: "http://localhost",
            "Sec-Fetch-Site": "same-origin",
            ...headers
        },
        body
    })
}

async function submit(input: Request): Promise<Response> {
    return POST({ request: input } as Parameters<typeof POST>[0])
}

beforeEach(async () => {
    environmentState.dbWriteEnabled = true
    await env.DB_MAIN.exec("DROP TABLE IF EXISTS contact_responses;")
    await applySqlMigration(env.DB_MAIN, migration)
    vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(() => Promise.resolve(Response.json({ success: true })))
    )
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("POST /submit/contact", () => {
    it("rejects an environment where writes are disabled", async () => {
        environmentState.dbWriteEnabled = false
        expect((await submit(request(JSON.stringify(validBody)))).status).toBe(503)
        expect(fetch).not.toHaveBeenCalled()
    })

    it("enforces Origin and Fetch Metadata before verification", async () => {
        const crossOrigin = request(JSON.stringify(validBody), "application/json", { Origin: "https://evil.test" })
        expect((await submit(crossOrigin)).status).toBe(403)

        const missingOrigin = new Request("http://localhost/submit/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
            body: JSON.stringify(validBody)
        })
        expect((await submit(missingOrigin)).status).toBe(403)

        const sameOriginMetadata = new Request("http://localhost/submit/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
            body: JSON.stringify(validBody)
        })
        expect((await submit(sameOriginMetadata)).status).toBe(200)
        expect(fetch).toHaveBeenCalledOnce()
    })

    it("rejects malformed and oversized bodies before verification", async () => {
        expect((await submit(request("{"))).status).toBe(400)
        expect((await submit(request("x".repeat(9000)))).status).toBe(400)
        expect(fetch).not.toHaveBeenCalled()
    })

    it("silently accepts the honeypot without verifying or storing", async () => {
        const response = await submit(request(JSON.stringify({ ...validBody, hp_website: "bot.example" })))
        expect(response.status).toBe(200)
        expect(fetch).not.toHaveBeenCalled()
        expect(await env.DB_MAIN.prepare("SELECT COUNT(*) AS count FROM contact_responses;").first("count")).toBe(0)
    })

    it("rejects failed verification and invalid required/contact fields", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockImplementation(() => Promise.resolve(Response.json({ success: false })))
        )
        expect((await submit(request(JSON.stringify(validBody)))).status).toBe(403)

        vi.stubGlobal(
            "fetch",
            vi.fn().mockImplementation(() => Promise.resolve(Response.json({ success: true })))
        )
        expect((await submit(request(JSON.stringify({ ...validBody, name: "" })))).status).toBe(400)
        expect((await submit(request(JSON.stringify({ ...validBody, body: "" })))).status).toBe(400)
        expect((await submit(request(JSON.stringify({ ...validBody, email: "", phone: "" })))).status).toBe(400)
        expect((await submit(request(JSON.stringify({ ...validBody, email: "invalid" })))).status).toBe(400)
    })

    it("stores a valid first-attempt submission", async () => {
        const response = await submit(request(JSON.stringify(validBody)))
        expect(response.status).toBe(200)
        expect(fetch).toHaveBeenCalledTimes(1)
        const stored = await env.DB_MAIN.prepare(
            "SELECT name, email, body, source_path FROM contact_responses LIMIT 1;"
        ).first<Record<string, string>>()
        expect(stored).toEqual({
            name: validBody.name,
            email: validBody.email,
            body: validBody.body,
            source_path: validBody.source_path
        })
    })

    it("returns a no-store HTML failure for native form posts without putting PII in the URL", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockImplementation(() => Promise.resolve(Response.json({ success: false })))
        )
        const form = new URLSearchParams({
            name: "Private Name",
            email: "private@example.test",
            body: "Private message",
            source_path: "/contact"
        })
        const input = request(form, "application/x-www-form-urlencoded")
        const response = await submit(input)
        expect(input.url).toBe("http://localhost/submit/contact")
        expect(response.status).toBe(403)
        expect(response.headers.get("Content-Type")).toContain("text/html")
        expect(response.headers.get("Cache-Control")).toContain("no-store")
        expect(await response.text()).not.toContain("Private message")
    })

    it("returns 503 when the contact table is unavailable", async () => {
        await env.DB_MAIN.exec("DROP TABLE contact_responses;")
        expect((await submit(request(JSON.stringify(validBody)))).status).toBe(503)
    })

    it("returns 503 without changing the queue when all 500 responses are unread", async () => {
        await env.DB_MAIN.prepare(
            `WITH RECURSIVE counter(value) AS (
                SELECT 1
                UNION ALL
                SELECT value + 1 FROM counter WHERE value < 500
            )
            INSERT INTO contact_responses
                (name, email, body, spam_score, entry_date, change_date)
            SELECT 'Queued', 'queued@example.test', 'Waiting', 0, value, value FROM counter;`
        ).run()

        expect((await submit(request(JSON.stringify(validBody)))).status).toBe(503)
        expect(await env.DB_MAIN.prepare("SELECT COUNT(*) AS count FROM contact_responses;").first("count")).toBe(500)
    })
})
