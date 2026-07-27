/**
 * tests/admin-page-coverage.test.ts
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
 * Guards against an admin page that exists on disk but is reachable only by typing its URL — the exact
 * gap that let /admin/advanced/designs sit undiscoverable for weeks (plan-prelaunch-features.md §4). Every page
 * under src/pages/admin/** must appear as a literal href somewhere in admin.astro or another admin page
 * (a section landing page linking to its own children, e.g. profile.astro -> profile/edit).
 *
 * Vite resolves both globs at transform time, so this reads page source without a filesystem at runtime.
 */
const sectionPages = import.meta.glob("../src/pages/admin/**/*.astro", {
    query: "?raw",
    import: "default",
    eager: true
}) as Record<string, string>

const dashboardPage = import.meta.glob("../src/pages/admin.astro", {
    query: "?raw",
    import: "default",
    eager: true
}) as Record<string, string>

// AdminFooter is rendered on nearly every admin page (via layouts/AdminDocument.astro) and carries the
// literal hrefs for the help/legal pages (docs, terms-of-use, privacy-policy, security-policy). Those
// pages are genuinely reachable from any admin page's footer, not just from admin.astro or a section
// page, so the footer's source has to be part of the haystack too.
const sharedChrome = import.meta.glob("../src/components/AdminFooter.astro", {
    query: "?raw",
    import: "default",
    eager: true
}) as Record<string, string>

/**
 * Deliberate exceptions: pages reached only through a dynamic, content-driven list rather than a static
 * `href="...">` string, so no literal link to them exists anywhere in source for this test to find.
 */
const ALLOWLIST = new Set<string>([
    // per-design editor, reached from the design list's client-side EDITOR_PATH navigation, not a static
    // href (src/pages/admin/advanced/designs/index.astro)
    "/admin/advanced/designs/edit",
    // the dynamic route pattern itself; per-doc pages are reached from docs/index.astro's
    // `href={`/admin/docs/${doc.id}`}` template literal, one per content-collection entry
    "/admin/docs/[...slug]"
])

/** Turns a glob key like "../src/pages/admin/works/create.astro" into the route "/admin/works/create". */
function deriveRoute(globKey: string): string {
    const route = globKey.replace(/^.*\/pages/, "").replace(/\.astro$/, "")
    return route.replace(/\/index$/, "")
}

describe("every admin page is reachable from the dashboard or a section page", () => {
    const haystack =
        Object.values(sectionPages).join("\n") +
        Object.values(dashboardPage).join("\n") +
        Object.values(sharedChrome).join("\n")
    const routes = Object.keys(sectionPages).map(deriveRoute)

    it("finds the admin pages to check", () => {
        expect(routes.length).toBeGreaterThan(0)
    })

    it.each(routes.filter((route) => !ALLOWLIST.has(route)))("%s is linked from an admin page", (route) => {
        expect(
            haystack.includes(`href="${route}"`),
            `${route} has no page under src/pages/admin/** or admin.astro linking to it with a literal ` +
                `href. Either add a link (see admin.astro's section cards) or, if it is genuinely reached ` +
                `only via a dynamic/content-driven list, add it to this test's ALLOWLIST with a comment ` +
                `explaining why.`
        ).toBe(true)
    })

    // Keeps the allowlist itself honest: every entry must correspond to a real page, so a renamed or
    // deleted file surfaces as a failure here instead of silently narrowing the check forever.
    it("the allowlist contains only routes that still exist", () => {
        for (const route of ALLOWLIST) {
            expect(routes, `${route} is allowlisted but no longer corresponds to a page under src/pages/admin`).toContain(
                route
            )
        }
    })
})
