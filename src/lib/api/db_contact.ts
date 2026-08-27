/**
 * lib/api/db_contact.ts
 *
 * Data-access layer for public contact-form submissions
 *
 * Deliberately bypasses database.ts's cache-aware primitives (see d1.ts's CONTACT_RESPONSE comment): this
 * table is written by the public /submit/contact endpoint and read only by the admin UI, has no caching
 * need, and needs its own capped-queue behavior on insert. Queries go straight through d1.ts's exec_string,
 * mirroring tokens.ts (the other table that bypasses database.ts) rather than db_composer.ts.
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

import { exec_string } from "./d1.ts"
const CONTACT_RESPONSE_COLUMNS =
    "response_id, subject, name, email, phone, body, source_path, spam_score, spam_flags, read_at, entry_date, change_date"

function formatContactFromD1(record: D1ContactResponse): ContactResponseRecord {
    const { response_id, spam_flags, read_at, ...data } = record
    return {
        ...data,
        id: response_id,
        spam_flags: spam_flags ? (JSON.parse(spam_flags) as string[]) : [],
        read: read_at !== null
    }
}

/** The fields the submit endpoint supplies for a brand-new response; read/id/dates are assigned here. */
export interface NewContactResponse {
    subject: string | null
    name: string
    email: string | null
    phone: string | null
    body: string
    source_path: string | null
    spam_score: number
    spam_flags: string[]
}

/** Thrown when the database queue-limit trigger refuses to evict an unread response. */
export class ContactQueueFullError extends Error {}

/**
 * Inserts a new contact-form response. The database trigger checks and trims the capped queue in the same
 * transaction as this insert, so concurrent submissions cannot exceed the cap or evict the same row.
 *
 * @param input the validated and scored submission fields
 * @returns the id of the new row
 * @throws ContactQueueFullError if the queue is full and unevictable; Error if the insert itself fails
 */
export async function addContactResponse(input: NewContactResponse): Promise<number> {
    const now = Date.now()
    let result: D1Result
    try {
        result = await exec_string(
            "INSERT INTO contact_responses " +
                "(subject, name, email, phone, body, source_path, spam_score, spam_flags, entry_date, change_date) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);",
            [
                input.subject,
                input.name,
                input.email,
                input.phone,
                input.body,
                input.source_path,
                input.spam_score,
                JSON.stringify(input.spam_flags),
                now,
                now
            ]
        )
    } catch (error) {
        if (error instanceof Error && error.message.includes("contact_response_queue_full")) {
            throw new ContactQueueFullError("Contact response queue is full and every response is unread", {
                cause: error
            })
        }
        throw error
    }
    if (!result.success || result.meta.last_row_id === undefined) {
        throw new Error("Failed to insert contact_responses row")
    }
    return result.meta.last_row_id
}

/**
 * Fetches a single contact response by id
 */
export async function getContactResponse(id: number): Promise<ContactResponseRecord | null> {
    const result = await exec_string(
        `SELECT ${CONTACT_RESPONSE_COLUMNS} FROM contact_responses WHERE response_id = ?;`,
        [id]
    )
    if (!result.success || result.results.length === 0) {
        return null
    }
    return formatContactFromD1(result.results[0] as unknown as D1ContactResponse)
}

/**
 * Lists every contact response, newest first. The table is capped at MAX_CONTACT_RESPONSES rows, so this
 * is never paginated - the admin page filters (unread/spam) client-side over the full list.
 */
export async function listContactResponses(): Promise<ContactResponseRecord[]> {
    const result = await exec_string(
        `SELECT ${CONTACT_RESPONSE_COLUMNS} FROM contact_responses ORDER BY entry_date DESC;`
    )
    return result.success ? (result.results as unknown as D1ContactResponse[]).map(formatContactFromD1) : []
}

/**
 * Deletes a contact response by id
 *
 * @returns true if the statement executed successfully (true even if no row matched the id)
 */
export async function deleteContactResponse(id: number): Promise<boolean> {
    return deleteContactResponses([id])
}

/** Deletes the requested responses in one atomic statement. */
export async function deleteContactResponses(ids: number[]): Promise<boolean> {
    if (ids.length === 0) {
        throw new Error("At least one contact response id is required")
    }
    const placeholders = ids.map(() => "?").join(", ")
    const result = await exec_string(`DELETE FROM contact_responses WHERE response_id IN (${placeholders});`, ids)
    return result.success
}

/**
 * Marks a contact response read or unread
 *
 * @returns true if the statement executed successfully (true even if no row matched the id)
 */
export async function setContactResponseRead(id: number, read: boolean): Promise<boolean> {
    return setContactResponsesRead([id], read)
}

/** Marks the requested responses read or unread in one atomic statement. */
export async function setContactResponsesRead(ids: number[], read: boolean): Promise<boolean> {
    if (ids.length === 0) {
        throw new Error("At least one contact response id is required")
    }
    const now = Date.now()
    const placeholders = ids.map(() => "?").join(", ")
    const result = await exec_string(
        `UPDATE contact_responses SET read_at = ?, change_date = ? WHERE response_id IN (${placeholders});`,
        [read ? now : null, now, ...ids]
    )
    return result.success
}

/**
 * Counts unread responses, for the admin dashboard link's "(N)" badge
 */
export async function countUnreadContactResponses(): Promise<number> {
    const result = await exec_string("SELECT COUNT(*) AS count FROM contact_responses WHERE read_at IS NULL;")
    return result.success ? Number((result.results[0] as { count: number }).count) : 0
}
