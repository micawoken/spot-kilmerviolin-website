/**
 * tests/environment.test.ts
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
import { PRODUCTION_HOSTS, ALLOWED_ORIGINS } from "../src/consts.ts"

// Read as text, not imported: evaluating astro.config.mjs pulls in the whole integration graph (and its
// native rolldown binding), which a unit test has no business loading. Only the `site` literal is needed.
const astroConfigSource = Object.values(
    import.meta.glob("../astro.config.mjs", { query: "?raw", import: "default", eager: true })
)[0] as string

/**
 * PRODUCTION_HOSTS is the allowlist detectEnvironmentFromHostname (lib/api/environment.ts) classifies
 * against, and three gates hang off that classification: the /api + /admin + /_emdash 404 kill-switch
 * (middleware/identity.ts), the D1 write gate (dbWriteEnabled), and the public pages' noindex
 * (BaseHead.astro). The list is deliberately tiny, so the failure modes are both directions of drift.
 */
describe("PRODUCTION_HOSTS", () => {
    /**
     * The static build derives its prerender request origin from astro.config's `site`
     * (node_modules/astro/dist/core/build/index.js — `new URL(settings.config.site).origin`). If that
     * hostname were missing here, every prerendered public page would classify as a preview and ship
     * with noindex — a silent, site-wide SEO failure with no build error.
     */
    it("contains the hostname the static build prerenders against", () => {
        const site = /^\s*site:\s*"([^"]+)"/m.exec(astroConfigSource)?.[1]
        expect(site).toBeTruthy()
        expect(PRODUCTION_HOSTS).toContain(new URL(site!).hostname)
    })

    it("excludes the hostnames that sit outside Cloudflare Access", () => {
        // The bare workers.dev hostname and every per-version preview URL. Listing any of them would
        // re-open the full admin/API surface on an origin the Access policy does not cover.
        for (const host of PRODUCTION_HOSTS) {
            expect(host.endsWith("workers.dev")).toBe(false)
        }
    })

    it("keeps the credentialed-CORS allowlist within the production hosts", () => {
        // ALLOWED_ORIGINS is echoed with Access-Control-Allow-Credentials: true and doubles as the CSRF
        // origin allowlist (lib/api/http.ts), so an entry outside Access extends that trust off-policy.
        for (const origin of ALLOWED_ORIGINS) {
            const url = new URL(origin)
            expect(url.protocol).toBe("https:")
            expect(PRODUCTION_HOSTS).toContain(url.hostname)
        }
    })
})
