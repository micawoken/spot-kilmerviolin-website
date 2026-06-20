/**
 * /pages/api/v1/files/[id].ts
 *
 * Read, replace, and delete a single file in the R2 file store. The [id] segment is the file key.
 *
 */

import type { APIRoute } from "astro"
import { deleteFile, deriveFileKey, readFileBytes, replaceFile } from "../../../../lib/api/files"
import { parseCropFromForm } from "../../../../lib/api/images"
import { MAX_UPLOAD_BYTES, R2CapacityError } from "../../../../lib/api/r2"
import { auth_check } from "../../../../lib/public/authservice"
import { constructResponse, constructResponseErrorHook, constructFileResponse } from "../../../../lib/api/http"
import { env } from "cloudflare:workers"

/**
 * GET /api/v1/files/{id}
 * Returns the raw bytes of a file (not a JSON envelope), with its stored content type
 *
 * Permissions required: none (authenticated identity). All file routes require authentication; admin
 * pages are the only consumers of a file's API address, and public pages are statically generated.
 *
 * @param context - the Astro API context
 * @returns the file bytes, or a JSON error
 */
export const GET: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    // validate the key before touching the (metered) store
    const get_key = deriveFileKey(params.id!)
    if (get_key === "") {
        return constructResponse(request, null, 400, "Invalid file key")
    }
    try {
        const data = await readFileBytes(get_key)
        if (data === null) {
            return constructResponse(request, null, 404)
        }
        return constructFileResponse(request, data.bytes, data.content_type, env.CACHE_API_TTL_LONG)
    } catch (error) {
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}

/**
 * PUT /api/v1/files/{id}
 * Replaces an existing file's bytes, optimizing it when it is an image
 *
 * Permissions required: none (authenticated identity)
 *
 * Body: required; multipart/form-data with a "file" part (see POST /api/v1/files)
 *
 * @param context - the Astro API context
 * @returns 204 on success, or a JSON error
 */
export const PUT: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
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
    if (file.size > MAX_UPLOAD_BYTES) {
        return constructResponse(request, null, 413)
    }
    // the key is fixed by the URL; the upload's own filename is ignored on replace
    const key = deriveFileKey(params.id!)
    if (key === "") {
        return constructResponse(request, null, 400, "Invalid file key")
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
        await replaceFile(context.locals.cfContext, key, bytes, content_type, uploader, crop)
        return constructResponse(request, null, 204)
    } catch (error) {
        if (error instanceof R2CapacityError) {
            return constructResponse(request, null, 507)
        }
        if (error instanceof Error && error.message.includes("No file exists")) {
            return constructResponse(request, null, 404)
        }
        console.error(error)
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}

/**
 * DELETE /api/v1/files/{id}
 * Deletes a file
 *
 * Permissions required: none (authenticated identity)
 *
 * @param context - the Astro API context
 * @returns 204 on success, or a JSON error
 */
export const DELETE: APIRoute = async (context): Promise<Response> => {
    const { params, request, locals } = context
    // validate identity
    const auth_response = auth_check(request, locals.identity, [], false)
    if (auth_response !== null) {
        return auth_response
    }
    // validate the key before touching the (metered) store
    const key = deriveFileKey(params.id!)
    if (key === "") {
        return constructResponse(request, null, 400, "Invalid file key")
    }
    try {
        await deleteFile(context.locals.cfContext, key)
        return constructResponse(request, null, 204)
    } catch (error) {
        console.error(error)
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}
