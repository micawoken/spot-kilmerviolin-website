/**
 * middleware/context.ts
 *
 * Stores the request URL isolate-wide so it can be used by callers/modules without the Astro context
 *
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
 *
 * This license is also subject to additional terms as specified in the README.md.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import type { MiddlewareHandler } from "astro"
import { setActiveRequestUrl } from "../lib/api/environment"

export const requestContext: MiddlewareHandler = async (context, next) => {
    setActiveRequestUrl(context.request.url)
    return next()
}
