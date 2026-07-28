/**
 * tests/ratelimit-scopes.test.ts
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

/**
 * Keeps RLScope (lib/public/ratelimit.ts) in step with the bindings declared in wrangler.jsonc.
 *
 * These drifted apart silently once already: four of the seven declared limiters — RL_API_PUBLIC,
 * RL_API_ADMIN_GLOBAL, RL_API_ADMIN_USER and RL_ADMIN_RENDER — were never referenced, with every scope
 * but the two file ones pointing at RL_FREQ instead. Nothing failed; the configured budgets simply were
 * not in force, and the effective admin-API allowance was more than double the design figure.
 */

import { describe, it, expect } from "vitest"
import { env } from "cloudflare:workers"
import { RLScope, scopeKeyType } from "../src/lib/public/ratelimit.ts"

/** The scope enum's members, as numbers (a TS numeric enum also maps names back from values). */
const scopes = Object.values(RLScope).filter((value): value is RLScope => typeof value === "number")

/** Every rate-limit binding declared in wrangler.jsonc. */
const DECLARED_BINDINGS = [
    "RL_FREQ",
    "RL_API_PUBLIC",
    "RL_API_ADMIN_GLOBAL",
    "RL_API_ADMIN_USER",
    "RL_ADMIN_RENDER",
    "RL_API_FILES_READ",
    "RL_API_FILES_WRITE"
] as const

describe("rate-limit scopes and bindings", () => {
    it("declares every binding wrangler.jsonc configures", () => {
        for (const name of DECLARED_BINDINGS) {
            expect(env[name], `${name} is configured but not bound`).toBeDefined()
        }
    })

    it("gives every scope a key type — an unmapped scope throws rather than metering the wrong bucket", () => {
        for (const scope of scopes) {
            expect(["ip", "user", "global"]).toContain(scopeKeyType(scope))
        }
    })

    it("keys the aggregate scopes globally, not per user", () => {
        // ENDPOINT_API_ADMIN_GLOBAL is documented as applying globally; keying it by user made it a
        // duplicate of ENDPOINT_API_ADMIN_USER beside it, so nothing bounded total API volume.
        expect(scopeKeyType(RLScope.ENDPOINT_API_ADMIN_GLOBAL)).toBe("global")
        expect(scopeKeyType(RLScope.ENDPOINT_API_PUBLIC)).toBe("global")
    })

    it("keys the per-caller scopes as their names promise", () => {
        expect(scopeKeyType(RLScope.IP_GLOBAL)).toBe("ip")
        expect(scopeKeyType(RLScope.ENDPOINT_API_FILES_READ)).toBe("ip")
        expect(scopeKeyType(RLScope.ENDPOINT_API_ADMIN_USER)).toBe("user")
        expect(scopeKeyType(RLScope.ENDPOINT_API_FILES_WRITE)).toBe("user")
        expect(scopeKeyType(RLScope.ENDPOINT_PAGERENDER_ADMIN)).toBe("user")
    })

    it("has at least one scope that can be evaluated before authentication", () => {
        // The pre-identity pass exists so a request rejected by identity.ts is still metered; if every
        // scope became user-keyed, that pass would silently do nothing.
        expect(scopes.some((scope) => scopeKeyType(scope) !== "user")).toBe(true)
    })
})
