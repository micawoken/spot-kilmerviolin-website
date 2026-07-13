/**
 * middleware/emdash_access.ts
 *
 * Authorizes /_emdash requests. Runs after identity.ts, which constructs context.locals.identity for this
 * path but performs no _emdash-specific authorization itself (that decision belongs to the service being
 * requested — for /admin and /api that's the page/route itself; EmDash is a third-party integration whose
 * routes this app doesn't own, so this middleware plays that role instead). EmDash's own Cloudflare Access
 * adapter still authenticates the request separately; this is an additional in-app authorization gate on
 * top of it, not a replacement.
 *
 * Two permissions reach /_emdash, and they are NOT equals:
 *
 *   cms_editor    the whole CMS — the admin UI, every collection, settings, media, users.
 *   design_editor ONLY the paths the visual design system calls (lib/api/emdash_design_access.ts).
 *
 * This gate is a complete chokepoint: EmDash is mounted INSIDE this worker, so every request to it passes
 * through this middleware. It is also the only thing bounding a design_editor — see that module's header
 * before changing an allowlist rule.
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
import { satisfiesAccess, comment_401, comment_403, type AdminAccess } from "../lib/api/page_auth"
import { isDesignSystemRequest } from "../lib/api/emdash_design_access"

/** Full CMS access. An administrator also satisfies this (satisfiesAccess approves admins outright). */
const CMS_ACCESS: AdminAccess = { kind: "permission", permissions: ["cms_editor"] }

/** Design-system access — admitted only to the paths in lib/api/emdash_design_access.ts. */
const DESIGN_ACCESS: AdminAccess = { kind: "permission", permissions: ["design_editor"] }

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
    // service credentials (EmDash API token / Access service token) were validated and delegated by
    // identity.ts; EmDash's own auth layer authorizes them (Bearer validation with per-token scopes, or
    // the Access adapter's role mapping), so the cms_editor page gate does not apply
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
    // a design_editor without cms_editor reaches ONLY what the design system calls; everything else in the
    // CMS — the admin UI, other collections, schema writes, settings, users — is denied
    if (
        satisfiesAccess(DESIGN_ACCESS, identity) &&
        isDesignSystemRequest(context.request.method, path_components.slice(1))
    ) {
        return next()
    }
    return middlewareErrorResponder(context.request, 403, comment_403, identity.email)
}
