/**
 * tools/check-zero-js.mjs
 *
 * Verifies that prerendered design pages ship zero client JavaScript: each given HTML file must
 * contain no <astro-island> element and no <script> tag. Exits non-zero naming every offending
 * file. Part of the Phase 1 verification checklist (§6.8); run manually after `pnpm build` — not
 * wired into the build.
 *
 *   node tools/check-zero-js.mjs dist/...paths to .html files
 */

import { readFile } from "node:fs/promises"

const files = process.argv.slice(2)
if (files.length === 0) {
    console.error("Usage: node tools/check-zero-js.mjs <dist/...paths to .html files>")
    process.exit(1)
}

let failed = false
for (const file of files) {
    const html = await readFile(file, "utf8")
    const findings = []
    if (/<astro-island[\s>]/i.test(html)) findings.push("<astro-island>")
    if (/<script[\s>]/i.test(html)) findings.push("<script>")
    if (findings.length > 0) {
        failed = true
        console.error(`FAIL ${file}: contains ${findings.join(" and ")}`)
    } else {
        console.log(`OK   ${file}: no client JS`)
    }
}
process.exit(failed ? 1 : 0)
