/**
 * Client behavior for the compositor ContactForm
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
 */

import { attachFormValidation, clearFieldError, showFieldError, validateFormFields } from "./form_validate"
import { disableInput, enableInput } from "./interface"
import { errorMessage } from "./common"

interface TurnstileRenderOptions {
    sitekey: string
    callback: (token: string) => void
    "error-callback": () => void
    "expired-callback": () => void
    "timeout-callback": () => void
    "unsupported-callback": () => void
}

interface TurnstileApi {
    render(container: HTMLElement, options: TurnstileRenderOptions): string
    reset(widgetId?: string): void
}

declare global {
    interface Window {
        turnstile?: TurnstileApi
        onloadTurnstileCallback?: () => void
    }
}

interface ContactFormController {
    form: HTMLFormElement
    mount: HTMLElement
    status: HTMLElement
    submit: HTMLButtonElement
    token: string
    widgetId?: string
}

const PREFILLABLE_FIELDS = ["name", "subject", "email", "phone", "body"]
const controllers: ContactFormController[] = []

function prefillFromQuery(form: HTMLFormElement): void {
    const params = new URLSearchParams(location.search)
    for (const name of PREFILLABLE_FIELDS) {
        const value = params.get(name)
        const control = form.elements.namedItem(name)
        if (
            value !== null &&
            (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) &&
            control.value === ""
        ) {
            control.value = value
        }
    }
}

function sourcePath(form: HTMLFormElement): string {
    const fromQuery = new URLSearchParams(location.search).get("source")
    if (fromQuery !== null) return fromQuery
    const control = form.elements.namedItem("source_path")
    return control instanceof HTMLInputElement ? control.value : ""
}

function setStatus(status: HTMLElement, message: string, state: "idle" | "error" | "success"): void {
    status.textContent = message
    if (state === "idle") status.removeAttribute("data-state")
    else status.setAttribute("data-state", state)
}

async function responseErrorMessage(response: Response): Promise<string> {
    try {
        const data = (await response.json()) as Record<string, unknown>
        if (typeof data.comment === "string" && data.comment !== "") return data.comment
    } catch {
        // Use the default error message
    }
    return "The message could not be sent. Please try again later."
}

function firstInvalidControl(form: HTMLFormElement): HTMLElement | null {
    for (const control of form.elements) {
        if (!(control instanceof HTMLElement)) continue
        const validity = (control as HTMLElement & { validity?: ValidityState }).validity
        if (validity && !validity.valid) return control
    }
    return null
}

function validateReplyMethod(form: HTMLFormElement): boolean {
    const email = form.elements.namedItem("email")
    const phone = form.elements.namedItem("phone")
    if (!(email instanceof HTMLInputElement)) return false

    email.setCustomValidity("")
    if (email.dataset.replyError === "true") {
        delete email.dataset.replyError
        clearFieldError(email)
    }
    const emailValue = email.value.trim()
    const phoneValue = phone instanceof HTMLInputElement ? phone.value.trim() : ""
    if (emailValue !== "" || phoneValue !== "") return true

    const message = "Enter an email address or phone number so we can respond."
    email.setCustomValidity(message)
    email.dataset.replyError = "true"
    showFieldError(email, message)
    email.reportValidity()
    email.focus()
    return false
}

function clearReplyError(form: HTMLFormElement): void {
    const email = form.elements.namedItem("email")
    if (!(email instanceof HTMLInputElement) || email.dataset.replyError !== "true") return
    email.setCustomValidity("")
    delete email.dataset.replyError
    clearFieldError(email)
}

async function submitContactForm(controller: ContactFormController): Promise<void> {
    const { form, status, submit } = controller
    setStatus(status, "", "idle")

    if (!form.checkValidity()) {
        form.reportValidity()
        firstInvalidControl(form)?.focus()
        setStatus(status, "Please correct the highlighted fields and try again.", "error")
        return
    }
    if (!validateFormFields(form) || !validateReplyMethod(form)) {
        firstInvalidControl(form)?.focus()
        setStatus(status, "Please correct the highlighted fields and try again.", "error")
        return
    }
    if (controller.token === "") {
        setStatus(status, "Please wait for verification to finish, then try again.", "error")
        submit.disabled = true
        return
    }

    const data = new FormData(form)
    setStatus(status, "Sending…", "idle")
    disableInput(form)
    try {
        const response = await fetch("/submit/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: String(data.get("name") ?? ""),
                subject: String(data.get("subject") ?? ""),
                email: String(data.get("email") ?? "").trim(),
                phone: String(data.get("phone") ?? "").trim(),
                body: String(data.get("body") ?? ""),
                source_path: sourcePath(form),
                hp_website: String(data.get("hp_website") ?? ""),
                turnstileToken: controller.token
            })
        })
        if (!response.ok) throw new Error(await responseErrorMessage(response))

        setStatus(status, form.dataset.successMessage ?? "Thank you - your message has been sent.", "success")
        form.reset()
    } catch (error) {
        setStatus(status, errorMessage(error), "error")
    } finally {
        controller.token = ""
        enableInput(form)
        submit.disabled = true
        window.turnstile?.reset(controller.widgetId)
    }
}

function attachReplyHelp(form: HTMLFormElement, sequence: number): void {
    const hint = form.querySelector(".cmp-contact-form__hint")
    if (!(hint instanceof HTMLElement)) return
    hint.id = `contact-reply-hint-${sequence}`
    for (const name of ["email", "phone"]) {
        const control = form.elements.namedItem(name)
        if (control instanceof HTMLInputElement) control.setAttribute("aria-describedby", hint.id)
    }
}

function initLocalForm(container: HTMLElement, sequence: number): void {
    const form = container.querySelector(".cmp-contact-form__form")
    const mount = container.querySelector(".cmp-contact-form__turnstile")
    const status = container.querySelector(".cmp-contact-form__status")
    const submit = form?.querySelector('button[type="submit"]')
    if (
        !(form instanceof HTMLFormElement) ||
        !(mount instanceof HTMLElement) ||
        !(status instanceof HTMLElement) ||
        !(submit instanceof HTMLButtonElement)
    ) {
        return
    }

    prefillFromQuery(form)
    attachReplyHelp(form, sequence)
    attachFormValidation(form)
    form.querySelectorAll<HTMLInputElement>('[name="email"], [name="phone"]').forEach((control) => {
        control.addEventListener("input", () => clearReplyError(form))
    })

    const controller: ContactFormController = { form, mount, status, submit, token: "" }
    controllers.push(controller)
    submit.disabled = true
    setStatus(status, "Loading human verification…", "idle")
    form.addEventListener("submit", (event) => {
        event.preventDefault()
        void submitContactForm(controller)
    })
}

function renderTurnstile(controller: ContactFormController): void {
    const sitekey = controller.mount.dataset.turnstileSitekey ?? ""
    if (!window.turnstile || sitekey === "") {
        setStatus(controller.status, "The contact form is not available right now. Please try again later.", "error")
        return
    }

    const unavailable = (message: string) => {
        controller.token = ""
        controller.submit.disabled = true
        setStatus(controller.status, message, "error")
    }
    try {
        controller.widgetId = window.turnstile.render(controller.mount, {
            sitekey,
            callback: (token) => {
                controller.token = token
                controller.submit.disabled = false
                setStatus(controller.status, "", "idle")
            },
            "error-callback": () => unavailable("Human verification failed to load. Please try again."),
            "expired-callback": () => unavailable("Human verification expired. Please verify again."),
            "timeout-callback": () => unavailable("Human verification timed out. Please verify again."),
            "unsupported-callback": () =>
                unavailable("This browser cannot run human verification. Please use a supported browser.")
        })
    } catch {
        unavailable("Human verification failed to load. Please try again.")
    }
}

function initContactForms(): void {
    if (controllers.length !== 0) return
    document.querySelectorAll<HTMLElement>(".cmp-contact-form").forEach((container, index) => {
        initLocalForm(container, index + 1)
    })
}

window.onloadTurnstileCallback = () => {
    initContactForms()
    controllers.forEach((controller) => {
        if (controller.widgetId === undefined) renderTurnstile(controller)
    })
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initContactForms, { once: true })
else initContactForms()
