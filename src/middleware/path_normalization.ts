/**
 * middleware/path_normalization.ts
 *
 * Rejects request paths that percent-encode unreserved characters, so every later middleware matches the
 * same path Astro routes
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

import type { MiddlewareHandler } from "astro"
import { middlewareErrorResponder } from "../lib/api/http"

/**
 * An escape that decodes to an RFC 3986 unreserved character: A-Z, a-z, 0-9, "-", ".", "_", "~"
 *
 * Astro decodes the pathname before routing, but `new URL(request.url).pathname` keeps the escapes, so
 * `/%5Femdash/api/media` routes to EmDash while every raw-path comparison sees a different first segment.
 */
const ENCODED_UNRESERVED = /%(?:4[1-9A-F]|5[0-9AF]|6[1-9A-F]|7[0-9AE]|3[0-9]|2[DE])/i

export const pathNormalization: MiddlewareHandler = async (context, next) => {
    if (ENCODED_UNRESERVED.test(new URL(context.request.url).pathname)) {
        return middlewareErrorResponder(context.request, 400)
    }
    return next()
}
