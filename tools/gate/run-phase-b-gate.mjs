/**
 * tools/gate/run-phase-b-gate.mjs
 *
 * The compositor pivot's Phase B and C gate (plan §6, gates 2, 5 and 6), executable and re-runnable:
 *
 *   npm run gate:phase-b
 *
 * It builds the site four times against a frozen fixture CMS (tools/gate/fixtures.mjs) and asserts:
 *
 *   1. no unrecorded CMS path was requested        (else the build degraded and nothing below means anything)
 *   2. the templated build is not vacuous          (a CMS-less build emits ZERO html and would pass 3–5 trivially)
 *   3. the entry rendered THROUGH the template     (its fields reached the page via outlets)
 *   4. the templated page and post ship zero JS    (delegated to tools/check-zero-js.mjs)
 *   5. every untemplated page is byte-identical    (D3: attaching a template to one entry moves nothing else)
 *   6. an entry that names NO template renders through its collection's default (D4 rule 2)
 *   7. a broken pairing FAILS the build, naming entry + template + rule
 *   8. a post's image resolves to the PUBLIC media origin, and no page links the Access-gated proxy
 *
 * Assertion 2 is not paranoia: `astro build` with no reachable CMS prerenders no pages at all, so a
 * "no <script> anywhere in dist/" sweep over that output passes while proving nothing. Assertion 7
 * likewise checks the error TEXT, not just a non-zero exit — a build can fail for the wrong reason, and
 * the gate's actual claim is that the failure tells the author which entry, which template, and which rule.
 *
 * Assertion 6 exists because 3–5 all reach the template through rule 1 (the entry's own `design` pointer),
 * which left rule 2 unexercised — and it was in fact DEAD in production: `is_default` arrives from EmDash
 * as the number 1, and the build tested it with `=== true`. Only a fixture serving EmDash's real wire shape
 * can catch that, so this one does.
 *
 * Assertion 8 is Phase C's whole point. `posts.featured_image` is the only image field either routed
 * collection defines, so a post is the first entry that can prove a rendered <img> is reachable by an
 * anonymous visitor. A same-origin `/_emdash/api/media/file/…` URL is not: it 302s to an Access login.
 *
 * This overwrites the working `dist/` (gitignored) as it goes; the last build is the one that FAILS on
 * purpose, so do not expect a usable `dist/` afterwards.
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
 *
 * This license is also subject to additional terms as specified in the README.md.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
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

/** EmDash's same-origin media proxy — Access-gated, so it must NEVER appear in a prerendered page. */
const INTERNAL_MEDIA_PREFIX = "/_emdash/api/media/file/"

const root = fileURLToPath(new URL("../..", import.meta.url))
const astroBin = join(root, "node_modules", "astro", "bin", "astro.mjs")
const distClient = join(root, "dist", "client")

const results = []
const record = (name, passed, detail = "") => results.push({ name, passed, detail })

/** The tail of a build's output. A failing assertion must show its evidence, not just its verdict. */
const tail = (output, lines = 25) =>
    output
        .split("\n")
        .filter((line) => line.trim() !== "")
        .slice(-lines)
        .map((line) => `        │ ${line}`)
        .join("\n")

/** Runs `astro build` against a fixture CMS. Never throws on a failed build — the gate inspects it. */
function build(base) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [astroBin, "build"], {
            cwd: root,
            // A shell CONTENT_API_BASE overrides .env, which is what isolates this from prod. The media
            // origin is pinned the same way and to a FAKE host, so assertion 8 proves the build actually
            // read EMDASH_MEDIA_PUBLIC_URL rather than coincidentally matching the real origin.
            env: { ...process.env, CONTENT_API_BASE: base, EMDASH_MEDIA_PUBLIC_URL: MEDIA_BASE },
            stdio: ["ignore", "pipe", "pipe"]
        })
        let output = ""
        child.stdout.on("data", (chunk) => (output += chunk))
        child.stderr.on("data", (chunk) => (output += chunk))
        child.on("close", (code) => resolve({ code, output }))
    })
}

/** Every prerendered page in dist/client, as relative-path → bytes. */
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
// smuggle a hydrated island in — so it is checked in its own right, not by proxy.
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
// Both templated entries are excluded: each one legitimately changes between the two builds — that is
// what assertion 3 proves. Everything else must not move.
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
// Same template, same entry, reached the other way — so the page must come out BYTE-IDENTICAL to the
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
          ? `the default did not render "${TEMPLATED_SLUG}" at all — rule 2 never fired`
          : defaultedPage.equals(templated.html.get(templatedPage))
            ? "identical to the pointed render"
            : "DIFFERS from the pointed render — the same template rendered the same entry two ways"
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
        ? "THE BUILD SUCCEEDED — a dangling outlet field did not fail it"
        : missing.length === 0
          ? "failed, naming entry + template + rule"
          : // It failed for the WRONG reason — show the evidence, or the next reader has to re-derive it.
            `failed, but the error never named: ${missing.join(", ")}\n${tail(broken.output)}`
)

// --- 8. the post's image is reachable by an anonymous visitor (media through the public origin) --------
// MEDIA_BASE is a host that does not exist. If the emitted <img> carries it, the build genuinely read
// EMDASH_MEDIA_PUBLIC_URL out of its environment; if it carried the real origin instead, .env had won and
// the assertion would be proving nothing about the code under test.
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
    console.error(`\nPHASE B/C GATE FAILED — ${failed.length} of ${results.length} assertion(s)\n`)
    process.exit(1)
}
console.log("\nPHASE B/C GATE PASSED (plan §6 gates 2, 5 and 6)\n")
