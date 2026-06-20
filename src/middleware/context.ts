/**
 * middleware/context.ts
 *
 * Stores the request URL isolate-wide so it can be used by callers/modules without the Astro context
 *
 */

import type { MiddlewareHandler } from "astro"
import { setActiveRequestUrl } from "../lib/api/environment"

export const requestContext: MiddlewareHandler = async (context, next) => {
    setActiveRequestUrl(context.request.url)
    return next()
}
