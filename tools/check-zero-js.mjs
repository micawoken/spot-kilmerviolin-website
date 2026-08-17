/**
 * tools/check-zero-js.mjs
 *
 * Verifies that prerendered design pages ship zero client JavaScript
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
