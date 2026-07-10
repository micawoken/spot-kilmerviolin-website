/**
 * tools/spike/spike-editor-browser-test.mjs — THROWAWAY (Phase 0 spike (b)+(c); deleted before Phase 1).
 *
 * Drives the spike Puck editor island in a real browser against the local dev server:
 *   1. dev-bypass sign-in → /admin/designs/spike
 *   2. Puck editor mounts; canvas iframe (#preview-frame) renders the document
 *   3. spike (c): token CSS applies INSIDE the iframe (computed section background = #f3ede2)
 *      and no host styles were mirrored in (syncHostStyles: false → no [data-puck-style-mirror])
 *   4. edit the Heading text via the fields panel → autosave fires (~2s) → indicator "saved"
 *   5. the draft change is visible over the API (draft-overlaid single GET)
 *
 *   node tools/spike/spike-editor-browser-test.mjs [base-url]
 */

import { chromium } from "@playwright/test"

const base = process.argv[2] ?? "http://localhost:4321"
const fail = (msg) => {
    console.error(`FAIL ${msg}`)
    process.exit(1)
}
const step = (msg) => console.log(`✔ ${msg}`)

const browser = await chromium.launch()
const page = await browser.newPage()
page.on("pageerror", (error) => console.error("pageerror:", error.message))

// 1. session + editor page
await page.goto(`${base}/_emdash/api/setup/dev-bypass?redirect=/admin/designs/spike`)
await page.waitForURL("**/admin/designs/spike")
step("dev-bypass session established, editor page loaded")

// 2. editor mounts with canvas iframe
const frameElement = await page.waitForSelector("#preview-frame", { timeout: 30000 })
const frame = await frameElement.contentFrame()
if (!frame) fail("canvas iframe has no content frame")
await frame.waitForSelector("section", { timeout: 30000 })
step("Puck mounted; spike document rendered in canvas iframe")

// 3. token CSS inside the iframe, no host style mirroring
const background = await frame.$eval("section", (el) => getComputedStyle(el).backgroundColor)
if (background !== "rgb(243, 237, 226)") fail(`section background is ${background}, expected rgb(243, 237, 226) (#f3ede2)`)
const mirrored = await frame.$$eval("[data-puck-style-mirror]", (els) => els.length)
if (mirrored !== 0) fail(`${mirrored} host style(s) mirrored into the canvas despite syncHostStyles: false`)
step("token CSS var applied inside canvas iframe; no host styles mirrored")

// 4. edit heading text via the fields panel and wait for autosave
await frame.click("h1")
// Puck renders the fields panel twice (mobile + desktop) with duplicate ids; take the visible one
const textInput = page.locator("#heading-1_text_text").locator("visible=true").first()
await textInput.waitFor({ state: "visible", timeout: 15000 })
const newText = `Edited ${Date.now()}`
await textInput.fill(newText)
try {
    await page.waitForFunction(
        () => document.querySelector("[data-spike-save-state]")?.getAttribute("data-spike-save-state") === "saved",
        undefined,
        { timeout: 15000 }
    )
} catch {
    const state = await page.getAttribute("[data-spike-save-state]", "data-spike-save-state")
    fail(`autosave did not reach "saved" (indicator: ${state})`)
}
step("field edit autosaved (indicator: saved)")

// 5. draft change visible over the API
const apiCheck = await page.evaluate(async () => {
    const list = await (
        await fetch("/_emdash/api/content/design_spike?limit=10", { credentials: "same-origin" })
    ).json()
    const id = list.data.items.find((item) => item.slug === "spike-editor-doc")?.id
    const single = await (await fetch(`/_emdash/api/content/design_spike/${id}`, { credentials: "same-origin" })).json()
    return JSON.stringify(single.data.item.data.design.puck)
})
if (!apiCheck.includes(newText)) fail("edited heading text not found in draft-overlaid API data")
step("draft edit confirmed over the API")

await browser.close()
console.log(`\nAll editor browser checks passed against ${base}`)
