/**
 * consts.ts
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

// origins permitted to make credentialed cross-origin requests. Because the API sends
// Access-Control-Allow-Credentials: true, the Access-Control-Allow-Origin value must be restricted to
// a known allowlist rather than reflecting an arbitrary request Origin. Entries are full origins
// (scheme://host[:port]) so the scheme and port are constrained, not just the hostname — an
// http:// or alternate-port variant of an allowed host is not accepted. Add future production
// domains here as they come online.
export const ALLOWED_ORIGINS: string[] = ["https://kilmer.nrnnet.xyz", "https://spot-kilmerviolin.nrnnetint.workers.dev"]
