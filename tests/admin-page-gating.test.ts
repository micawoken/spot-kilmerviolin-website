/**
 * tests/admin-page-gating.test.ts
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
 * Binds ADMIN_PAGE_STRUCTURE (middleware/identity.ts) to the admin pages that actually exist on disk.
 *
 * tests/admin-page-coverage.test.ts checks every admin page is LINKED from somewhere. Nothing checked
 * that a page is correctly GATED, which is how a directory move silently un-gated the visual compositor:
 * commit 0758b43 moved the design pages to /admin/advanced/designs and the token pages to
 * /admin/user/tokens without moving their map entries. adminPageAccess breaks on the first unmatched
 * segment and keeps the inherited requirement, so /admin/advanced/designs/theme fell through to the
 * "active" default — reachable by any active contributor, with or without design_editor. Neither entry
 * matched a real path any more, and nothing failed.
 *
 * Two directions, because each catches a different mistake:
 *   1. every path the map names must exist  — catches a page that MOVED away from its entry
 *   2. every page's resolved access must match the expectation below — catches a gate that was DELETED,
 *      loosened, or never added to a new page
 */

import { describe, it, expect } from "vitest"
import { ADMIN_PAGE_STRUCTURE, adminPageAccess } from "../src/middleware/identity.ts"
import type { AdminAccess } from "../src/lib/api/page_auth.ts"

// Vite resolves the glob at transform time, so the page tree is read without a runtime filesystem.
const adminPageFiles = import.meta.glob("../src/pages/admin/**/*.astro", {
    query: "?raw",
    import: "default",
    eager: true
}) as Record<string, string>

/** "../src/pages/admin/user/tokens/build.astro" -> "/admin/user/tokens/build" (index -> its directory). */
function routeOf(file: string): string {
    return file
        .replace("../src/pages", "")
        .replace(/\.astro$/, "")
        .replace(/\/index$/, "")
}

/** The routes on disk, excluding Astro's dynamic segments (no single concrete path to resolve). */
const routes = Object.keys(adminPageFiles)
    .map(routeOf)
    .filter((route) => !route.includes("["))
    .sort()

/** Splits a route the way the middleware does: non-empty path segments, with "admin" first. */
function segmentsOf(route: string): string[] {
    return route.split("/").filter((segment) => segment.length > 0)
}

/** A comparable, readable rendering of an access requirement. */
function describeAccess(access: AdminAccess): string {
    return access.kind === "permission" ? `permission:${[...access.permissions].sort().join("+")}` : access.kind
}

/**
 * Every admin page whose gate is NOT the "active" default, and what that gate must be. A page missing
 * from this map must resolve to "active"; a page present must resolve to exactly this value. Both
 * directions are asserted, so loosening a gate, dropping an entry, or adding an ungated page under a
 * gated section all fail here.
 */
const EXPECTED_ACCESS: Record<string, string> = {
    // the database terminal maps to POST /api/v1/command
    "/admin/advanced/command": "admin",
    // the self-enrollment flow must be reachable by a not-yet-enrolled (inactive) caller
    "/admin/advanced/selfenroll": "any",
    // the visual compositor — the pages this test exists because of
    "/admin/advanced/designs": "permission:design_editor",
    "/admin/advanced/designs/edit": "permission:design_editor",
    "/admin/advanced/designs/templates": "permission:design_editor",
    "/admin/advanced/designs/theme": "permission:design_editor",
    // user administration
    "/admin/user/activate": "permission:user_activation",
    "/admin/user/deactivate": "admin",
    "/admin/user/elevate": "admin",
    "/admin/user/demote": "admin",
    // build tokens have no owning contributor to self-manage
    "/admin/user/tokens/build": "admin",
    // IAM
    "/admin/iam/edit": "admin",
    "/admin/iam/email": "admin",
    "/admin/iam/add": "permission:user_addition",
    "/admin/iam/list": "permission:user_addition",
    "/admin/iam/remove": "permission:user_addition",
    "/admin/iam/whoami": "any",
    // both re-materialise the site: a rebuild queues a billable build, a purge forces every read to D1
    "/admin/site/rebuild": "permission:rebuild",
    "/admin/site/purge_cache": "permission:rebuild",
    // CSV bulk import performs non-self assignment and commits many records at once
    "/admin/composers/import": "admin",
    "/admin/contributors/import": "admin",
    "/admin/works/import": "admin",
    // self-service profile pages target only the caller's own record
    "/admin/profile": "any",
    "/admin/profile/deactivate": "any",
    "/admin/profile/edit": "any",
    "/admin/profile/reset_login": "any",
    // site policy pages are always accessible
    "/admin/terms-of-use": "any",
    "/admin/privacy-policy": "any",
    "/admin/security-policy": "any",
    "/admin/license": "any"
}

/** Walks ADMIN_PAGE_STRUCTURE and yields every route path its keys describe. */
function mappedRoutes(): string[] {
    const found: string[] = []
    const walk = (node: Record<string, { access?: AdminAccess; children?: Record<string, any> }>, prefix: string) => {
        for (const [segment, child] of Object.entries(node)) {
            const path = `${prefix}/${segment}`
            found.push(path)
            if (child.children) walk(child.children, path)
        }
    }
    walk(ADMIN_PAGE_STRUCTURE, "/admin")
    return found.sort()
}

describe("ADMIN_PAGE_STRUCTURE is bound to the pages on disk", () => {
    it("finds the admin pages to check", () => {
        expect(routes.length).toBeGreaterThan(20)
        expect(routes).toContain("/admin/advanced/designs/theme")
    })

    it("leaves the /admin landing page reachable while inactive or unenrolled", () => {
        // src/pages/admin.astro sits outside the globbed directory, and adminPageAccess special-cases it
        // rather than reading the map: an inactive or not-yet-enrolled caller must still be able to
        // navigate to the self-service flows.
        expect(describeAccess(adminPageAccess(["admin"]))).toBe("any")
    })

    it("names only paths that exist — a page that moved leaves its entry stale and ungated", () => {
        // The exact failure this test was written for: "designs" sat at the top level (matching
        // /admin/designs/**) after the pages moved to /admin/advanced/designs/**, and "advanced.tokens"
        // after they moved to /admin/user/tokens. Both entries matched nothing and gated nothing.
        const orphaned = mappedRoutes().filter((path) => !routes.includes(path))
        expect(orphaned).toEqual([])
    })

    it("gates every page exactly as expected, defaulting to active", () => {
        const actual: Record<string, string> = {}
        for (const route of routes) {
            const access = describeAccess(adminPageAccess(segmentsOf(route)))
            if (access !== "active") actual[route] = access
        }
        expect(actual).toEqual(EXPECTED_ACCESS)
    })

    it("keeps the compositor and theme editor behind design_editor, not merely behind being active", () => {
        for (const route of ["/admin/advanced/designs", "/admin/advanced/designs/theme"]) {
            const access = adminPageAccess(segmentsOf(route))
            expect(access.kind).toBe("permission")
            expect(access.kind === "permission" && access.permissions).toContain("design_editor")
        }
    })

    it("inherits a section's requirement into an unlisted descendant (fail closed)", () => {
        // an unlisted page under a gated section keeps the section's requirement rather than resetting
        expect(describeAccess(adminPageAccess(segmentsOf("/admin/advanced/designs/not-a-real-page")))).toBe(
            "permission:design_editor"
        )
    })
})
