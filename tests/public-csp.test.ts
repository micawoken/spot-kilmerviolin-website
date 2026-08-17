/**
 * tests/public-csp.test.ts
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

import { describe, it, expect } from "vitest"
import { PUBLIC_CSP } from "../src/middleware/headers"

import headersFile from "../public/_headers?raw"

/** The value half of the `Content-Security-Policy:` line in a _headers rule. */
function cspFromHeadersFile(contents: string): string | null {
    for (const line of contents.split("\n")) {
        // a rule's headers are indented; an unindented line is a path pattern, and # is a comment
        if (!/^\s/.test(line) || line.trim().startsWith("#")) {
            continue
        }
        const match = /^\s*Content-Security-Policy\s*:\s*(.+?)\s*$/i.exec(line)
        if (match) {
            return match[1]
        }
    }
    return null
}

describe("the public CSP", () => {
    it("is declared in public/_headers", () => {
        expect(cspFromHeadersFile(headersFile)).not.toBeNull()
    })

    // Guards the check above against passing vacuously: the extractor must ignore the commented-out
    // copy of the policy that documents it in that same file, and must read the real rule's value.
    it("is read from the rule, not from the comment documenting it", () => {
        expect(cspFromHeadersFile("# Content-Security-Policy: fake\n/*\n  Content-Security-Policy: real\n")).toBe("real")
        expect(cspFromHeadersFile("/*\n  X-Frame-Options: DENY\n")).toBeNull()
    })

    it("matches PUBLIC_CSP in middleware/headers.ts exactly", () => {
        expect(
            cspFromHeadersFile(headersFile),
            "public/_headers and PUBLIC_CSP have drifted. A prerendered page is governed by the file and " +
                "an SSR page by the constant, so the same route would get a different policy depending on " +
                "which one it is. Update both."
        ).toBe(PUBLIC_CSP)
    })
})
