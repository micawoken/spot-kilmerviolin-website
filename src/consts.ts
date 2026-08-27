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

// maximum length of an uploaded/bundled image's alt text
export const MAX_ALT_TEXT_LENGTH = 256

// Length caps for admin-authored free text on composer/contributor/composition records
export const MAX_NAME_LENGTH = 200 // name, role, part, publish_name/location, and similar single-line fields
export const MAX_LONG_TEXT_LENGTH = 5000 // bio, notes_pedagogical/historical/other
export const MAX_TAG_LENGTH = 50 // a single tag
export const MAX_TAGS_PER_RECORD = 25 // distinct tags per record

// The hostnames that serve the real site; keep in sync with
// astro.config.mjs's `site` and `security.allowedDomains`
export const PRODUCTION_HOSTS: string[] = ["kilmer.nrnnet.xyz"]

// origins permitted to make credentialed cross-origin requests
export const ALLOWED_ORIGINS: string[] = ["https://kilmer.nrnnet.xyz"]

// Length caps for the public contact form (src/pages/submit/contact.ts, src/scripts/contact_form.ts).
// Name/subject reuse MAX_NAME_LENGTH above.
export const MAX_CONTACT_BODY_LENGTH = 2000
export const MAX_CONTACT_EMAIL_LENGTH = 254 // RFC 5321 mailbox length limit
export const MAX_CONTACT_PHONE_LENGTH = 32
export const MAX_CONTACT_SOURCE_PATH_LENGTH = 512 // the SuggestChanges component's ?source= page path

// Raw JSON request-body size cap for POST /submit/contact, in characters. Comfortably covers every field
// cap above plus a Turnstile response token (~2KB) and JSON overhead, while bounding the work done reading
// and parsing the body of a request from an IP not yet rate-limited.
export const MAX_CONTACT_REQUEST_BODY_LENGTH = 8192

// Queue cap enforced atomically by trg_contact_responses_queue_limit in the database schema and migration.
export const MAX_CONTACT_RESPONSES = 500

export const MAX_CONTACT_BULK_IDS = 100
export const MAX_CONTACT_ADMIN_REQUEST_BODY_LENGTH = 4096
