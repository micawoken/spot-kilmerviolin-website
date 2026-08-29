/**
 * pages/api/v1/contact.ts
 *
 * Admin contact-response management
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
import { auth_check } from "../../../lib/public/authservice"
import { constructResponse, constructResponseErrorHook, constructFileResponse } from "../../../lib/api/http"
import { toCsv } from "../../../lib/api/csv"
import { listContactResponses, setContactResponsesRead, deleteContactResponses } from "../../../lib/api/db_contact"
import { MAX_CONTACT_ADMIN_REQUEST_BODY_LENGTH, MAX_CONTACT_BULK_IDS } from "../../../consts"
import { readBoundedText, RequestBodyTooLargeError } from "../../../lib/api/body"

const CSV_COLUMNS = [
    "id",
    "subject",
    "name",
    "email",
    "phone",
    "body",
    "source_path",
    "spam_score",
    "spam_flags",
    "read",
    "entry_date"
]

function toCsvRow(record: ContactResponseRecord): Record<string, string | number | null> {
    return {
        id: record.id,
        subject: record.subject,
        name: record.name,
        email: record.email,
        phone: record.phone,
        body: record.body,
        source_path: record.source_path,
        spam_score: record.spam_score,
        spam_flags: record.spam_flags.join(", "),
        read: record.read ? "yes" : "no",
        entry_date: new Date(record.entry_date).toISOString()
    }
}

/**
 * Parses a JSON request body
 *
 * @returns the parsed body or an error message
 */
async function parseJsonBody(request: Request): Promise<unknown | string> {
    try {
        const raw = await readBoundedText(request, MAX_CONTACT_ADMIN_REQUEST_BODY_LENGTH)
        return JSON.parse(raw)
    } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
            return `Invalid request body: maximum size is ${MAX_CONTACT_ADMIN_REQUEST_BODY_LENGTH} bytes`
        }
        return "Invalid request body: not valid JSON"
    }
}

/**
 * Validates request ids
 *
 * @returns validated ids or an error message
 */
function validateIds(parsed: unknown): number[] | string {
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { ids?: unknown }).ids)) {
        return "Invalid request body: must be an object with an 'ids' array"
    }
    const ids = (parsed as { ids: unknown[] }).ids
    if (ids.length === 0 || !ids.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0)) {
        return "Invalid request body: 'ids' must be a non-empty array of positive integers"
    }
    if (ids.length > MAX_CONTACT_BULK_IDS) {
        return `Invalid request body: 'ids' may contain at most ${MAX_CONTACT_BULK_IDS} items`
    }
    return [...new Set(ids as number[])]
}

/**
 * Lists contact responses or exports CSV
 *
 * @param context - the Astro API context
 * @returns the response list as JSON, or a CSV attachment when ?format=csv is set
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { request, locals, url } = context
    const auth_response = auth_check(request, locals.identity, ["public_form_responses"])
    if (auth_response !== null) {
        return auth_response
    }
    try {
        const records = await listContactResponses()
        if (url.searchParams.get("format") === "csv") {
            const csv = toCsv(CSV_COLUMNS, records.map(toCsvRow))
            return constructFileResponse(request, csv, "text/csv; charset=utf-8", 0, {
                "Content-Disposition": 'attachment; filename="contact-responses.csv"'
            })
        }
        return constructResponse(request, records, 200)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Error listing contact responses")
    }
}

/**
 * Marks contact responses read or unread
 *
 * @param context - the Astro API context
 * @returns 204 on success
 */
export const PATCH: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    const auth_response = auth_check(request, locals.identity, ["public_form_responses"])
    if (auth_response !== null) {
        return auth_response
    }
    const parsed = await parseJsonBody(request)
    if (typeof parsed === "string") {
        return constructResponse(request, null, 400, parsed)
    }
    if (typeof (parsed as { read?: unknown })?.read !== "boolean") {
        return constructResponse(request, null, 400, "Invalid request body: 'read' must be a boolean")
    }
    const read = (parsed as { read: boolean }).read
    const ids = validateIds(parsed)
    if (typeof ids === "string") {
        return constructResponse(request, null, 400, ids)
    }
    try {
        await setContactResponsesRead(ids, read)
        return constructResponse(request, null, 204)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Error updating contact responses")
    }
}

/**
 * Deletes contact responses
 *
 * @param context - the Astro API context
 * @returns 204 on success
 */
export const DELETE: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    const auth_response = auth_check(request, locals.identity, ["public_form_responses"])
    if (auth_response !== null) {
        return auth_response
    }
    const parsed = await parseJsonBody(request)
    if (typeof parsed === "string") {
        return constructResponse(request, null, 400, parsed)
    }
    const ids = validateIds(parsed)
    if (typeof ids === "string") {
        return constructResponse(request, null, 400, ids)
    }
    try {
        await deleteContactResponses(ids)
        return constructResponse(request, null, 204)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Error deleting contact responses")
    }
}
