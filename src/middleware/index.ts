/**
 * middleware/index.ts
 *
 * Supplies an onRequest function as the entry point to custom functions for the Astro middleware
 *
 * See https://docs.astro.build/en/guides/middleware/
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

import { sequence } from "astro/middleware"
import { requestContext } from "./context"
import { preflight } from "./preflight"
import { identity } from "./identity"
import { emdashAccess } from "./emdash_access"
import { rateLimit } from "./ratelimit"
import { securityHeaders } from "./headers"

// securityHeaders runs first so it wraps the chain and can stamp its headers onto the final response —
// including the auth error pages identity returns — for admin routes. emdashAccess runs right after
// identity so it can authorize against the identity that identity.ts just constructed.
export const onRequest = sequence(securityHeaders, requestContext, preflight, identity, emdashAccess, rateLimit)
