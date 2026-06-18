/**
 * lib/api/images.ts
 *
 * Connects file uploads with Cloudflare image optimization (the IMAGES binding)
 *
 * When a file destined for the R2 bucket is a raster image, files.ts runs it through optimizeImage to
 * normalize it to a single efficient variant (a width-capped WebP) before storing it; only the
 * optimized variant is kept. Non-images, and images we deliberately leave alone (SVG), pass through
 * unchanged. The build step that publishes src/files (see the files-manifest integration) targets the
 * same parameters exported here so bundled assets and uploaded assets are optimized consistently.
 *
 * Dependent on the IMAGES binding (env.IMAGES).
 */

import { env } from "cloudflare:workers"

/**
 * The maximum width, in pixels, that optimized images are scaled down to (never scaled up)
 */
export const MAX_IMAGE_WIDTH = 1600

/**
 * The format every optimizable image is re-encoded to
 */
export const TARGET_FORMAT = "image/webp"

/**
 * The encode quality (0-100) used for the target format
 */
export const TARGET_QUALITY = 82

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
 * Converts a byte buffer into a readable stream for the IMAGES binding
 */
function _toStream(bytes: ArrayBuffer | Uint8Array): ReadableStream<Uint8Array> {
    return new Response(bytes as BodyInit).body as ReadableStream<Uint8Array>
}

/**
 * Optimizes an image into a single width-capped WebP variant, or passes non-images through unchanged
 *
 * For optimizable content types the bytes are re-encoded with the IMAGES binding (scaled down to at
 * most MAX_IMAGE_WIDTH and converted to TARGET_FORMAT); the final dimensions are read back so callers
 * can record them. For any other content type the input is returned untouched with optimized = false.
 *
 * @param {ArrayBuffer | Uint8Array} bytes - the original file bytes
 * @param {string} content_type - the original MIME type
 * @returns {Promise<OptimizeResult>} the bytes to store, their content type, dimensions, and whether re-encoded
 * @throws {Error} if the IMAGES binding fails to process a type that isOptimizableImage accepted
 */
export async function optimizeImage(bytes: ArrayBuffer | Uint8Array, content_type: string): Promise<OptimizeResult> {
    if (!isOptimizableImage(content_type)) {
        // non-images and SVG are stored verbatim
        const passthrough = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes
        return { bytes: passthrough, content_type, width: null, height: null, optimized: false }
    }
    // read the source dimensions so we can cap the width without ever enlarging a smaller image
    // (the IMAGES "scale-down" fit upscales under local emulation, so the bound is computed explicitly)
    let target_width = MAX_IMAGE_WIDTH
    let width: number | null = null
    let height: number | null = null
    try {
        const info = await env.IMAGES.info(_toStream(bytes))
        if ("width" in info && "height" in info && info.width && info.height) {
            target_width = Math.min(MAX_IMAGE_WIDTH, info.width)
            width = target_width
            // preserve aspect ratio; the transform applies the same scaling to the height
            height = Math.round(info.height * (target_width / info.width))
        }
    } catch {
        // dimensions are best-effort metadata; fall back to the max-width cap if info fails
    }
    // re-encode to a width-capped variant in the target format
    const result = await env.IMAGES
        .input(_toStream(bytes))
        .transform({ width: target_width })
        .output({ format: TARGET_FORMAT, quality: TARGET_QUALITY })
    const out_type = result.contentType()
    const out_bytes = await new Response(result.image()).arrayBuffer()
    return { bytes: out_bytes, content_type: out_type, width, height, optimized: true }
}
