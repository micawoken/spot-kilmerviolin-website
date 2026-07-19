/**
 * tests/admin-csp.test.ts
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
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
 * Guards the admin CSP's script-src 'self' (middleware/headers.ts) against the one mistake that
 * silently defeats it: an Astro client directive on an admin page. Astro renders an island's bootstrap
 * as inline <script> tags with no nonce or hash, so the CSP blocks them and the island never hydrates —
 * a failure with no build error and no visible symptom beyond an empty page. This shipped once already
 * (the compositor's editors, which now mount from a module script instead).
 *
 * Vite resolves the glob at transform time, so this reads the pages without a filesystem at runtime.
 */
const adminPages = import.meta.glob("../src/pages/admin/**/*.astro", {
    query: "?raw",
    import: "default",
    eager: true
}) as Record<string, string>

/**
 * A client directive applied to a framework component. Anchored to the opening tag — rather than
 * matching the bare directive anywhere — so that prose mentioning `client:only` (as edit.astro's own
 * comment does) is not a finding. Astro only honors these on imported components, which are always
 * capitalized; a lowercase tag is emitted as a plain HTML element. `[^>]*?` cannot cross the `>` that
 * ends the tag, so a match is necessarily an attribute of that component.
 */
const CLIENT_DIRECTIVE = /<[A-Z][A-Za-z0-9_.]*\s[^>]*?(client:(?:load|idle|visible|media|only))/s

describe("admin pages under the CSP", () => {
    it("finds the admin pages to check", () => {
        expect(Object.keys(adminPages).length).toBeGreaterThan(0)
    })

    // Keeps the check above from rotting into a vacuous pass: the pattern must still catch the directive
    // as it was actually written when this shipped broken, and must still ignore a prose mention of it.
    it("detects a client directive, and only in markup", () => {
        expect(CLIENT_DIRECTIVE.exec(`<DesignEditor id={id} client:only="react" />`)?.[1]).toBe("client:only")
        expect(CLIENT_DIRECTIVE.exec(`<ThemeEditor\n    client:load\n/>`)?.[1]).toBe("client:load")
        expect(CLIENT_DIRECTIVE.exec(`// mounted here rather than with client:only — see headers.ts`)).toBeNull()
    })

    it.each(Object.keys(adminPages))("%s uses no Astro client directive", (path) => {
        const match = CLIENT_DIRECTIVE.exec(adminPages[path])
        expect(
            match?.[1],
            `${path} uses ${match?.[0]}. Astro emits the island bootstrap inline, which the admin CSP's ` +
                `script-src 'self' blocks, so the island will never hydrate. Mount the component from a ` +
                `page <script> with a real import instead (see pages/admin/designs/edit.astro).`
        ).toBeUndefined()
    })
})
