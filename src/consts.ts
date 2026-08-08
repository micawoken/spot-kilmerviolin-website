/**
 * consts.ts
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

// Place any global data in this file.
// You can import this data from anywhere in your site by using the `import` keyword.

// general info
export const SITE_TITLE = "Website Title"
export const SITE_DESCRIPTION = "Website description"

// admin pages
export const ADMIN_PAGE_TITLE_PRFX = "Administrative Services - "

// placeholder shown in entity result views when a field is null or was not supplied by the API
// (a distinct marker so a blank field is not confused with an empty/unset render)
export const NOT_PROVIDED = "(not provided)"

// maximum length of an uploaded/bundled image's alt text (docs/dev/miscellaneous.txt's "data model
// changes" section specifies 256 for bundled sidecar files; the same cap applies to R2-uploaded alt
// text for consistency, since no distinct limit was specified for that case)
export const MAX_ALT_TEXT_LENGTH = 256

// Length caps for admin-authored free text on composer/contributor/composition records (lib/api/d1.ts),
// enforced on every write path (single-record forms, bulk import, direct API) as a data-sanitization
// backstop. No specific limit was documented for these fields; these are generous-but-finite defaults,
// not derived from a requirement — raise them if a real record legitimately needs more room.
export const MAX_NAME_LENGTH = 200 // name, role, part, publish_name/location, and similar single-line fields
export const MAX_LONG_TEXT_LENGTH = 5000 // bio, notes_pedagogical/historical/other
export const MAX_TAG_LENGTH = 50 // a single tag
export const MAX_TAGS_PER_RECORD = 25 // distinct tags per record

// The hostnames that serve the real site. Everything else a request can arrive on — the bare
// workers.dev hostname, a per-version preview URL, an unanticipated alias — is treated as a preview and
// gets the reduced surface (see detectEnvironmentFromHostname in lib/api/environment.ts). This is the
// fail-closed direction: a hostname nobody anticipated must not serve /admin, /api and /_emdash against
// the production bindings, which is what an allowlist of *staging* prefixes got wrong.
//
// Keep in sync with astro.config.mjs's `site` and `security.allowedDomains`: the static build derives its
// prerender request origin from `site`, so a hostname listed there but missing here would make every
// prerendered page classify as a preview.
export const PRODUCTION_HOSTS: string[] = ["kilmer.nrnnet.xyz"]

// origins permitted to make credentialed cross-origin requests. Because the API sends
// Access-Control-Allow-Credentials: true, the Access-Control-Allow-Origin value must be restricted to
// a known allowlist rather than reflecting an arbitrary request Origin. Entries are full origins
// (scheme://host[:port]) so the scheme and port are constrained, not just the hostname — an
// http:// or alternate-port variant of an allowed host is not accepted. Add future production
// domains here as they come online.
//
// The workers.dev origin is deliberately absent: it sits outside Cloudflare Access, so trusting it as a
// CSRF/CORS origin extended that trust to a host the Access policy does not cover.
export const ALLOWED_ORIGINS: string[] = ["https://kilmer.nrnnet.xyz"]
