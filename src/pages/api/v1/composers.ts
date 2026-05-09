/**
 * pages/api/v1/composers.ts
 * 
 * Returns a list of composer records
 * 
 */

import type { APIRoute } from "astro"
import { listComposers } from "../../../lib/api/database"

export const get: APIRoute = async (context): Promise<Response> => {
    const { params, request } = context
    // 
}