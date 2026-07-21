/*
 * emdash-toolbar-strip.js
 *
 * Removes the EmDash toolbar node if/when its middleware injects it before the closing body tag. The
 * #emdash-toolbar { display: none !important } rule in AdminHead.astro hides it immediately (no flash);
 * this removes it so its inline script does no further work.
 *
 * Served as a same-origin static file (not an Astro <script>, which the bundler inlines for small
 * scripts) so the admin Content-Security-Policy can keep script-src 'self' with no inline-script
 * allowance. See components/AdminHead.astro and middleware/headers.ts.
 *
 * NOTE: do not write the literal string "</" + "body>" anywhere in this file (even in a comment) —
 * EmDash's toolbar-injection middleware does a naive string search for that exact substring in the
 * rendered HTML and splices its toolbar markup at the first occurrence.
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

;(function () {
    function strip() {
        document.getElementById("emdash-toolbar")?.remove()
    }
    const observer = new MutationObserver(() => {
        if (document.getElementById("emdash-toolbar")) {
            strip()
            observer.disconnect()
        }
    })
    observer.observe(document.documentElement, { childList: true, subtree: true })
    window.addEventListener("load", () => {
        strip()
        observer.disconnect()
    })
})()
