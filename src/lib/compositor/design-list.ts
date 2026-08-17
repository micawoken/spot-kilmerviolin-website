/**
 * lib/compositor/design-list.ts
 *
 * Shared client-side helpers for the two design-collection list pages
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

/** The subset of an EmDash content item these lists render (see emdash ContentItem). */
export interface DesignItem {
    id: string
    slug: string | null
    status: string
    data: Record<string, unknown> | null
    updatedAt: string
    liveRevisionId: string | null
    draftRevisionId: string | null
}

/** Extracts a human message from an EmDash `{ error: { message } }` body, falling back to the status line. */
export async function errorMessage(response: Response): Promise<string> {
    try {
        const body = (await response.json()) as { error?: { message?: string } }
        if (body.error?.message) return body.error.message
    } catch {
        // non-JSON error body; fall through to the status text
    }
    return `${response.status} ${response.statusText}`
}

/** Fetches every item of one design collection, following EmDash's cursor pagination. */
export async function fetchItems(endpoint: string): Promise<DesignItem[]> {
    const items: DesignItem[] = []
    let cursor: string | undefined
    do {
        const query = new URLSearchParams({ limit: "100" })
        if (cursor) query.set("cursor", cursor)
        const response = await fetch(`${endpoint}?${query.toString()}`, {
            headers: { Accept: "application/json" }
        })
        if (!response.ok) throw new Error(await errorMessage(response))
        const body = (await response.json()) as {
            data?: { items?: DesignItem[]; nextCursor?: string }
        }
        if (body.data?.items) items.push(...body.data.items)
        cursor = body.data?.nextCursor
    } while (cursor)
    return items
}

/** Publication state for the badge - list responses carry published-column data only, but draft !=
 *  live revision ids reveal an unpublished draft staged over a published page. */
export function statusLabel(item: DesignItem): string {
    const pendingDraft = Boolean(item.draftRevisionId) && item.draftRevisionId !== item.liveRevisionId
    if (item.status === "published") return pendingDraft ? "Published · pending draft" : "Published"
    return "Draft"
}

export function titleOf(item: DesignItem): string {
    const title = item.data?.title
    if (typeof title === "string" && title.trim() !== "") return title
    return item.slug ?? "(untitled)"
}
