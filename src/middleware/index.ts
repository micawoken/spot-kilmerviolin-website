/**
 * src/middleware/index.ts
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

export const onRequest = sequence(requestContext, preflight, identity, rateLimit)