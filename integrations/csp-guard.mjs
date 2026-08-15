/**
 * integrations/csp-guard.mjs
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

// integrations/csp-guard.mjs
//
// Astro integration that fails the build when a prerendered page emits markup the public
// Content-Security-Policy blocks.
//
// The public CSP is a static header in public/_headers, because prerendered pages are served straight
// from the Workers ASSETS binding and never reach src/middleware/headers.ts. A static header carries no
// per-build hash or nonce, so `script-src 'self'` means exactly that: any inline <script> or inline event
// handler that reaches dist/client is dead code in production. That failure is silent - no build error,
// no visible symptom beyond a control that quietly stops working - which is the same trap
// tests/admin-csp.test.ts guards on the admin side, where the CSP comes from middleware instead.
//
// Two checks, both against the emitted HTML rather than the sources, so they cannot be fooled by however
// the markup was authored (component, integration, or Astro's own bundler inlining a small chunk):
//
//   1. no executable inline <script> - one without a `src`. JSON data blocks are exempt because CSP does
//      not govern them; an inline importmap is NOT exempt, since script-src does govern those.
//   2. no inline event-handler attribute (onclick=, onerror=, …), matched only inside an opening tag so
//      prose or a code sample naming one is not a finding.
//
// It also asserts the policy itself survived into the output, so deleting public/_headers cannot silently
// strip the public site of every security header while these checks keep passing vacuously.

import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_TAG = /<script\b([^>]*)>/gi
const HAS_SRC = /\ssrc\s*=/i
const TYPE_ATTR = /\stype\s*=\s*["']?([^"'\s>]+)/i
// Non-executable script types. CSP treats these as data, not script, so an inline block is allowed.
const DATA_BLOCK_TYPES = new Set(["application/json", "application/ld+json"])
// Anchored to an opening tag: `[^>]*` cannot cross the `>` that ends it, so a match is necessarily an
// attribute. Three characters minimum after "on" keeps it off short non-handler attribute names.
const EVENT_ATTR = /<[a-z][a-z0-9-]*[^>]*\s(on[a-z]{3,})\s*=\s*["']/i
// The number of offending files named in the failure message; the count is always reported in full.
const REPORT_LIMIT = 10

/** Yields every .html file under `root`, as an absolute path. */
async function* htmlFiles(root) {
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name)
        if (entry.isDirectory()) {
            yield* htmlFiles(full)
        } else if (entry.isFile() && entry.name.endsWith(".html")) {
            yield full
        }
    }
}

/** Returns a description of the first CSP violation in `html`, or null if it has none. */
function findViolation(html) {
    for (const match of html.matchAll(SCRIPT_TAG)) {
        const attrs = match[1]
        if (HAS_SRC.test(attrs)) {
            continue
        }
        const type = TYPE_ATTR.exec(attrs)?.[1]?.toLowerCase()
        if (type && DATA_BLOCK_TYPES.has(type)) {
            continue
        }
        return `inline <script${attrs.trimEnd()}>`
    }
    const handler = EVENT_ATTR.exec(html)
    return handler ? `inline event handler ${handler[1]}=` : null
}

export default function cspGuard() {
    return {
        name: "csp-guard",
        hooks: {
            "astro:build:done": async ({ dir, logger }) => {
                const root = fileURLToPath(dir)

                const headers = await fs.readFile(path.join(root, "_headers"), "utf-8").catch(() => "")
                if (!/^\s*Content-Security-Policy\s*:/im.test(headers)) {
                    throw new Error(
                        "csp-guard: no Content-Security-Policy rule in the built _headers file. Prerendered " +
                            "pages are served from the ASSETS binding and never reach middleware/headers.ts, " +
                            "so public/_headers is the public site's only source of security headers."
                    )
                }

                const offenders = []
                let checked = 0
                for await (const file of htmlFiles(root)) {
                    checked++
                    const violation = findViolation(await fs.readFile(file, "utf-8"))
                    if (violation) {
                        offenders.push(`${path.relative(root, file)}: ${violation}`)
                    }
                }

                if (offenders.length > 0) {
                    const shown = offenders.slice(0, REPORT_LIMIT).join("\n  ")
                    const rest = offenders.length - REPORT_LIMIT
                    throw new Error(
                        `csp-guard: ${offenders.length} of ${checked} prerendered pages emit markup the ` +
                            `public CSP blocks (script-src 'self', no 'unsafe-inline'):\n  ${shown}` +
                            (rest > 0 ? `\n  …and ${rest} more` : "") +
                            "\nMove the code into a page <script> that carries a real import, so Astro emits " +
                            "it as an external hashed module, and bind events with addEventListener."
                    )
                }
                logger.info(`checked ${checked} prerendered pages against the public CSP`)
            }
        }
    }
}
