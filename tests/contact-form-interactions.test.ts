/**
 * @vitest-environment happy-dom
 * Copyright (C) 2026 Michael Wong.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

interface WidgetOptions {
    callback: (token: string) => void
    "error-callback": () => void
    "expired-callback": () => void
    "timeout-callback": () => void
    "unsupported-callback": () => void
}

let widgetOptions: WidgetOptions
let resetWidget = vi.fn<(widgetId?: string) => void>()

function renderForm(): HTMLFormElement {
    document.body.innerHTML = `
        <div class="cmp-contact-form">
            <form class="cmp-contact-form__form" action="/submit/contact" method="post" data-success-message="Sent">
                <input name="name" required value="Ada">
                <input name="subject" value="Question">
                <div class="cmp-contact-form__reply-group">
                    <input name="email" type="email" value="ada@example.test">
                    <input name="phone" type="tel">
                    <p class="cmp-contact-form__hint">Provide an email or phone number.</p>
                </div>
                <textarea name="body" required>A message</textarea>
                <input name="hp_website">
                <input name="source_path" value="/contact">
                <div class="cmp-contact-form__turnstile" data-turnstile-sitekey="site-key"></div>
                <button type="submit">Send</button>
                <p class="cmp-contact-form__status"></p>
            </form>
        </div>
    `
    return document.querySelector("form")!
}

beforeEach(async () => {
    vi.resetModules()
    renderForm()
    resetWidget = vi.fn<(widgetId?: string) => void>()
    window.turnstile = {
        render: vi.fn((_mount, options) => {
            widgetOptions = options as WidgetOptions
            return "widget-1"
        }),
        reset: resetWidget
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ success: true })))
    await import("../src/scripts/contact_form")
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete window.turnstile
    delete window.onloadTurnstileCallback
})

describe("contact form interactions", () => {
    it("submits successfully on the first completed Turnstile token", async () => {
        const form = document.querySelector<HTMLFormElement>("form")!
        const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
        expect(submit.disabled).toBe(true)

        window.onloadTurnstileCallback?.()
        widgetOptions.callback("first-token")
        expect(submit.disabled).toBe(false)
        form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))

        await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
        const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit
        expect(init.method).toBe("POST")
        expect(JSON.parse(String(init.body))).toMatchObject({
            name: "Ada",
            email: "ada@example.test",
            body: "A message",
            source_path: "/contact",
            turnstileToken: "first-token"
        })
        await vi.waitFor(() => expect(resetWidget).toHaveBeenCalledWith("widget-1"))
        expect(submit.disabled).toBe(true)
        expect(document.querySelector(".cmp-contact-form__status")?.textContent).toBe("Sent")
    })

    it("keeps submission unavailable when the Turnstile loader is blocked", () => {
        const form = document.querySelector<HTMLFormElement>("form")!
        const event = new SubmitEvent("submit", { bubbles: true, cancelable: true })
        form.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        expect(fetch).not.toHaveBeenCalled()
        expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
    })

    it("uses native required validation and focuses the first invalid control", () => {
        window.onloadTurnstileCallback?.()
        widgetOptions.callback("token")
        const form = document.querySelector<HTMLFormElement>("form")!
        const name = form.elements.namedItem("name") as HTMLInputElement
        name.value = ""
        form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
        expect(fetch).not.toHaveBeenCalled()
        expect(document.activeElement).toBe(name)
    })

    it("associates and focuses the email-or-phone error", () => {
        window.onloadTurnstileCallback?.()
        widgetOptions.callback("token")
        const form = document.querySelector<HTMLFormElement>("form")!
        const email = form.elements.namedItem("email") as HTMLInputElement
        const phone = form.elements.namedItem("phone") as HTMLInputElement
        email.value = ""
        phone.value = ""
        form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))
        expect(fetch).not.toHaveBeenCalled()
        expect(email.getAttribute("aria-invalid")).toBe("true")
        expect(email.getAttribute("aria-describedby")).toMatch(/contact-reply-hint-1 field-error-/)
        expect(document.activeElement).toBe(email)
    })

    it.each([
        ["expired-callback", "expired"],
        ["error-callback", "failed"],
        ["timeout-callback", "timed out"],
        ["unsupported-callback", "cannot run"]
    ] as const)("disables submission on %s", (callback, message) => {
        window.onloadTurnstileCallback?.()
        widgetOptions.callback("token")
        widgetOptions[callback]()
        expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
        expect(document.querySelector(".cmp-contact-form__status")?.textContent).toContain(message)
    })
})
