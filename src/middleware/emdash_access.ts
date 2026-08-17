/**
 * middleware/emdash_access.ts
 *
 * Authorizes access to EmDash based on user roles and path
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
import { authEnabled } from "../lib/api/environment"
import { satisfiesAccess, comment_401, comment_403, type AdminAccess } from "../lib/api/page_auth"
import { isDesignSystemRequest } from "../lib/api/emdash_design_access"

/** Full CMS access */
const CMS_ACCESS: AdminAccess = { kind: "permission", permissions: ["cms_editor"] }

/** Design-system access */
const DESIGN_ACCESS: AdminAccess = { kind: "permission", permissions: ["design_editor"] }

export const emdashAccess: MiddlewareHandler = async (context, next) => {
    const url = new URL(context.request.url)
    const path_components = url.pathname.split("/").filter((component) => component.length > 0)
    if (path_components[0] !== "_emdash") {
        return next()
    }
    // local development bypasses authentication entirely (no identity is constructed by identity.ts)
    if (!authEnabled(context.request)) {
        return next()
    }

    if (context.locals.emdashServiceAuth === true) {
        return next()
    }
    // staging 404s /_emdash upstream in identity.ts before this middleware ever sees it
    const identity = context.locals.identity
    if (identity === undefined) {
        // identity.ts already rejects an unusable credential before this point, so this is unreachable in
        // practice; kept as a fail-closed guard
        return middlewareErrorResponder(context.request, 401, comment_401)
    }
    // cms_editor (and any administrator) reaches the whole CMS
    if (satisfiesAccess(CMS_ACCESS, identity)) {
        return next()
    }
    // a design_editor without cms_editor reaches ONLY what the design system needs
    if (
        satisfiesAccess(DESIGN_ACCESS, identity) &&
        isDesignSystemRequest(context.request.method, path_components.slice(1))
    ) {
        return next()
    }
    return middlewareErrorResponder(context.request, 403, comment_403, identity.email)
}
