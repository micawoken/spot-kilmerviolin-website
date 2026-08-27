/**
 * scripts/contact_admin.ts
 *
 * Client-side wiring for the /admin/site/contact response list: bulk mark-read/unread, bulk delete, and
 * the spam-score filter. The response list is server-rendered (pages/admin/site/contact.astro reads
 * db_contact.ts directly, mirroring the composers/list.astro pattern); this module only drives mutations,
 * which go through /api/v1/contact - see that endpoint's header for why it isn't the entity {payload,
 * meta} envelope scripts/connector.ts's helpers assume.
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

import { getTransactionElem } from "./interface"
import { errorMessage } from "./common"

/** A submission is flagged likely-spam in the filter above this score (spam.ts's scoring scale). */
const SPAM_FILTER_THRESHOLD = 30

async function extractErrorComment(response: Response): Promise<string> {
    try {
        const data = (await response.json()) as Record<string, unknown>
        if (data && typeof data === "object" && typeof data.comment === "string" && data.comment !== "") {
            return data.comment
        }
    } catch {
        // response body wasn't JSON (or was empty); fall through to the generic message
    }
    return `Request failed with status ${response.status}`
}

async function patchRead(ids: number[], read: boolean): Promise<void> {
    const response = await fetch("/api/v1/contact", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, read })
    })
    if (!response.ok) {
        throw new Error(await extractErrorComment(response))
    }
}

async function deleteResponses(ids: number[]): Promise<void> {
    const response = await fetch("/api/v1/contact", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids })
    })
    if (!response.ok) {
        throw new Error(await extractErrorComment(response))
    }
}

function selectedIds(list: HTMLElement): number[] {
    return Array.from(list.querySelectorAll<HTMLInputElement>(".row-select:checked")).map((box) => Number(box.value))
}

/**
 * Wires the contact response list: the select-all checkbox, per-row and bulk mark-read/unread/delete, and
 * the spam-score filter toggle
 */
export function initContactAdmin(): void {
    const list = document.querySelector<HTMLElement>(".contact-response-list")
    const status = getTransactionElem()
    if (!list) {
        return
    }

    const selectAll = document.getElementById("contact-select-all")
    if (selectAll instanceof HTMLInputElement) {
        selectAll.addEventListener("change", () => {
            list.querySelectorAll<HTMLInputElement>(".row-select").forEach((box) => {
                box.checked = selectAll.checked
            })
        })
    }

    const runAction = async (ids: number[], action: (ids: number[]) => Promise<void>): Promise<void> => {
        status.textContent = "Processing..."
        try {
            await action(ids)
            location.reload()
        } catch (error) {
            status.textContent = `Error: ${errorMessage(error)}`
        }
    }

    const runBulkAction = (
        action: (ids: number[]) => Promise<void>,
        emptyMessage: string,
        confirmation?: string
    ): void => {
        const ids = selectedIds(list)
        if (ids.length === 0) {
            status.textContent = emptyMessage
            return
        }
        if (confirmation && !confirm(confirmation)) return
        void runAction(ids, action)
    }

    document.getElementById("contact-bulk-read")?.addEventListener("click", () => {
        runBulkAction((ids) => patchRead(ids, true), "Select at least one response to mark read.")
    })
    document.getElementById("contact-bulk-unread")?.addEventListener("click", () => {
        runBulkAction((ids) => patchRead(ids, false), "Select at least one response to mark unread.")
    })
    document.getElementById("contact-bulk-delete")?.addEventListener("click", () => {
        runBulkAction(
            deleteResponses,
            "Select at least one response to delete.",
            "Delete the selected responses? This cannot be undone."
        )
    })

    list.querySelectorAll<HTMLButtonElement>(".contact-mark-read").forEach((button) => {
        button.addEventListener("click", () => {
            const id = Number(button.dataset.id)
            const read = button.dataset.read === "true"
            if (Number.isInteger(id) && id > 0) void runAction([id], (ids) => patchRead(ids, !read))
        })
    })
    list.querySelectorAll<HTMLButtonElement>(".contact-delete").forEach((button) => {
        button.addEventListener("click", () => {
            if (!confirm("Delete this response? This cannot be undone.")) {
                return
            }
            const id = Number(button.dataset.id)
            if (Number.isInteger(id) && id > 0) void runAction([id], deleteResponses)
        })
    })

    const spamFilter = document.getElementById("contact-spam-filter")
    if (spamFilter instanceof HTMLInputElement) {
        spamFilter.addEventListener("change", () => {
            list.querySelectorAll<HTMLElement>(".contact-response").forEach((row) => {
                const score = Number(row.dataset.spamScore ?? "0")
                row.hidden = spamFilter.checked && score >= SPAM_FILTER_THRESHOLD
            })
        })
    }
}
