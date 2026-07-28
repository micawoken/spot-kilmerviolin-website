/**
 * /pages/api/v1/files/[id].ts
 *
 * Read, replace, and delete a single file in the R2 file store. The [id] segment is the file key.
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

import type { APIContext, APIRoute } from "astro"
import {
    deleteFile,
    deriveFileKey,
    getFileMeta,
    normalizeUploadContentType,
    readFileBytes,
    replaceFile,
    updateFileAlt
} from "../../../../lib/api/files"
import { parseCropFromForm } from "../../../../lib/api/images"
import { maxUploadBytes, R2CapacityError } from "../../../../lib/api/r2"
import { auth_check } from "../../../../lib/public/authservice"
import {
    constructResponse,
    constructResponseErrorHook,
    constructFileResponse,
    INLINE_SAFE_CONTENT_TYPES
} from "../../../../lib/api/http"
import { validateAltText } from "../../../../lib/api/validation"
import { authEnabled } from "../../../../lib/api/environment"
import { env } from "cloudflare:workers"

/**
 * Refuses a destructive operation on a file the caller did not upload.
 *
 * PUT and DELETE were gated on nothing but "any active contributor", so one contributor could replace the
 * bytes behind another's published entity-page image, or delete an object a live page references. The
 * ownership metadata to prevent that already existed and was already consulted on the read side — PATCH
 * /api/v1/contributors/[id] checks `meta.uploader` before letting a non-admin attach an uploaded file to
 * their own record — just not on the routes that destroy something.
 *
 * Administrators bypass it, matching that endpoint. A file with no recorded uploader (predating the
 * metadata, or written by a migration) is treated as unowned and left to administrators only, which is
 * the fail-closed reading.
 *
 * @param {APIContext} context - the Astro API context
 * @param {string} key - the file key being modified
 * @returns {Promise<Response | null>} a 403/404 response to return, or null when the caller may proceed
 */
async function denyUnlessFileOwner(context: APIContext, key: string): Promise<Response | null> {
    const { request, locals } = context
    // local development constructs no identity at all; ownership cannot be evaluated and auth is bypassed
    if (!authEnabled(request) || locals.identity?.admin === true) {
        return null
    }
    const meta = await getFileMeta(context.locals.cfContext, key)
    if (meta === null) {
        return constructResponse(request, null, 404)
    }
    if (meta.uploader === null || meta.uploader !== String(locals.identity?.id)) {
        return constructResponse(request, null, 403, "This file was not uploaded by you")
    }
    return null
}

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
 * Replaces an existing file's bytes, optimizing it when it is an image; or, when the "file" part is
 * omitted, updates only the file's stored alt text (the admin "modify alt text" affordance)
 *
 * Permissions required: none, but the caller must be the file's uploader or an administrator
 * (see denyUnlessFileOwner)
 *
 * Body: required; multipart/form-data. Either a "file" part plus a required "alt" part (1-256 chars,
 *   see POST /api/v1/files), or an "alt" part alone to update alt text without touching the file's bytes.
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
            "Invalid request body: expected multipart/form-data with a 'file' and/or 'alt' part"
        )
    }
    // the key is fixed by the URL; the upload's own filename (if any) is ignored on replace
    const key = deriveFileKey(params.id!)
    if (key === "") {
        return constructResponse(request, null, 400, "Invalid file key")
    }
    // replacing an object's bytes silently changes whatever page references it, so it is owner-or-admin
    const ownership_denied = await denyUnlessFileOwner(context, key)
    if (ownership_denied !== null) {
        return ownership_denied
    }
    const provided_alt = form.get("alt")
    const alt = typeof provided_alt === "string" ? provided_alt.trim() : ""
    const alt_error = validateAltText(alt)
    if (alt_error !== null) {
        return constructResponse(request, null, 400, alt_error)
    }
    const file = form.get("file")
    if (file === null) {
        // alt-only update: no bytes to rewrite
        try {
            await updateFileAlt(context.locals.cfContext, key, alt)
            return constructResponse(request, null, 204)
        } catch (error) {
            if (error instanceof Error && error.message.includes("No file exists")) {
                return constructResponse(request, null, 404)
            }
            console.error(error)
            return constructResponseErrorHook(request, error, 500, "Unknown error")
        }
    }
    if (!(file instanceof File)) {
        return constructResponse(request, null, 400, "Invalid request body: 'file' part is not a file")
    }
    // reject oversized uploads before reading the body into memory
    if (file.size > maxUploadBytes()) {
        return constructResponse(request, null, 413)
    }
    // same allowlist as POST: a replace writes to the same public-bucket object, so it cannot be a way in
    // for a type the create route refuses
    const content_type = normalizeUploadContentType(file.type)
    if (content_type === null) {
        return constructResponse(
            request,
            null,
            415,
            `Unsupported file type: uploads must be one of ${INLINE_SAFE_CONTENT_TYPES.join(", ")}`
        )
    }
    const uploader = locals.identity ? String(locals.identity.id) : null
    // optional crop instruction carried in the multipart fields (absent = centered portrait)
    const crop = parseCropFromForm(form)
    if (crop instanceof Error) {
        return constructResponse(request, null, 400, crop.message)
    }
    try {
        // reading the upload's bytes can throw if the client aborts mid-stream; keep it inside the try
        const bytes = await file.arrayBuffer()
        await replaceFile(context.locals.cfContext, key, bytes, content_type, uploader, alt, crop)
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
 * Permissions required: none, but the caller must be the file's uploader or an administrator
 * (see denyUnlessFileOwner)
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
    const ownership_denied = await denyUnlessFileOwner(context, key)
    if (ownership_denied !== null) {
        return ownership_denied
    }
    try {
        await deleteFile(context.locals.cfContext, key)
        return constructResponse(request, null, 204)
    } catch (error) {
        console.error(error)
        return constructResponseErrorHook(request, error, 500, "Unknown error")
    }
}
