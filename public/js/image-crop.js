/*
 * image-crop.js
 *
 * Behaviour for the components/ImageCrop.astro crop interface (markup declared statically there). Served
 * as a same-origin static file (not an Astro <script>, which the bundler inlines for small self-contained
 * scripts) so the admin Content-Security-Policy can keep script-src 'self' with no inline-script
 * allowance. Wires each .image-crop root: its file input, preview, aspect-locked crop box, orientation
 * toggle, and the too-small warning. Reports the current selection by dispatching an `imagecrop:change`
 * CustomEvent (detail: { crop, natural, tooSmall }) on the root, which the host page forwards on submit.
 *
 * CLIENT_CANON / CLIENT_RATIO mirror scripts/image_crop.ts (itself mirroring CANON_PORTRAIT /
 * CANON_LANDSCAPE in lib/api/images.ts) - keep the three in sync. They are duplicated here because a
 * static file served under script-src 'self' cannot import the bundled TypeScript module.
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

// The two canonical output shapes, in pixels, keyed by orientation.
const CLIENT_CANON = {
    portrait: { w: 1280, h: 1600 },
    landscape: { w: 1600, h: 1280 }
}
// The width:height ratio of each canonical shape, used to aspect-lock the crop box.
const CLIENT_RATIO = {
    portrait: CLIENT_CANON.portrait.w / CLIENT_CANON.portrait.h,
    landscape: CLIENT_CANON.landscape.w / CLIENT_CANON.landscape.h
}

const DEFAULT_ASPECT = "portrait"
// smallest crop box width, as a fraction of the image, so the box stays grabbable
const MIN_W = 0.1

/** Wires one ImageCrop root: its file input, preview, crop box, orientation toggle, and warning. */
function initImageCrop(root) {
    const input_id = root.dataset.inputId
    const file_input = input_id ? document.getElementById(input_id) : null
    const img = root.querySelector(".image-crop-img")
    const box = root.querySelector(".image-crop-box")
    const handle = root.querySelector(".image-crop-handle")
    const btn_portrait = root.querySelector('.image-crop-aspect[data-aspect="portrait"]')
    const btn_landscape = root.querySelector('.image-crop-aspect[data-aspect="landscape"]')
    const warning = root.querySelector(".image-crop-warning")
    const warning_text = root.querySelector(".image-crop-warning-text")
    if (
        !(file_input instanceof HTMLInputElement) ||
        !(img instanceof HTMLImageElement) ||
        !(box instanceof HTMLElement) ||
        !(handle instanceof HTMLElement) ||
        !btn_portrait ||
        !btn_landscape ||
        !warning ||
        !warning_text
    ) {
        console.warn("ImageCrop: missing expected elements", { input_id })
        return
    }

    // --- state (normalized 0..1, relative to the image) ---
    let aspect = DEFAULT_ASPECT
    let natural = null
    let object_url = null
    const sel = { x: 0, y: 0, w: 1, h: 1 }

    /** The image's rendered pixel size (0 before layout). */
    const rendered = () => ({ w: img.clientWidth, h: img.clientHeight })

    /** Normalized box height that yields the target pixel ratio for a given normalized width. */
    const heightForWidth = (w) => {
        if (!natural) return w
        // pixel ratio (w*W)/(h*H) = RATIO ⇒ h = w * (W/H) / RATIO; W/H == natural ratio
        return (w * (natural.width / natural.height)) / CLIENT_RATIO[aspect]
    }

    /** Inverse of heightForWidth: the normalized width that yields a given normalized height. */
    const widthForHeight = (h) => {
        if (!natural) return h
        // invert h = w * (W/H) / RATIO ⇒ w = h * RATIO * (H/W)
        return h * CLIENT_RATIO[aspect] * (natural.height / natural.width)
    }

    /** Largest crop box of the current aspect, centered on (cx, cy) and clamped inside the image. */
    const fitCentered = (cx, cy) => {
        let w = 1
        let h = heightForWidth(w)
        if (h > 1) {
            h = 1
            w = natural ? CLIENT_RATIO[aspect] * (natural.height / natural.width) : 1
        }
        sel.w = w
        sel.h = h
        sel.x = Math.min(Math.max(0, cx - w / 2), 1 - w)
        sel.y = Math.min(Math.max(0, cy - h / 2), 1 - h)
    }

    /** Whether the current region's pixel size is below its canonical canvas (so it will be upscaled). */
    const isTooSmall = () => {
        if (!natural) return false
        const canon = CLIENT_CANON[aspect]
        return sel.w * natural.width < canon.w || sel.h * natural.height < canon.h
    }

    const currentCrop = () =>
        natural ? { aspect, x: sel.x, y: sel.y, w: sel.w, h: sel.h } : null

    /** Repaints the box, refreshes the too-small warning, and notifies the host of the new selection. */
    const sync = () => {
        const r = rendered()
        box.style.left = `${sel.x * r.w}px`
        box.style.top = `${sel.y * r.h}px`
        box.style.width = `${sel.w * r.w}px`
        box.style.height = `${sel.h * r.h}px`

        const too_small = isTooSmall()
        box.classList.toggle("is-warning", too_small)
        warning.hidden = !too_small
        if (too_small && natural) {
            const canon = CLIENT_CANON[aspect]
            const rw = Math.round(sel.w * natural.width)
            const rh = Math.round(sel.h * natural.height)
            warning_text.textContent = `This crop (${rw}x${rh}) is smaller than ${canon.w}x${canon.h}. The system will apply sharpening, but the image may still look blurry or pixelated.`
        }

        const detail = { crop: currentCrop(), natural, tooSmall: too_small }
        root.dispatchEvent(new CustomEvent("imagecrop:change", { detail }))
    }

    const setAspect = (next) => {
        aspect = next
        btn_portrait.classList.toggle("is-active", next === "portrait")
        btn_landscape.classList.toggle("is-active", next === "landscape")
        if (natural) {
            fitCentered(sel.x + sel.w / 2, sel.y + sel.h / 2)
            sync()
        }
    }

    // --- file loading ---
    const clear = () => {
        if (object_url) {
            URL.revokeObjectURL(object_url)
            object_url = null
        }
        img.removeAttribute("src")
        natural = null
        root.hidden = true
        box.classList.remove("is-warning")
        warning.hidden = true
    }

    const notifyCleared = () => {
        const detail = { crop: null, natural: null, tooSmall: false }
        root.dispatchEvent(new CustomEvent("imagecrop:change", { detail }))
    }

    const loadFile = (file) => {
        clear()
        if (!file || !file.type.toLowerCase().startsWith("image/")) {
            notifyCleared()
            return
        }
        object_url = URL.createObjectURL(file)
        img.onload = () => {
            natural = { width: img.naturalWidth, height: img.naturalHeight }
            root.hidden = false
            fitCentered(0.5, 0.5)
            sync()
        }
        img.onerror = () => {
            clear()
            notifyCleared()
        }
        img.src = object_url
    }

    file_input.addEventListener("change", () => loadFile(file_input.files?.[0]))
    btn_portrait.addEventListener("click", () => setAspect("portrait"))
    btn_landscape.addEventListener("click", () => setAspect("landscape"))

    // --- drag (pan) and resize (zoom), both pointer-driven and clamped within the image ---
    let mode = null
    let start_px = { x: 0, y: 0 }
    let start_sel = { x: 0, y: 0, w: 0, h: 0 }

    const beginDrag = (evt, kind) => {
        if (!natural) return
        evt.preventDefault()
        mode = kind
        start_px = { x: evt.clientX, y: evt.clientY }
        start_sel = { ...sel }
        evt.target.setPointerCapture?.(evt.pointerId)
    }

    box.addEventListener("pointerdown", (evt) => {
        // the corner handle resizes; the rest of the box pans
        if (evt.target === handle) beginDrag(evt, "resize")
        else beginDrag(evt, "drag")
    })

    box.addEventListener("pointermove", (evt) => {
        if (!mode || !natural) return
        const r = rendered()
        if (r.w === 0 || r.h === 0) return
        const dx = (evt.clientX - start_px.x) / r.w
        const dy = (evt.clientY - start_px.y) / r.h
        if (mode === "drag") {
            sel.x = Math.min(Math.max(0, start_sel.x + dx), 1 - sel.w)
            sel.y = Math.min(Math.max(0, start_sel.y + dy), 1 - sel.h)
        } else {
            // resize from the top-left anchor: pointer x sets the new width, height follows the ratio
            let w = Math.max(MIN_W, start_sel.w + dx)
            w = Math.min(w, 1 - sel.x)
            let h = heightForWidth(w)
            if (sel.y + h > 1) {
                h = 1 - sel.y
                w = Math.min(1 - sel.x, widthForHeight(h))
            }
            sel.w = w
            sel.h = h
        }
        sync()
    })

    const endDrag = (evt) => {
        mode = null
        evt.target.releasePointerCapture?.(evt.pointerId)
    }
    box.addEventListener("pointerup", endDrag)
    box.addEventListener("pointercancel", endDrag)

    // keep the box correct when the rendered image size changes (responsive layout)
    if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(() => {
            if (natural) sync()
        }).observe(img)
    }
}

document.querySelectorAll(".image-crop").forEach(initImageCrop)
