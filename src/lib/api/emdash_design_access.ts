/**
 * lib/api/emdash_design_access.ts
 *
 * Allows certain emdash pages to be accessed by design_editors when using the
 * compositor system
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

import { isTemplateCollection } from "../compositor/types"

/** The design system's own collections. It owns these outright — read and write, including publish. */
const DESIGN_COLLECTIONS = ["design_page", "design_template", "design_theme"]

/**
 * An EmDash content item id: a ULID (`ulidx`, used everywhere EmDash mints a content row) — 26 characters
 * of Crockford base32, which excludes I, L, O and U
 */
const CONTENT_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

/** Whether a path segment is an EmDash content id rather than a sub-route name (see CONTENT_ID_PATTERN). */
function isContentId(segment: string): boolean {
    return CONTENT_ID_PATTERN.test(segment)
}

/** An /_emdash request reduced to what the rules match on. */
interface EmdashRequest {
    /** the uppercase HTTP method */
    method: string
    /** the path components after "_emdash" — e.g. ["api", "content", "pages"] for /_emdash/api/content/pages */
    segments: string[]
}

/**
 * One allowlist rule
 */
interface DesignSystemRule {
    why: string
    allows: (request: EmdashRequest) => boolean
}

/**
 * The paths a design_editor may reach; otherwise, default-deny
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
        // GET /api/content/<template collection> or /<id>: READ-ONLY, only a collection a template targets
        allows: ({ method, segments }) =>
            method === "GET" &&
            segments[0] === "api" &&
            segments[1] === "content" &&
            isTemplateCollection(segments[2] ?? "") &&
            (segments.length === 3 || (segments.length === 4 && isContentId(segments[3])))
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
        // GET /api/media and GET /api/media/file/<id>: read-only; a design editor cannot UPLOAD media
        allows: ({ method, segments }) =>
            method === "GET" &&
            segments[0] === "api" &&
            segments[1] === "media" &&
            (segments.length === 2 || segments[2] === "file")
    }
]

/**
 * Whether an /_emdash request is one the visual design system makes — and so one a `design_editor` may
 * be admitted to without `cms_editor`. Default-deny: an unmatched path is refused.
 */
export function isDesignSystemRequest(method: string, segments: string[]): boolean {
    const request: EmdashRequest = { method: method.toUpperCase(), segments }
    return DESIGN_SYSTEM_RULES.some((rule) => rule.allows(request))
}
