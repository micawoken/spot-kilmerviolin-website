/**
 * tests/emdash-role.test.ts
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

/**
 * Guards the EmDash role a Cloudflare Access user is provisioned at (astro.config.mjs, `access()`)
 */
const config = import.meta.glob("../astro.config.mjs", {
    query: "?raw",
    import: "default",
    eager: true
}) as Record<string, string>

/** EmDash's Role.EDITOR level (@emdash-cms/auth), the minimum that satisfies `schema:read`. */
const ROLE_EDITOR = 40

describe("EmDash Access role provisioning", () => {
    it("reads the astro config", () => {
        expect(Object.keys(config)).toHaveLength(1)
    })

    it("provisions Access users at Editor, so the outlet field pickers can read the collection schema", () => {
        const source = Object.values(config)[0] ?? ""
        const match = /defaultRole:\s*(\d+)/.exec(source)

        expect(match, "astro.config.mjs must set access({ defaultRole }) - the adapter's default is AUTHOR").not.toBeNull()
        expect(Number(match?.[1])).toBe(ROLE_EDITOR)
    })
})
