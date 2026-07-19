/*
 * list-result-nav.js
 *
 * Admin list results: intercept clicks on the per-row "edit" links and navigate via JS. Served as a
 * same-origin static file (not an Astro <script>, which the bundler inlines for small self-contained
 * scripts) so the admin Content-Security-Policy can keep script-src 'self' with no inline-script
 * allowance. The links keep their href, so this only reroutes navigation when scripting is available.
 * Emitted by components/entities/ListResults.astro only in the admin environment.
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

document.querySelectorAll(".list-result-edit-link").forEach((link) => {
    link.addEventListener("click", (event) => {
        event.preventDefault()
        const url = link.getAttribute("href")
        if (url) {
            window.location.href = url
        }
    })
})
