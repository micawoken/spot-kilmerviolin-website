/**
 * lib/api/emdash_service_access.ts
 *
 * Allows EmDash service tokens to pass through for authentication
 *
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
 * EmDash credential token prefixes (node_modules/emdash/src/auth/api-tokens.ts): `ec_pat_` for personal
 * access tokens, `ec_oat_` for OAuth access tokens
 */
const EMDASH_TOKEN_PATTERN = /^ec_(?:pat|oat)_[A-Za-z0-9_-]+$/

/** Whether a Bearer token is shaped like an EmDash API credential. */
export function isEmdashApiToken(token: string): boolean {
    return EMDASH_TOKEN_PATTERN.test(token)
}

/** The design system's own collections - the only ones the setup tooling creates or seeds entries in. */
const DESIGN_COLLECTIONS = ["design_page", "design_template", "design_theme"]

/** An /_emdash request reduced to what the rules match on. */
interface EmdashServiceRequest {
    /** the uppercase HTTP method */
    method: string
    /** the path components after "_emdash" - e.g. ["api", "settings"] for /_emdash/api/settings */
    segments: string[]
}

/**
 * One allowlist rule. `why` names the caller the rule exists for, so a later reader can tell whether a
 * build change makes a rule obsolete (delete it) or merely moves it (edit it).
 */
interface ServiceRule {
    why: string
    allows: (request: EmdashServiceRequest) => boolean
}

/** An EmDash content id / collection slug: the shapes EmDash itself accepts, nothing path-like. */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/

const SERVICE_RULES: readonly ServiceRule[] = [
    {
        why: "build/emdash-api.ts fetchSettings - site chrome title/tagline",
        allows: ({ method, segments }) =>
            method === "GET" && segments.length === 2 && segments[0] === "api" && segments[1] === "settings"
    },
    {
        why: "build/emdash-api.ts fetchMenu - the primary and footer menus",
        allows: ({ method, segments }) =>
            method === "GET" &&
            segments.length === 3 &&
            segments[0] === "api" &&
            segments[1] === "menus" &&
            SAFE_SEGMENT.test(segments[2])
    },
    {
        why: "build/{emdash,design}-api.ts collection reads - pages, posts, design_page/template/theme",
        // GET /api/content/<collection> - list only. A per-item read (/<id>) is not a call the build makes.
        allows: ({ method, segments }) =>
            method === "GET" &&
            segments.length === 3 &&
            segments[0] === "api" &&
            segments[1] === "content" &&
            SAFE_SEGMENT.test(segments[2])
    },
    {
        why: "tools/{setup-design-collections,seed-entity-templates}.mjs - seed the design collections",
        // POST /api/content/<design collection> only; never a content collection the site publishes from.
        allows: ({ method, segments }) =>
            method === "POST" &&
            segments.length === 3 &&
            segments[0] === "api" &&
            segments[1] === "content" &&
            DESIGN_COLLECTIONS.includes(segments[2])
    },
    {
        why: "tools/setup-design-collections.mjs - publish a seeded design entry",
        // POST /api/content/<design collection>/<id>/publish
        allows: ({ method, segments }) =>
            method === "POST" &&
            segments.length === 5 &&
            segments[0] === "api" &&
            segments[1] === "content" &&
            DESIGN_COLLECTIONS.includes(segments[2]) &&
            SAFE_SEGMENT.test(segments[3]) &&
            segments[4] === "publish"
    },
    {
        why: "tools/setup-design-collections.mjs - list/create the design collections' schemas",
        // GET and POST /api/schema/collections. Schema writes are deliberately in scope: the setup script
        // creates the design collections. No other method reaches it.
        allows: ({ method, segments }) =>
            (method === "GET" || method === "POST") &&
            segments.length === 3 &&
            segments[0] === "api" &&
            segments[1] === "schema" &&
            segments[2] === "collections"
    },
    {
        why: "build/design-api.ts outlet fields + tools/setup-design-collections.mjs field additions",
        // GET and POST /api/schema/collections/<collection>/fields
        allows: ({ method, segments }) =>
            (method === "GET" || method === "POST") &&
            segments.length === 5 &&
            segments[0] === "api" &&
            segments[1] === "schema" &&
            segments[2] === "collections" &&
            SAFE_SEGMENT.test(segments[3]) &&
            segments[4] === "fields"
    }
]

/**
 * Whether an /_emdash request is one a service credential (build reader or setup tool) legitimately makes;
 * default-deny
 *
 * @param {string} method - the request method
 * @param {string[]} segments - the path components after "_emdash"
 * @returns {boolean} true only for a path the build or setup tooling actually calls
 */
export function isEmdashServiceRequest(method: string, segments: string[]): boolean {
    const request: EmdashServiceRequest = { method: method.toUpperCase(), segments }
    return SERVICE_RULES.some((rule) => rule.allows(request))
}
