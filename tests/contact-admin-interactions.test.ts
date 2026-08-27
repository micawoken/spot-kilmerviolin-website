/**
 * @vitest-environment happy-dom
 * Copyright (C) 2026 Michael Wong.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { initContactAdmin } from "../src/scripts/contact_admin"

function renderAdminRows(): void {
    document.body.innerHTML = `
        <button id="contact-bulk-read"></button>
        <button id="contact-bulk-unread"></button>
        <button id="contact-bulk-delete"></button>
        <input id="contact-select-all" type="checkbox">
        <input id="contact-spam-filter" type="checkbox">
        <ul class="contact-response-list">
            <li class="contact-response" data-spam-score="0">
                <input class="row-select" type="checkbox" value="1">
                <button class="contact-mark-read" data-id="1" data-read="false"></button>
                <button class="contact-delete" data-id="1"></button>
            </li>
            <li class="contact-response" data-spam-score="40">
                <input class="row-select" type="checkbox" value="2">
                <button class="contact-mark-read" data-id="2" data-read="true"></button>
                <button class="contact-delete" data-id="2"></button>
            </li>
        </ul>
        <p id="transaction-status"></p>
    `
}

function failedResponse(): Response {
    return Response.json({ comment: "expected test failure" }, { status: 500 })
}

beforeEach(() => {
    renderAdminRows()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failedResponse()))
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true))
    initContactAdmin()
})

afterEach(() => vi.unstubAllGlobals())

describe("contact admin interactions", () => {
    it("runs individual read, unread, and delete actions without any selected checkbox", async () => {
        document.querySelector<HTMLButtonElement>('.contact-mark-read[data-id="1"]')?.click()
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
        let init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
        expect([init.method, JSON.parse(String(init.body))]).toEqual(["PATCH", { ids: [1], read: true }])

        document.querySelector<HTMLButtonElement>('.contact-mark-read[data-id="2"]')?.click()
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
        init = vi.mocked(fetch).mock.calls[1][1] as RequestInit
        expect([init.method, JSON.parse(String(init.body))]).toEqual(["PATCH", { ids: [2], read: false }])

        document.querySelector<HTMLButtonElement>('.contact-delete[data-id="1"]')?.click()
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
        init = vi.mocked(fetch).mock.calls[2][1] as RequestInit
        expect([init.method, JSON.parse(String(init.body))]).toEqual(["DELETE", { ids: [1] }])
    })

    it.each(["contact-bulk-read", "contact-bulk-unread", "contact-bulk-delete"])(
        "rejects %s with zero selected rows",
        (id) => {
            document.querySelector<HTMLButtonElement>(`#${id}`)?.click()
            expect(fetch).not.toHaveBeenCalled()
            expect(document.querySelector("#transaction-status")?.textContent).toContain("Select at least one")
        }
    )

    it("handles one and multiple selected rows", async () => {
        expect(fetch).not.toHaveBeenCalled()

        const boxes = [...document.querySelectorAll<HTMLInputElement>(".row-select")]
        boxes[0].checked = true
        document.querySelector<HTMLButtonElement>("#contact-bulk-read")?.click()
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
        expect(JSON.parse(String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body))).toEqual({
            ids: [1],
            read: true
        })

        boxes[1].checked = true
        document.querySelector<HTMLButtonElement>("#contact-bulk-unread")?.click()
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
        expect(JSON.parse(String((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body))).toEqual({
            ids: [1, 2],
            read: false
        })

        document.querySelector<HTMLButtonElement>("#contact-bulk-delete")?.click()
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
        const deleteInit = vi.mocked(fetch).mock.calls[2][1] as RequestInit
        expect([deleteInit.method, JSON.parse(String(deleteInit.body))]).toEqual(["DELETE", { ids: [1, 2] }])
    })

    it("does not delete when confirmation is cancelled", () => {
        vi.mocked(confirm).mockReturnValue(false)
        document.querySelector<HTMLInputElement>(".row-select")!.checked = true
        document.querySelector<HTMLButtonElement>("#contact-bulk-delete")?.click()
        document.querySelector<HTMLButtonElement>('.contact-delete[data-id="1"]')?.click()
        expect(fetch).not.toHaveBeenCalled()
    })

    it("selects all rows and filters likely spam", () => {
        const selectAll = document.querySelector<HTMLInputElement>("#contact-select-all")!
        selectAll.checked = true
        selectAll.dispatchEvent(new Event("change"))
        expect([...document.querySelectorAll<HTMLInputElement>(".row-select")].every((box) => box.checked)).toBe(true)

        const filter = document.querySelector<HTMLInputElement>("#contact-spam-filter")!
        filter.checked = true
        filter.dispatchEvent(new Event("change"))
        const rows = [...document.querySelectorAll<HTMLElement>(".contact-response")]
        expect(rows[0].hidden).toBe(false)
        expect(rows[1].hidden).toBe(true)
    })

    it("shows a failed mutation without reloading", async () => {
        document.querySelector<HTMLButtonElement>('.contact-mark-read[data-id="1"]')?.click()
        await vi.waitFor(() =>
            expect(document.querySelector("#transaction-status")?.textContent).toContain("expected test failure")
        )
    })
})
