/**
 * middleware/index.ts
 *
 * Supplies an onRequest function as the entry point to custom functions for the Astro middleware
 *
 * See https://docs.astro.build/en/guides/middleware/
 *
 */

import { sequence } from "astro/middleware"
import { requestContext } from "./context"
import { preflight } from "./preflight"
import { identity } from "./identity"
import { rateLimit } from "./ratelimit"
import { securityHeaders } from "./headers"

// securityHeaders runs first so it wraps the chain and can stamp its headers onto the final response —
// including the auth error pages identity returns — for admin routes.
export const onRequest = sequence(securityHeaders, requestContext, preflight, identity, rateLimit)
