/**
 * lib/api/emdash_design_access.ts
 *
 * The allowlist of /_emdash paths the visual design system calls — the set a `design_editor` may reach
 * WITHOUT holding `cms_editor`. Applied by src/middleware/emdash_access.ts.
 *
 * Why this exists at all: the design system (/admin/designs — the design list, the Puck editor, the theme
 * editor) is a browser-side EmDash API client. The editor talks to /_emdash directly from the page. So
 * "let a design editor use the design system without handing them the CMS" cannot be expressed as a page
 * gate; it has to be expressed over the paths and methods that page actually calls. That is this module.
 *
 * It is DEFAULT-DENY. A path no rule matches is refused, so a new EmDash endpoint is unreachable to a
 * design_editor until someone adds it here on purpose.
 *
 * This is the ONLY thing standing between a design_editor and the rest of the CMS. Their EmDash *role* is
 * Editor (astro.config.mjs `defaultRole: 40`, which the design system's `schema:read` requires), so EmDash
 * itself would happily honor a write to `pages` from them. Loosening a rule here — widening a method,
 * dropping a segment-count check — hands a design editor the CMS. tests/emdash_access.test.ts pins the
 * DENY side for exactly that reason; keep it that way.
 *
 * Kept separate from the middleware so it can be tested as a pure function, with no Astro or environment
 * imports to drag in.
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

import { isTemplateCollection } from "../compositor/types"

/** The design system's own collections. It owns these outright — read and write, including publish. */
const DESIGN_COLLECTIONS = ["design_page", "design_template", "design_theme"]

/** An /_emdash request reduced to what the rules match on. */
interface EmdashRequest {
    /** the uppercase HTTP method */
    method: string
    /** the path components after "_emdash" — e.g. ["api", "content", "pages"] for /_emdash/api/content/pages */
    segments: string[]
}

/**
 * One allowlist rule. `why` is not decoration: it names the single call the rule exists to permit, so a
 * later reader can tell whether a change to the design system makes a rule obsolete (delete it) or merely
 * moves it (edit it) — rather than widening it "to be safe".
 */
interface DesignSystemRule {
    why: string
    allows: (request: EmdashRequest) => boolean
}

/**
 * The paths a design_editor may reach, and nothing else. Each rule is the narrowest expression of one call
 * the design system actually makes; re-derive the list with
 * `grep -rn "_emdash" src/components/compositor src/lib/compositor src/pages/admin/designs`.
 *
 * The read-only rules are pinned to GET deliberately. The design system never writes to a content
 * collection other than its own, so admitting any other method there would grant the CMS by accident.
 */
const DESIGN_SYSTEM_RULES: readonly DesignSystemRule[] = [
    {
        why: "the design collections themselves — list, load, create, autosave, publish",
        // /api/content/design_page[/<id>[/publish]] — any method: this is the design system's own data.
        allows: ({ segments }) =>
            segments[0] === "api" && segments[1] === "content" && DESIGN_COLLECTIONS.includes(segments[2] ?? "")
    },
    {
        why: "the preview-entry picker — list a template's collection, then load one entry to render through it",
        // GET /api/content/<template collection>[/<id>]: READ-ONLY, and only a collection a template targets.
        allows: ({ method, segments }) =>
            method === "GET" &&
            segments[0] === "api" &&
            segments[1] === "content" &&
            isTemplateCollection(segments[2] ?? "") &&
            segments.length <= 4
    },
    {
        why: "the outlet field pickers — the live field schema of the collection a template renders",
        // GET /api/schema/collections/<template collection>/fields: read-only, and no schema WRITES.
        allows: ({ method, segments }) =>
            method === "GET" &&
            segments[0] === "api" &&
            segments[1] === "schema" &&
            segments[2] === "collections" &&
            isTemplateCollection(segments[3] ?? "") &&
            segments[4] === "fields" &&
            segments.length === 5
    },
    {
        why: "the Image component's media picker — list the library and load a file",
        // GET /api/media and GET /api/media/file/<id>: read-only; a design editor cannot UPLOAD media.
        allows: ({ method, segments }) => method === "GET" && segments[0] === "api" && segments[1] === "media"
    }
]

/**
 * Whether an /_emdash request is one the visual design system makes — and so one a `design_editor` may be
 * admitted to without holding `cms_editor`. Default-deny: an unmatched path is refused.
 *
 * @param {string} method - the request's HTTP method (case-insensitive)
 * @param {string[]} segments - the path components after "_emdash", already split and emptied of blanks
 * @returns {boolean} true when an allowlist rule admits the request
 */
export function isDesignSystemRequest(method: string, segments: string[]): boolean {
    const request: EmdashRequest = { method: method.toUpperCase(), segments }
    return DESIGN_SYSTEM_RULES.some((rule) => rule.allows(request))
}
