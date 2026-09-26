/**
 * Copyright (C) 2026 Michael Wong.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { chromium, expect } from "@playwright/test"
import ts from "typescript"

// Run with: node --test tests/token-admin.browser.mjs
const root = new URL("../", import.meta.url)
const css = (
    await Promise.all(
        ["global", "admin-entities"].map((name) => readFile(new URL(`src/styles/${name}.css`, root), "utf8"))
    )
).join("\n")
const modules = new Map(
    await Promise.all(
        ["scripts/token_admin", "scripts/connector", "scripts/format", "consts"].map(async (name) => [
            `/${name}`,
            ts.transpileModule(await readFile(new URL(`src/${name}.ts`, root), "utf8"), {
                compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
            }).outputText
        ])
    )
)
let browser
before(async () => {
    browser = await chromium.launch()
})
after(async () => {
    await browser?.close()
})

async function openPage(build = false, incomplete = false) {
    const page = await browser.newPage()
    await page.route("**/*", async (route) => {
        const path = new URL(route.request().url()).pathname
        if (modules.has(path)) {
            await route.fulfill({ contentType: "text/javascript", body: modules.get(path) })
        } else if (path === "/") {
            await route.fulfill({
                contentType: "text/html",
                body: `<!doctype html>
                <style>${css}</style><main class="admin-main"><div id="token-manager" data-build="${build}" data-list-incomplete="${incomplete}">
                <form id="token-issue-form" class="generic-form admin-inline-form">
                    <label>Label<input id="token-label" required maxlength="100"></label>
                    <label>Expires in<select id="token-expiry"><option value="30">30 days</option>
                    ${build ? '<option value="never">Never</option>' : ""}</select></label>
                    <button type="submit">Issue token</button>
                </form>
                <p id="transaction-status" class="admin-status" role="status"></p>
                <div id="token-issued-panel" hidden><label for="token-issued-secret">Issued token</label>
                    <input id="token-issued-secret" readonly><button id="token-issued-copy">Copy</button></div>
                <p id="token-list-status" class="admin-status" role="status">No tokens issued.</p>
                <div id="token-list-results" class="admin-table-scroll" tabindex="0" hidden>
                    <table id="token-table" class="admin-table"><thead><tr>
                    ${["Label", "Prefix", "Issued", "Expires", "Status", "Actions"].map((h) => `<th scope="col">${h}</th>`).join("")}
                    </tr></thead><tbody></tbody></table>
                </div></div></main>`
            })
        } else {
            await route.abort()
        }
    })
    await page.goto("http://admin.test/")
    await page.evaluate(async () => (await import("/scripts/token_admin")).initTokenAdmin())
    return page
}

const issued = {
    id: 7,
    label: "Example",
    token_prefix: "test_prefix",
    secret: "synthetic-test-value",
    entry_date: 1789905600000,
    expires_date: 1792497600000
}

for (const build of [false, true]) {
    test(`${build ? "build" : "user"} tokens: pending, issue, copy failure, cancel, revoke failure and success`, async () => {
        const page = await openPage(build)
        try {
            const endpoint = `/api/v1/tokens${build ? "/build" : ""}`
            let release
            let requests = 0
            await page.route(`**${endpoint}`, async (route) => {
                requests++
                assert.equal(route.request().method(), "POST")
                const payload = route.request().postDataJSON()[0]
                assert.equal(payload.label, "Example")
                assert.equal(payload.expiry_days, build ? "never" : 30)
                await new Promise((resolve) => {
                    release = resolve
                })
                await route.fulfill({
                    status: 201,
                    json: {
                        success: true,
                        payload: {
                            ...issued,
                            expires_date: build ? null : issued.expires_date
                        }
                    }
                })
            })
            await page.getByLabel("Label", { exact: true }).fill("Example")
            if (build) await page.getByLabel("Expires in").selectOption("never")
            await page.getByRole("button", { name: "Issue token", exact: true }).click()
            await expect(page.locator("#token-issue-form")).toHaveAttribute("aria-busy", "true")
            await expect(page.locator("#token-label")).toBeDisabled()
            await expect(page.locator("#transaction-status")).toHaveText("Issuing token…")
            await page.locator("#token-issue-form").dispatchEvent("submit")
            await expect.poll(() => requests).toBe(1)
            release()
            await expect(page.locator("#token-table tbody tr")).toHaveCount(1)
            await expect(page.locator("#token-list-results")).toBeVisible()
            await expect(page.locator("#token-issued-secret")).toHaveValue(issued.secret)
            await expect(page.locator("#token-table")).not.toContainText(issued.secret)
            await expect(page.locator("#token-table tbody tr")).toContainText("UTC")
            if (build) await expect(page.locator("#token-table tbody tr")).toContainText("Never")
            await expect(page.locator("#token-label")).toBeEnabled()
            await page.getByRole("button", { name: "Copy", exact: true }).click()
            await expect(page.locator("#transaction-status")).toContainText("copy it manually")
            await expect(page.locator("#token-issued-secret")).toBeFocused()

            let deletes = 0
            let fail = true
            await page.route(`**${endpoint}/7`, async (route) => {
                deletes++
                assert.equal(route.request().method(), "DELETE")
                await route.fulfill(
                    fail ? { status: 500, json: { success: false, comment: "Try again" } } : { status: 204 }
                )
            })
            page.once("dialog", (dialog) => dialog.dismiss())
            await page.getByRole("button", { name: "Revoke token Example" }).click()
            assert.equal(deletes, 0)
            page.once("dialog", (dialog) => dialog.accept())
            await page.getByRole("button", { name: "Revoke token Example" }).click()
            await expect(page.locator("#token-list-status")).toHaveAttribute("data-state", "error")
            await expect(page.getByRole("button", { name: "Revoke token Example" })).toBeEnabled()
            await expect(page.locator("[data-token-status]")).toHaveText("Active")
            fail = false
            page.once("dialog", (dialog) => dialog.accept())
            await page.getByRole("button", { name: "Revoke token Example" }).click()
            await expect(page.locator("[data-token-status]")).toHaveText("Revoked")
            await expect(page.locator("#token-table tbody tr")).toHaveCount(1)
            await expect(page.locator(".token-revoke-btn")).toHaveCount(0)
        } finally {
            await page.close()
        }
    })
}

test("issuance errors preserve input and allow retry", async () => {
    const page = await openPage()
    try {
        await page.route("**/api/v1/tokens", (route) =>
            route.fulfill({
                status: 500,
                json: { success: false, comment: "Unavailable" }
            })
        )
        await page.getByLabel("Label", { exact: true }).fill("Retry me")
        await page.getByRole("button", { name: "Issue token" }).click()
        await expect(page.locator("#transaction-status")).toHaveAttribute("data-state", "error")
        await expect(page.locator("#token-label")).toHaveValue("Retry me")
        await expect(page.getByRole("button", { name: "Issue token" })).toBeEnabled()
        await expect(page.locator("#token-issued-panel")).toBeHidden()
        await expect(page.locator("#token-table tbody tr")).toHaveCount(0)
    } finally {
        await page.close()
    }
})

test("issuing after a list failure identifies partial results and supports copying", async () => {
    const page = await openPage(false, true)
    try {
        await page.evaluate(() => {
            Object.defineProperty(navigator, "clipboard", {
                value: {
                    writeText: async (value) => {
                        window.copiedToken = value
                    }
                }
            })
        })
        await page.route("**/api/v1/tokens", (route) =>
            route.fulfill({
                status: 201,
                json: { success: true, payload: issued }
            })
        )
        await page.getByLabel("Label", { exact: true }).fill("Example")
        await page.getByRole("button", { name: "Issue token" }).click()
        await expect(page.locator("#token-list-status")).toContainText("issued on this page")
        await page.getByRole("button", { name: "Copy", exact: true }).click()
        await expect(page.locator("#transaction-status")).toHaveText("Token copied to clipboard.")
        assert.equal(await page.evaluate(() => window.copiedToken), issued.secret)
    } finally {
        await page.close()
    }
})

test("shared tables scroll inside narrow pages in both color schemes", async () => {
    const page = await openPage()
    try {
        await page.evaluate(() => {
            document.querySelector("#token-list-results").hidden = false
            document.querySelector("tbody").insertRow().insertCell().textContent = "a".repeat(100)
        })
        for (const colorScheme of ["light", "dark"]) {
            await page.emulateMedia({ colorScheme })
            for (const width of [375, 1280]) {
                await page.setViewportSize({ width, height: 900 })
                const sizes = await page.evaluate(() => {
                    const wrapper = document.querySelector(".admin-table-scroll")
                    const header = getComputedStyle(document.querySelector("th"))
                    return {
                        page: document.documentElement.scrollWidth,
                        viewport: innerWidth,
                        wrapper: wrapper.clientWidth,
                        content: wrapper.scrollWidth,
                        padding: header.padding,
                        align: header.textAlign,
                        background: header.backgroundColor
                    }
                })
                assert.equal(sizes.page, sizes.viewport)
                if (width === 375) assert.ok(sizes.content > sizes.wrapper)
                assert.equal(sizes.padding, "8px 12px")
                assert.equal(sizes.align, "left")
                assert.equal(sizes.background, colorScheme === "light" ? "rgb(244, 244, 244)" : "rgb(38, 38, 38)")
            }
        }
    } finally {
        await page.close()
    }
})
