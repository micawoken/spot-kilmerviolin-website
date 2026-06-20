/**
 * scripts/image_crop.ts
 *
 * Shared types and constants for the image crop interface. The interactive UI itself lives in the
 * components/ImageCrop.astro component (its markup is declared statically there and wired by its own
 * scoped script); this module only holds the pieces that are shared across the boundary — the
 * CropSelection shape the connector forwards as the upload's crop_* form fields, and the canonical output
 * dimensions the client uses to decide when a (cropped) region is small enough to be upscaled.
 *
 * The canonical dimensions mirror CANON_PORTRAIT / CANON_LANDSCAPE in lib/api/images.ts — keep them in
 * sync. They live here (not imported from the server module) because that module imports
 * "cloudflare:workers", which cannot be pulled into a browser bundle.
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

/** The crop region selected on the add/replace pages, normalized to the source image (0..1). */
export interface CropSelection {
    aspect: "portrait" | "landscape"
    x: number
    y: number
    w: number
    h: number
}

/** The two canonical output shapes, in pixels, keyed by orientation (mirrors lib/api/images.ts). */
export const CLIENT_CANON: Record<CropSelection["aspect"], { w: number; h: number }> = {
    portrait: { w: 1280, h: 1600 },
    landscape: { w: 1600, h: 1280 }
}

/** The width:height ratio of each canonical shape, used to aspect-lock the crop box. */
export const CLIENT_RATIO: Record<CropSelection["aspect"], number> = {
    portrait: CLIENT_CANON.portrait.w / CLIENT_CANON.portrait.h,
    landscape: CLIENT_CANON.landscape.w / CLIENT_CANON.landscape.h
}

/**
 * The detail payload of the `imagecrop:change` event the ImageCrop component dispatches on its root
 * element whenever the selection changes (a new file, an orientation toggle, a pan/zoom, or a reset).
 *
 * @property {CropSelection | null} crop - the current normalized selection, or null when no image is loaded
 * @property {{ width: number; height: number } | null} natural - the loaded image's natural pixel size, or null
 * @property {boolean} tooSmall - whether the selected region is smaller than its canonical canvas (will be upscaled)
 */
export interface ImageCropChangeDetail {
    crop: CropSelection | null
    natural: { width: number; height: number } | null
    tooSmall: boolean
}
