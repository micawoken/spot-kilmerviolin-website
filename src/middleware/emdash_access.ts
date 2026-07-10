/**
 * middleware/emdash_access.ts
 *
 * Authorizes /_emdash requests against the cms_editor permission. Runs after identity.ts, which
 * constructs context.locals.identity for this path but performs no _emdash-specific authorization itself
 * (that decision belongs to the service being requested — for /admin and /api that's the page/route
 * itself; EmDash is a third-party integration whose routes this app doesn't own, so this middleware plays
 * that role instead). EmDash's own Cloudflare Access adapter still authenticates the request separately;
 * this is an additional in-app authorization gate on top of it, not a replacement.
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
import { middlewareErrorResponder } from "../lib/api/http"
import { authEnabled } from "../lib/api/environment"
import { satisfiesAccess, comment_401, comment_403 } from "../lib/api/page_auth"

export const emdashAccess: MiddlewareHandler = async (context, next) => {
    const url = new URL(context.request.url)
    const path_components = url.pathname.split("/").filter((component) => component.length > 0)
    if (path_components[0] !== "_emdash") {
        return next()
    }
    // local development bypasses authentication entirely (no identity is constructed by identity.ts),
    // matching every other admin surface
    if (!authEnabled(context.request)) {
        return next()
    }
    // staging 404s /_emdash upstream in identity.ts before this middleware ever sees it
    const identity = context.locals.identity
    if (identity === undefined) {
        // identity.ts already rejects an unusable credential before this point, so this is unreachable in
        // practice; kept as a fail-closed guard
        return middlewareErrorResponder(context.request, 401, comment_401)
    }
    if (!satisfiesAccess({ kind: "permission", permissions: ["cms_editor"] }, identity)) {
        return middlewareErrorResponder(context.request, 403, comment_403, identity.email)
    }
    return next()
}
