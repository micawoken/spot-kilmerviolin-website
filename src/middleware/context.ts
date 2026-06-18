/**
 * src/middleware/context.ts
 *
 * Records per-request context that modules outside the Astro request lifecycle need to read.
 * Currently this captures the request URL so the D1 write gate (lib/api/d1.ts, via dbWriteEnabled)
 * can resolve the runtime environment without the Request being threaded through the database layer.
 *
 */

import type { MiddlewareHandler } from "astro"
import { setActiveRequestUrl } from "../lib/api/environment"

export const requestContext: MiddlewareHandler = async (context, next) => {
    setActiveRequestUrl(context.request.url)
    return next()
}
