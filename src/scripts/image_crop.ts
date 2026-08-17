/**
 * scripts/image_crop.ts
 *
 * Shared types for the image crop interface
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

/** The crop region selected on the add/replace pages, normalized to the source image (0..1). */
export interface CropSelection {
    aspect: "portrait" | "landscape"
    x: number
    y: number
    w: number
    h: number
}

/**
 * The detail payload of the `imagecrop:change` event the ImageCrop component dispatches on its root
 * element whenever the selection changes
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
