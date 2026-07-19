/**
 * middleware/preflight.ts
 *
 * Supplies a middleware function to detect CORS preflight requests and respond to them
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
import { constructPreflightResponse, constructOptionsResponse } from "../lib/api/http"

export const preflight: MiddlewareHandler = async (context, next) => {
    const { request } = context
    if (
        request.method === "OPTIONS" &&
        request.headers.has("Origin") &&
        request.headers.has("Access-Control-Request-Method")
    ) {
        // CORS preflight: the response policy (API/admin/closed) is selected in http.ts by route
        return constructPreflightResponse(request)
    } else if (request.method === "OPTIONS") {
        // the request is OPTIONS, but not CORS preflight
        return constructOptionsResponse(request)
    }
    // the request is not OPTIONS
    return next()
}
