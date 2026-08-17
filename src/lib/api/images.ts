/**
 * lib/api/images.ts
 *
 * Connects file uploads with Cloudflare image optimization (the IMAGES binding)
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

import { env } from "cloudflare:workers"
import { isActiveRequestDev } from "./environment.ts"

/**
 * The two canonical output shapes
 */
export const CANON_PORTRAIT = { width: 1280, height: 1600 } as const
export const CANON_LANDSCAPE = { width: 1600, height: 1280 } as const

/**
 * The sharpen strength applied to the final transform when a source is smaller than the canonical canvas
 * and must be enlarged
 */
export const UPSCALE_SHARPEN = 1

/**
 * Which canonical shape an image is cropped to
 */
export type CropAspect = "portrait" | "landscape"

/**
 * An optional instruction describing how to crop a source image into one of the canonical shapes.
 *
 * @property {CropAspect} aspect - the canonical shape to crop to
 * @property {number} [x] - normalized (0..1) left of the crop region, or the focal-point x when no region
 * @property {number} [y] - normalized (0..1) top of the crop region, or the focal-point y when no region
 * @property {number} [w] - normalized (0..1) width of the crop region; present (with h) selects the region path
 * @property {number} [h] - normalized (0..1) height of the crop region; present (with w) selects the region path
 */
export interface CropInstruction {
    aspect: CropAspect
    x?: number
    y?: number
    w?: number
    h?: number
}

/**
 * The result of optimizing (or passing through) a file's bytes
 *
 * @property {ArrayBuffer} bytes - the bytes to store
 * @property {string} content_type - the MIME type of the bytes to store
 * @property {number | null} width - the image width in pixels, or null if not a measurable image
 * @property {number | null} height - the image height in pixels, or null if not a measurable image
 * @property {boolean} optimized - whether the bytes were re-encoded (false means passed through)
 */
export interface OptimizeResult {
    bytes: ArrayBuffer
    content_type: string
    width: number | null
    height: number | null
    optimized: boolean
}

/**
 * Whether a content type is a raster image this module will re-encode
 *
 * SVG is intentionally excluded: it is already compact and rasterizing it would discard its
 * scalability, so it is stored as-is.
 *
 * @param {string} content_type - the MIME type to test
 * @returns {boolean} true if the type should be run through optimizeImage's re-encoding path
 */
export function isOptimizableImage(content_type: string): boolean {
    const type = content_type.split(";")[0].trim().toLowerCase()
    return ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(type)
}

/**
 * Resolves the canonical output shape for a crop instruction (defaulting to portrait when absent).
 */
function _targetFor(crop?: CropInstruction): { width: number; height: number } {
    return (crop?.aspect ?? "portrait") === "landscape" ? CANON_LANDSCAPE : CANON_PORTRAIT
}

/**
 * Clamps a value into the [0, 1] range.
 */
function _clamp01(value: number): number {
    return Math.min(1, Math.max(0, value))
}

/**
 * Parses (and validates) a CropInstruction from an upload's multipart form fields
 *
 *
 * @param {FormData} form - the parsed multipart form
 * @returns {CropInstruction | Error | undefined} the instruction, undefined when no crop_aspect is given
 *   (the caller then applies the default centered portrait crop), or an Error describing invalid input
 */
export function parseCropFromForm(form: FormData): CropInstruction | Error | undefined {
    const aspect = form.get("crop_aspect")
    if (aspect === null) {
        return undefined
    }
    if (aspect !== "portrait" && aspect !== "landscape") {
        return new Error("Invalid crop_aspect: expected 'portrait' or 'landscape'")
    }
    const read = (key: string): number | undefined | Error => {
        const raw = form.get(key)
        if (raw === null) {
            return undefined
        }
        const value = Number(raw)
        if (!Number.isFinite(value) || value < 0 || value > 1) {
            return new Error(`Invalid ${key}: expected a number in [0, 1]`)
        }
        return value
    }
    const fields: Record<string, number | undefined> = {}
    for (const key of ["crop_x", "crop_y", "crop_w", "crop_h"]) {
        const value = read(key)
        if (value instanceof Error) {
            return value
        }
        fields[key] = value
    }
    const present = Object.values(fields).filter((value) => value !== undefined).length
    if (present !== 0 && present !== 4) {
        return new Error("Crop region requires all of crop_x, crop_y, crop_w, crop_h (or none)")
    }
    return { aspect, x: fields.crop_x, y: fields.crop_y, w: fields.crop_w, h: fields.crop_h }
}

/**
 * Converts a byte buffer into a readable stream for the IMAGES binding
 */
function _toStream(bytes: ArrayBuffer | Uint8Array): ReadableStream<Uint8Array> {
    return new Response(bytes as BodyInit).body as ReadableStream<Uint8Array>
}

/**
 * Optimizes an image by cropping and scaling it into one canonical shape, or passes non-images through
 *
 *
 * @param {ArrayBuffer | Uint8Array} bytes - the original file bytes
 * @param {string} content_type - the original MIME type
 * @param {CropInstruction} [crop] - how to crop into a canonical shape; absent = centered portrait
 * @returns {Promise<OptimizeResult>} the bytes to store, their content type, the canonical dimensions, and whether re-encoded
 * @throws {Error} if the IMAGES binding fails to process a type that isOptimizableImage accepted
 */
export async function optimizeImage(
    bytes: ArrayBuffer | Uint8Array,
    content_type: string,
    crop?: CropInstruction
): Promise<OptimizeResult> {
    if (!isOptimizableImage(content_type)) {
        // non-images and SVG are stored verbatim
        const passthrough = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes
        return { bytes: passthrough, content_type, width: null, height: null, optimized: false }
    }

    // IMPORTANT - local development limitation: the IMAGES binding's transform pipeline DOES NOT WORK under
    // local emulation (`astro dev` / local `wrangler dev`); skip the transform entirely in development and
    // store the original bytes unchanged

    if (isActiveRequestDev()) {
        let width: number | null = null
        let height: number | null = null
        try {
            const info = await env.IMAGES.info(_toStream(bytes))
            if ("width" in info && "height" in info && info.width && info.height) {
                width = info.width
                height = info.height
            }
        } catch {
            // dimensions are best-effort; the original bytes are stored regardless
        }
        const passthrough = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes
        return { bytes: passthrough, content_type, width, height, optimized: false }
    }

    const target = _targetFor(crop)
    // read the source dimensions to (a) decide whether the canvas is an enlargement (so we sharpen) and
    // (b) convert a normalized region into the pixel rectangle the trim transform expects
    let source_width: number | null = null
    let source_height: number | null = null
    try {
        const info = await env.IMAGES.info(_toStream(bytes))
        if ("width" in info && "height" in info && info.width && info.height) {
            source_width = info.width
            source_height = info.height
        }
    } catch {
        // dimensions are best-effort; without them we fall back to a centered/focal cover (no trim, no sharpen)
    }

    const transformer = env.IMAGES.input(_toStream(bytes))

    // region path: an exact normalized rectangle, expressed as the number of pixels to cut off each edge
    // (trim's left/top/right/bottom form)
    const has_region = crop?.x !== undefined && crop?.y !== undefined && crop?.w !== undefined && crop?.h !== undefined
    let trim: { left: number; top: number; right: number; bottom: number } | undefined
    let region_px: { width: number; height: number } | null = null
    if (has_region && source_width !== null && source_height !== null) {
        const rx = _clamp01(crop!.x!)
        const ry = _clamp01(crop!.y!)
        const rw = Math.min(_clamp01(crop!.w!), 1 - rx)
        const rh = Math.min(_clamp01(crop!.h!), 1 - ry)
        let left = Math.round(rx * source_width)
        let top = Math.round(ry * source_height)
        let right = Math.round((1 - rx - rw) * source_width)
        let bottom = Math.round((1 - ry - rh) * source_height)
        // never cut the whole image away: keep at least 1px in each axis after the cuts
        left = Math.max(0, Math.min(left, source_width - 1))
        right = Math.max(0, Math.min(right, source_width - 1 - left))
        top = Math.max(0, Math.min(top, source_height - 1))
        bottom = Math.max(0, Math.min(bottom, source_height - 1 - top))
        trim = { left, top, right, bottom }
        region_px = { width: source_width - left - right, height: source_height - top - bottom }
    }

    // the final cover scale forces the exact canonical canvas, cropping whatever the gravity does not keep.
    // With a region the trim has already isolated the aspect-correct rectangle, so a centered cover just
    // scales it; without one we bias toward the focal point (or center).
    let gravity: "center" | { x: number; y: number; mode: "box-center" }
    if (!trim && crop?.x !== undefined && crop?.y !== undefined) {
        // focal-point crop (no exact region, or dimensions unknown): bias the cover crop toward the point
        gravity = { x: _clamp01(crop.x), y: _clamp01(crop.y), mode: "box-center" }
    } else {
        gravity = "center"
    }
    // sharpen only when enlarging (downscales do not benefit and it adds filesize). What gets enlarged is
    // the kept rectangle (the region when cropping, else the whole source), compared to the canvas.
    const effective =
        region_px ??
        (source_width !== null && source_height !== null ? { width: source_width, height: source_height } : null)
    const upscaling = effective !== null && (effective.width < target.width || effective.height < target.height)

    // re-encode in one transform; GIFs are flattened to a single frame so output dimensions stay predictable
    const result = await transformer
        .transform({
            ...(trim ? { trim } : {}),
            width: target.width,
            height: target.height,
            fit: "cover",
            gravity,
            ...(upscaling ? { sharpen: UPSCALE_SHARPEN } : {})
        })
        .output({
            format: env.TARGET_IMAGE_FORMAT,
            quality: Number(env.TARGET_IMAGE_QUALITY),
            anim: false
        })
    const out_type = result.contentType()
    const out_bytes = await new Response(result.image()).arrayBuffer()
    // output dimensions are fixed by the canonical canvas regardless of whether info() succeeded
    return { bytes: out_bytes, content_type: out_type, width: target.width, height: target.height, optimized: true }
}
