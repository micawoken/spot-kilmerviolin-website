/**
 * tools/gate/run-routing-gate.mjs
 *
 * Builds the site multiple times to verify the template routing process works
 * 
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

import { spawn } from "node:child_process"
import { readdirSync, readFileSync, rmSync, existsSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { startFixtureServer } from "./serve-fixture.mjs"
import {
    FIXTURES,
    TEMPLATED_SLUG,
    TEMPLATE_SLUG,
    TEMPLATED_TITLE,
    TEMPLATED_BODY_TEXT,
    BOUND_RICHTEXT_FIELD,
    TEMPLATED_POST_SLUG,
    POST_TITLE,
    POST_BODY_TEXT,
    POST_IMAGE_ALT,
    MEDIA_BASE,
    MEDIA_STORAGE_KEY
} from "./fixtures.mjs"

/** EmDash's same-origin media proxy - Access-gated, so it must NEVER appear in a prerendered page. */
const INTERNAL_MEDIA_PREFIX = "/_emdash/api/media/file/"

const root = fileURLToPath(new URL("../..", import.meta.url))
const astroBin = join(root, "node_modules", "astro", "bin", "astro.mjs")
const distClient = join(root, "dist", "client")

const results = []
const record = (name, passed, detail = "") => results.push({ name, passed, detail })

/** The tail of a build's output. A failing assertion must show its evidence, not just its verdict */
const tail = (output, lines = 25) =>
    output
        .split("\n")
        .filter((line) => line.trim() !== "")
        .slice(-lines)
        .map((line) => `        │ ${line}`)
        .join("\n")

/** Runs `astro build` against a fixture CMS. Never throws on a failed build - the gate inspects it */
function build(base) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [astroBin, "build"], {
            cwd: root,
            // A shell CONTENT_API_BASE overrides .env, which is what isolates this from prod
            env: { ...process.env, CONTENT_API_BASE: base, EMDASH_MEDIA_PUBLIC_URL: MEDIA_BASE },
            stdio: ["ignore", "pipe", "pipe"]
        })
        let output = ""
        child.stdout.on("data", (chunk) => (output += chunk))
        child.stderr.on("data", (chunk) => (output += chunk))
        child.on("close", (code) => resolve({ code, output }))
    })
}

/** Every prerendered page in dist/client, as relative-path -> bytes. */
function snapshotHtml() {
    const files = new Map()
    if (!existsSync(distClient)) return files
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name)
            if (entry.isDirectory()) walk(full)
            else if (entry.name.endsWith(".html")) {
                files.set(relative(distClient, full).split(sep).join("/"), readFileSync(full))
            }
        }
    }
    walk(distClient)
    return files
}

/** One routed entry's page, however the configured build format spells it. */
function findPage(files, slug) {
    for (const path of files.keys()) {
        if (path === `${slug}/index.html` || path === `${slug}.html`) return path
    }
    return null
}

function runZeroJsCheck(htmlPath) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [join(root, "tools", "check-zero-js.mjs"), htmlPath], {
            cwd: root,
            stdio: ["ignore", "pipe", "pipe"]
        })
        let output = ""
        child.stdout.on("data", (chunk) => (output += chunk))
        child.stderr.on("data", (chunk) => (output += chunk))
        child.on("close", (code) => resolve({ code, output }))
    })
}

/** Builds one fixture and returns its dist HTML plus whatever the build asked for and did not get. */
async function buildAgainst(name) {
    const server = await startFixtureServer(FIXTURES[name])
    try {
        rmSync(join(root, "dist"), { recursive: true, force: true })
        console.log(`\n▸ building against the "${name}" fixture (${server.base}) …`)
        const result = await build(server.base)
        console.log(`  exit ${result.code}`)
        return { ...result, html: snapshotHtml(), unrecorded: [...server.unrecorded] }
    } finally {
        await server.close()
    }
}

const baseline = await buildAgainst("baseline")
const templated = await buildAgainst("templated")

// --- 1. the fixture answered everything both builds asked for -------------------------------------
const unrecorded = [...baseline.unrecorded, ...templated.unrecorded]
record(
    "1. no unrecorded CMS path",
    unrecorded.length === 0,
    unrecorded.length === 0 ? "" : `requested but not in the fixture: ${unrecorded.join(", ")}`
)

// Both content builds must have succeeded at all.
record(
    "   (both content builds exit 0)",
    baseline.code === 0 && templated.code === 0,
    `baseline exit ${baseline.code}, templated exit ${templated.code}`
)

// --- 2. not vacuous -------------------------------------------------------------------------------
const templatedPage = findPage(templated.html, TEMPLATED_SLUG)
const templatedPost = findPage(templated.html, TEMPLATED_POST_SLUG)
record(
    "2. templated build emitted pages",
    templated.html.size > 0 && templatedPage !== null && templatedPost !== null,
    `${templated.html.size} html file(s); "${TEMPLATED_SLUG}" page: ${templatedPage ?? "MISSING"}; ` +
        `"${TEMPLATED_POST_SLUG}" page: ${templatedPost ?? "MISSING"}`
)

// --- 3. the entry rendered through the template ----------------------------------------------------
if (templatedPage) {
    const html = templated.html.get(templatedPage).toString("utf8")
    const before = baseline.html.get(templatedPage)?.toString("utf8") ?? ""

    const titleInH1 = new RegExp(`<h1[^>]*>[\\s\\S]*?${TEMPLATED_TITLE}[\\s\\S]*?</h1>`, "i").test(html)
    const bodyPresent = html.includes(TEMPLATED_BODY_TEXT)
    // Only the design branch injects the theme's token custom properties into <head>.
    const tookDesignBranch = html.includes("--dtk-")
    const changed = html !== before

    record(
        "3. entry rendered through the template",
        titleInH1 && bodyPresent && tookDesignBranch && changed,
        `title in <h1>: ${titleInH1}; body text: ${bodyPresent}; --dtk-* tokens: ${tookDesignBranch}; ` +
            `differs from untemplated render: ${changed}`
    )
} else {
    record("3. entry rendered through the template", false, "no templated page to inspect")
}

// --- 4. zero JS on both templated entries ------------------------------------------------------------
// The post carries an <img> outlet the page does not, and an image component is the easiest place to
// smuggle a hydrated island in - so it is checked in its own right, not by proxy.
for (const [label, path] of [
    ["page", templatedPage],
    ["post", templatedPost]
]) {
    const name = `4. templated ${label} ships zero JS`
    if (!path) {
        record(name, false, `no templated ${label} to check`)
        continue
    }
    const zeroJs = await runZeroJsCheck(join(distClient, path))
    record(name, zeroJs.code === 0, zeroJs.output.trim().split("\n").pop() ?? "")
}

// --- 5. every untemplated page is untouched (D3) -----------------------------------------------------
// Both templated entries are excluded: each one legitimately changes between the two builds
const templatedPaths = new Set([templatedPage, templatedPost].filter(Boolean))
const others = [...baseline.html.keys()].filter((path) => !templatedPaths.has(path))
const sameSet =
    baseline.html.size === templated.html.size &&
    [...baseline.html.keys()].every((path) => templated.html.has(path))
const differing = others.filter((path) => !baseline.html.get(path).equals(templated.html.get(path) ?? Buffer.alloc(0)))
record(
    "5. untemplated pages byte-identical",
    sameSet && differing.length === 0 && others.length > 0,
    sameSet
        ? differing.length === 0
            ? `${others.length} page(s) unchanged`
            : `CHANGED: ${differing.join(", ")}`
        : "the two builds emitted different sets of pages"
)

// --- 6. the collection default renders an entry that names no template (D4 rule 2) --------------------
// Same template, same entry, reached the other way - so the page must come out BYTE-IDENTICAL to the
// templated build's. How a template is resolved cannot change what it renders. (Unlike gate 5, the other
// pages legitimately move here: with no pointer anywhere, every `pages` entry takes the default too.)
const defaulted = await buildAgainst("defaulted")
const defaultedPage = templatedPage ? defaulted.html.get(templatedPage) : undefined
record(
    "6. collection default renders an unpointed entry",
    defaulted.code === 0 && templatedPage !== null && defaultedPage !== undefined && defaultedPage.equals(templated.html.get(templatedPage)),
    defaulted.code !== 0
        ? `THE BUILD FAILED (exit ${defaulted.code})\n${tail(defaulted.output)}`
        : defaultedPage === undefined
          ? `the default did not render "${TEMPLATED_SLUG}" at all - rule 2 never fired`
          : defaultedPage.equals(templated.html.get(templatedPage))
            ? "identical to the pointed render"
            : "DIFFERS from the pointed render - the same template rendered the same entry two ways"
)

// --- 7. a broken pairing fails the build, naming entry + template + rule -------------------------------
const broken = await buildAgainst("broken")
const markers = {
    "the pairing lint": "fails the pairing lint",
    "the entry": TEMPLATED_SLUG,
    "the template": TEMPLATE_SLUG,
    "the rule": "dangling-outlet-field",
    "the field": BOUND_RICHTEXT_FIELD
}
const missing = Object.entries(markers)
    .filter(([, needle]) => !broken.output.includes(needle))
    .map(([label]) => label)
const brokenPassed = broken.code !== 0 && missing.length === 0
record(
    "7. broken pairing fails the build",
    brokenPassed,
    broken.code === 0
        ? "THE BUILD SUCCEEDED - a dangling outlet field did not fail it"
        : missing.length === 0
          ? "failed, naming entry + template + rule"
          : // It failed for the WRONG reason - show the evidence, or the next reader has to re-derive it.
            `failed, but the error never named: ${missing.join(", ")}\n${tail(broken.output)}`
)

if (templatedPost) {
    const html = templated.html.get(templatedPost).toString("utf8")
    const expectedSrc = `${MEDIA_BASE}/${MEDIA_STORAGE_KEY}`

    const titleInH1 = new RegExp(`<h1[^>]*>[\\s\\S]*?${POST_TITLE}[\\s\\S]*?</h1>`, "i").test(html)
    const bodyPresent = html.includes(POST_BODY_TEXT)
    const imagePresent = html.includes(expectedSrc) && html.includes(POST_IMAGE_ALT)
    // The whole dist/, not just this page: one Access-gated URL anywhere is a broken image in production.
    const gated = [...templated.html.entries()]
        .filter(([, bytes]) => bytes.toString("utf8").includes(INTERNAL_MEDIA_PREFIX))
        .map(([path]) => path)

    record(
        "8. the post's media resolves to the public origin",
        titleInH1 && bodyPresent && imagePresent && gated.length === 0,
        `title in <h1>: ${titleInH1}; body text: ${bodyPresent}; <img src="${expectedSrc}">: ${imagePresent}; ` +
            (gated.length === 0
                ? `no ${INTERNAL_MEDIA_PREFIX} URL anywhere in dist/`
                : `ACCESS-GATED media URL in: ${gated.join(", ")}`)
    )
} else {
    record("8. the post's media resolves to the public origin", false, "no templated post to inspect")
}

// --- report -------------------------------------------------------------------------------------------
console.log("\n" + "─".repeat(72))
for (const { name, passed, detail } of results) {
    console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`)
}
console.log("─".repeat(72))

const failed = results.filter((result) => !result.passed)
if (failed.length > 0) {
    console.error(`\nCOMPOSITOR ROUTING GATE FAILED - ${failed.length} of ${results.length} assertion(s)\n`)
    process.exit(1)
}
console.log("\nCOMPOSITOR ROUTING GATE PASSED (gates 2, 5 and 6)\n")
