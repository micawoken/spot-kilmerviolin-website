/**
 * /pages/api/v1/files.ts
 *
 * List and add files in the R2 file store
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

import type { APIRoute } from "astro"
import { addFile, deriveFileKey, listFiles } from "../../../lib/api/files"
import { parseCropFromForm } from "../../../lib/api/images"
import { maxUploadBytes, R2CapacityError } from "../../../lib/api/r2"
import { auth_check } from "../../../lib/public/authservice"
import { parseAPIRequest } from "../../../lib/api/common"
import { constructResponse, constructResponseErrorHook } from "../../../lib/api/http"

/**
 * GET /api/v1/files
 * Returns a list of file keys, or a list of full file metadata records if the "full" meta param is set to true
 *
 * Permissions required: none (authenticated identity)
 *
 * Meta: optional
 * Meta fields:
 * - full: {boolean} if true, returns full FileMeta records; if false or not provided, returns only file keys
 *
 * Body: none
 *
 * @param context - the Astro API context
 * @returns either a list of keys or the full metadata records
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    // parse api request; meta is optional, parsed so the "full" field is honored
    const api_request = await parseAPIRequest(request, [])
    if (api_request instanceof Error) {
        return constructResponse(request, null, 400, api_request.message)
    }
    try {
        const data = await listFiles(context.locals.cfContext)
        switch (api_request.meta?.full) {
            case true:
                return constructResponse(request, data, 200)
            case false:
            case undefined:
                // return file keys only
                return constructResponse(
                    request,
                    data.map((file) => file.key),
                    200
                )
            default:
                return constructResponse(request, null, 400, "Invalid value for meta field 'full': must be a boolean")
        }
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}

/**
 * POST /api/v1/files
 * Adds a new file to the store, optimizing it when it is an image
 *
 * Permissions required: none (authenticated identity)
 *
 * Meta: none
 * Body: required; multipart/form-data with a "file" part and an optional "name" field. Unlike the JSON
 *   entity endpoints, files are binary, so this endpoint accepts a multipart upload rather than a
 *   single-item JSON array. The object key is derived from "name" (or the upload's filename).
 *
 * @param context - the Astro API context
 * @returns the created file's metadata, or an error message
 */
export const POST: APIRoute = async (context): Promise<Response> => {
    const { request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    // parse the multipart upload
    let form: FormData
    try {
        form = await request.formData()
    } catch {
        return constructResponse(
            request,
            null,
            400,
            "Invalid request body: expected multipart/form-data with a 'file' part"
        )
    }
    const file = form.get("file")
    if (!(file instanceof File)) {
        return constructResponse(request, null, 400, "Invalid request body: missing 'file' part")
    }
    // reject oversized uploads before reading the body into memory
    if (file.size > maxUploadBytes()) {
        return constructResponse(request, null, 413)
    }
    const provided_name = form.get("name")
    const raw_name = typeof provided_name === "string" && provided_name.trim() !== "" ? provided_name : file.name
    const key = deriveFileKey(raw_name)
    if (key === "") {
        return constructResponse(
            request,
            null,
            400,
            "Invalid file name: no usable characters remain after sanitization"
        )
    }
    const content_type = file.type || "application/octet-stream"
    const uploader = locals.identity ? String(locals.identity.id) : null
    // optional crop instruction carried in the multipart fields (absent = centered portrait)
    const crop = parseCropFromForm(form)
    if (crop instanceof Error) {
        return constructResponse(request, null, 400, crop.message)
    }
    try {
        // reading the upload's bytes can throw if the client aborts mid-stream; keep it inside the try
        const bytes = await file.arrayBuffer()
        const meta = await addFile(context.locals.cfContext, key, bytes, content_type, uploader, crop)
        return constructResponse(request, meta, 201, undefined, {
            Location: `/api/v1/files/${key}`
        })
    } catch (error) {
        if (error instanceof R2CapacityError) {
            return constructResponse(request, null, 507)
        }
        if (error instanceof Error && error.message.includes("already exists")) {
            return constructResponse(request, null, 409, `Invalid request: a file already exists at key "${key}"`)
        }
        console.error(error)
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}
