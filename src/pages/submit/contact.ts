/**
 * pages/submit/contact.ts
 *
 * Public contact-form submission endpoint
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

import type { APIRoute } from "astro"
import { env } from "cloudflare:workers"
import { dbWriteEnabled } from "../../lib/api/environment"
import { isValidEmail, isValidPhone } from "../../lib/api/validation"
import { cleanText, normalizeUnicodeForm } from "../../lib/api/sanitize"
import { scoreSubmission } from "../../lib/public/spam"
import { addContactResponse, ContactQueueFullError } from "../../lib/api/db_contact"
import { constructResponse, constructResponseErrorHook } from "../../lib/api/http"
import { readBoundedText, RequestBodyTooLargeError } from "../../lib/api/body"
import {
    MAX_NAME_LENGTH,
    MAX_CONTACT_BODY_LENGTH,
    MAX_CONTACT_EMAIL_LENGTH,
    MAX_CONTACT_PHONE_LENGTH,
    MAX_CONTACT_SOURCE_PATH_LENGTH,
    MAX_CONTACT_REQUEST_BODY_LENGTH
} from "../../consts"

/** Contact form request fields */
interface ContactSubmitBody {
    name: string
    subject: string
    email: string
    phone: string
    body: string
    source_path: string
    hp_website: string
    turnstileToken: string
}

const CONTACT_SUBMIT_KEYS: (keyof ContactSubmitBody)[] = [
    "name",
    "subject",
    "email",
    "phone",
    "body",
    "source_path",
    "hp_website",
    "turnstileToken"
]

function isContactSubmitBody(value: unknown): value is ContactSubmitBody {
    if (typeof value !== "object" || value === null) {
        return false
    }
    const record = value as Record<string, unknown>
    return CONTACT_SUBMIT_KEYS.every((key) => typeof record[key] === "string")
}

/**
 * Checks whether a request is same-origin
 */
function failsOriginCheck(request: Request): boolean {
    const origin = request.headers.get("Origin")
    if (origin === null) {
        // Require same-origin Fetch Metadata without Origin
        return request.headers.get("Sec-Fetch-Site") !== "same-origin"
    }
    try {
        return new URL(origin).origin !== new URL(request.url).origin
    } catch {
        return true
    }
}

interface TurnstileVerifyResult {
    success: boolean
}

/**
 * Verifies a Turnstile token
 */
async function verifyTurnstile(token: string, remoteIp: string): Promise<TurnstileVerifyResult> {
    const body = new URLSearchParams()
    body.set("secret", env.TURNSTILE_SECRET)
    body.set("response", token)
    if (remoteIp !== "unknown_ip") {
        body.set("remoteip", remoteIp)
    }
    let data: { success?: unknown }
    try {
        const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            body
        })
        data = await response.json()
    } catch {
        return { success: false }
    }
    return { success: data.success === true }
}

type ContactResponseStatus = 200 | 400 | 403 | 500 | 503

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;")
}

function submitResponse(request: Request, json: boolean, status: ContactResponseStatus, message: string): Response {
    if (json) return constructResponse(request, null, status, message)
    const title = status === 200 ? "Message received" : "Message not sent"
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><main><h1>${title}</h1><p>${escapeHtml(message)}</p><p><a href="/">Return to the site</a></p></main></body></html>`
    return new Response(body, {
        status,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "private, no-store, must-understand",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff"
        }
    })
}

function parseFormBody(rawBody: string): ContactSubmitBody {
    const params = new URLSearchParams(rawBody)
    const value = (name: string): string => params.get(name) ?? ""
    return {
        name: value("name"),
        subject: value("subject"),
        email: value("email"),
        phone: value("phone"),
        body: value("body"),
        source_path: value("source_path"),
        hp_website: value("hp_website"),
        turnstileToken: value("turnstileToken") || value("cf-turnstile-response")
    }
}

/**
 * Handles contact-form submissions
 *
 * @param context the Astro API context
 * @returns the submission response
 */
export const POST: APIRoute = async ({ request }): Promise<Response> => {
    const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase() ?? ""
    const json = contentType === "application/json"

    // Reject staging writes
    if (!dbWriteEnabled(request)) {
        return submitResponse(request, json, 503, "Submissions are not accepted in this environment")
    }

    // Reject cross-origin requests
    if (failsOriginCheck(request)) {
        return submitResponse(request, json, 403, "Cross-origin submission rejected")
    }

    // Validate request body
    let rawBody: string
    try {
        rawBody = await readBoundedText(request, MAX_CONTACT_REQUEST_BODY_LENGTH)
    } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
            return submitResponse(request, json, 400, "Request body is too large")
        }
        return submitResponse(request, json, 400, "Could not read request body")
    }
    let parsed: unknown
    if (json) {
        try {
            parsed = JSON.parse(rawBody)
        } catch {
            return submitResponse(request, true, 400, "Invalid request body: not valid JSON")
        }
    } else if (contentType === "application/x-www-form-urlencoded") {
        parsed = parseFormBody(rawBody)
    } else {
        return submitResponse(request, json, 400, "Unsupported form encoding")
    }
    if (!isContactSubmitBody(parsed)) {
        return submitResponse(request, json, 400, "Invalid request body: missing or non-string fields")
    }

    // Silently accept honeypot submissions
    if (parsed.hp_website.trim() !== "") {
        return submitResponse(request, json, 200, "Thank you. Your message has been received.")
    }

    // Verify Turnstile
    const remoteIp = request.headers.get("CF-Connecting-IP") ?? "unknown_ip"
    const turnstile = await verifyTurnstile(parsed.turnstileToken, remoteIp)
    if (!turnstile.success) {
        return submitResponse(request, json, 403, "Human verification failed")
    }

    // Sanitize and validate fields
    const name = normalizeUnicodeForm(cleanText(parsed.name))
    const subjectRaw = normalizeUnicodeForm(cleanText(parsed.subject))
    const email = cleanText(parsed.email)
    const phone = cleanText(parsed.phone)
    const body = normalizeUnicodeForm(cleanText(parsed.body))
    const sourcePathRaw = cleanText(parsed.source_path)

    if (name === "" || name.length > MAX_NAME_LENGTH) {
        return submitResponse(request, json, 400, `Name is required and must be ${MAX_NAME_LENGTH} characters or fewer`)
    }
    if (subjectRaw.length > MAX_NAME_LENGTH) {
        return submitResponse(request, json, 400, `Subject must be ${MAX_NAME_LENGTH} characters or fewer`)
    }
    if (body === "" || body.length > MAX_CONTACT_BODY_LENGTH) {
        return submitResponse(
            request,
            json,
            400,
            `Message is required and must be ${MAX_CONTACT_BODY_LENGTH} characters or fewer`
        )
    }
    if (email !== "" && (email.length > MAX_CONTACT_EMAIL_LENGTH || !isValidEmail(email))) {
        return submitResponse(request, json, 400, "Email address is invalid")
    }
    if (phone !== "" && (phone.length > MAX_CONTACT_PHONE_LENGTH || !isValidPhone(phone))) {
        return submitResponse(request, json, 400, "Phone number is invalid")
    }
    if (email === "" && phone === "") {
        return submitResponse(request, json, 400, "An email address or phone number is required")
    }

    const subject = subjectRaw === "" ? null : subjectRaw
    const sourcePath = sourcePathRaw === "" ? null : sourcePathRaw.slice(0, MAX_CONTACT_SOURCE_PATH_LENGTH)

    // Store advisory spam score
    const { score, flags } = scoreSubmission({ subject: subjectRaw, name, email, phone, body })

    // Store response
    try {
        await addContactResponse({
            subject,
            name,
            email: email === "" ? null : email,
            phone: phone === "" ? null : phone,
            body,
            source_path: sourcePath,
            spam_score: score,
            spam_flags: flags
        })
    } catch (error) {
        if (error instanceof ContactQueueFullError) {
            return submitResponse(
                request,
                json,
                503,
                "The contact form is temporarily unavailable; please try again later"
            )
        }
        if (json) return constructResponseErrorHook(request, error, 500, "Error recording submission")
        return submitResponse(request, false, 500, "The message could not be recorded. Please try again later.")
    }

    return submitResponse(request, json, 200, "Thank you. Your message has been received.")
}
