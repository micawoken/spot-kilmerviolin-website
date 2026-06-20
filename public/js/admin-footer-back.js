/*
 * admin-footer-back.js
 *
 * "Back" goes to the previous page in history. Served as a same-origin static file (not an Astro
 * <script>, which the bundler inlines for small scripts) so the admin Content-Security-Policy can keep
 * script-src 'self' with no inline-script allowance. The anchor's href="/admin" remains the no-JS
 * fallback, so this only overrides navigation when history exists.
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

const back_link = document.getElementById("admin-footer-back")
if (back_link) {
    back_link.addEventListener("click", (event) => {
        if (window.history.length > 1) {
            event.preventDefault()
            window.history.back()
        }
    })
}
