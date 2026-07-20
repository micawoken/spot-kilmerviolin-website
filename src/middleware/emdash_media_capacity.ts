/**
 * middleware/emdash_media_capacity.ts
 *
 * Rejects EmDash CMS media uploads that would push combined R2 usage past the shared storage ceiling,
 * before the write reaches EmDash's own upload handler. That handler is vendored code we do not own
 * (node_modules/emdash/src/astro/routes/api/media.ts) and its R2Storage adapter performs no capacity
 * check of its own (node_modules/@emdash-cms/cloudflare/src/storage/r2.ts) — only a per-file size cap via
 * emdash.config.maxUploadSize. EMDASH_MEDIA is a second bucket in the same Cloudflare account as R2_FILES,
 * so it draws against the same account-wide free-plan storage ceiling, not a separate one; see r2.ts's
 * MAX_R2_STORAGE_BYTES for the combined-usage rationale and getStorageUsage/addFile/replaceFile in
 * files.ts for the R2_FILES-side half of this same check.
 *
 * The check is best-effort, mirroring EmDash's own per-file pre-check (media.ts's "Best-effort size check
 * before buffering the full multipart body"): it reads Content-Length rather than parsing the multipart
 * body itself, since middleware cannot cheaply re-buffer and replay the request body to EmDash's handler
 * afterward. A missing/unparseable Content-Length lets the request through uncapped by this guard — EmDash's
 * own per-file maxUploadSize cap still bounds a single upload's damage in that case.
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

import type { MiddlewareHandler } from "astro"
import { listFiles } from "../lib/api/files"
import { emdashMediaUsageBytes, MAX_R2_STORAGE_BYTES } from "../lib/api/r2"

/** EmDash's own media-create endpoint (POST). Sub-paths (file reads, providers, upload-url) are untouched. */
const MEDIA_UPLOAD_PATH = "/_emdash/api/media"

export const emdashMediaCapacity: MiddlewareHandler = async (context, next) => {
    const url = new URL(context.request.url)
    if (context.request.method !== "POST" || url.pathname !== MEDIA_UPLOAD_PATH) {
        return next()
    }

    const contentLength = Number(context.request.headers.get("Content-Length"))
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
        return next()
    }

    const [files, mediaUsed] = await Promise.all([listFiles(context.locals.cfContext), emdashMediaUsageBytes()])
    const filesUsed = files.reduce((total, file) => total + file.size, 0)

    if (filesUsed + mediaUsed + contentLength > MAX_R2_STORAGE_BYTES) {
        return Response.json(
            {
                error: {
                    code: "STORAGE_CAPACITY_EXCEEDED",
                    message: "Storage capacity exceeded"
                }
            },
            { status: 507, headers: { "Cache-Control": "private, no-store" } }
        )
    }

    return next()
}
