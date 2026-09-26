/**
 * Copyright (C) 2026 Michael Wong.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { issueToken, issueBuildToken, revokeToken, revokeBuildToken, type BuildTokenSummary } from "./connector"
import { formatTimestamp } from "./format"

/** Wires issuance, copying, and revocation for either token-management page. */
export function initTokenAdmin(): void {
    const root = document.getElementById("token-manager")
    if (!root) return
    const build = root.dataset.build === "true"
    const listIncomplete = root.dataset.listIncomplete === "true"
    const form = root.querySelector<HTMLFormElement>("#token-issue-form")!
    const labelInput = root.querySelector<HTMLInputElement>("#token-label")!
    const expiryInput = root.querySelector("#token-expiry")
    if (!(expiryInput instanceof HTMLSelectElement)) throw new Error("The token expiry control is missing")
    const issueButton = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
    const status = root.querySelector<HTMLElement>("#transaction-status")!
    const panel = root.querySelector<HTMLElement>("#token-issued-panel")!
    const secretInput = root.querySelector<HTMLInputElement>("#token-issued-secret")!
    const copyButton = root.querySelector<HTMLButtonElement>("#token-issued-copy")!
    const list = root.querySelector<HTMLElement>("#token-list-results")!
    const listStatus = root.querySelector<HTMLElement>("#token-list-status")!
    const body = root.querySelector<HTMLTableSectionElement>("#token-table tbody")!

    function showStatus(target: HTMLElement, message: string, state: "pending" | "success" | "error"): void {
        target.dataset.state = state
        target.textContent = message
    }

    function showError(target: HTMLElement, error: unknown): void {
        showStatus(target, `Error: ${error instanceof Error ? error.message : String(error)}`, "error")
    }

    function appendToken(token: BuildTokenSummary): void {
        const row = body.insertRow(0)
        row.dataset.tokenId = String(token.id)
        row.insertCell().textContent = token.label
        const prefix = document.createElement("code")
        prefix.textContent = `${token.token_prefix}…`
        row.insertCell().appendChild(prefix)
        row.insertCell().textContent = formatTimestamp(token.entry_date, "UTC")
        row.insertCell().textContent =
            token.expires_date === null ? "Never" : formatTimestamp(token.expires_date, "UTC")
        const state = row.insertCell()
        state.dataset.tokenStatus = ""
        state.textContent = "Active"
        const revoke = document.createElement("button")
        revoke.type = "button"
        revoke.className = "token-revoke-btn"
        revoke.dataset.tokenId = String(token.id)
        revoke.setAttribute("aria-label", `Revoke token ${token.label}`)
        revoke.textContent = "Revoke"
        row.insertCell().appendChild(revoke)
        list.hidden = false
        const count = listIncomplete
            ? `${body.rows.length} token(s) issued on this page. Reload to load existing tokens.`
            : `${body.rows.length} token(s) listed.`
        showStatus(listStatus, count, "success")
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault()
        if (issueButton.disabled) return
        const label = labelInput.value.trim()
        const expiry = expiryInput.value === "never" ? "never" : Number(expiryInput.value)
        if (!label || !([7, 30, 180, 365].includes(Number(expiry)) || (build && expiry === "never"))) {
            showStatus(status, "Enter a label and select a valid expiry.", "error")
            return
        }
        issueButton.disabled = true
        labelInput.disabled = true
        expiryInput.disabled = true
        form.setAttribute("aria-busy", "true")
        showStatus(status, "Issuing token…", "pending")
        try {
            const days = expiry as 7 | 30 | 180 | 365 | "never"
            const issued = build
                ? await issueBuildToken(label, days)
                : await issueToken(label, days as 7 | 30 | 180 | 365)
            secretInput.value = issued.secret
            panel.hidden = false
            appendToken(issued)
            form.reset()
            showStatus(status, `Token "${label}" issued. Copy it below now.`, "success")
        } catch (error) {
            showError(status, error)
        } finally {
            issueButton.disabled = false
            labelInput.disabled = false
            expiryInput.disabled = false
            form.removeAttribute("aria-busy")
        }
    })

    copyButton.addEventListener("click", async () => {
        copyButton.disabled = true
        try {
            await navigator.clipboard.writeText(secretInput.value)
            showStatus(status, "Token copied to clipboard.", "success")
        } catch {
            secretInput.focus()
            secretInput.select()
            showStatus(status, "Could not copy the token. Select and copy it manually.", "error")
        } finally {
            copyButton.disabled = false
        }
    })

    list.addEventListener("click", async (event) => {
        const button =
            event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".token-revoke-btn") : null
        if (!button || button.disabled) return
        const id = Number(button.dataset.tokenId)
        if (!Number.isSafeInteger(id) || id <= 0) {
            showStatus(listStatus, "Could not identify the token to revoke. Reload the page and try again.", "error")
            return
        }
        if (
            !confirm(
                build
                    ? "Revoke this token? The build will lose access immediately."
                    : "Revoke this token? Any script using it will lose access immediately."
            )
        )
            return
        button.disabled = true
        showStatus(listStatus, "Revoking token…", "pending")
        try {
            await (build ? revokeBuildToken(id) : revokeToken(id))
            const row = button.closest("tr")!
            row.querySelector<HTMLElement>("[data-token-status]")!.textContent = "Revoked"
            button.remove()
            showStatus(listStatus, "Token revoked.", "success")
        } catch (error) {
            showError(listStatus, error)
            button.disabled = false
        }
    })
}
