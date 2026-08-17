/**
 * lib/search/jump.ts
 *
 * Powers the "Jump to N results" mechanism in /search and /advanced/search
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

/**
 * Renders the jump summary for a completed search
 *
 * @param {HTMLElement} container - the wrapper to fill; hidden by `clearJumpLink` until a search completes
 * @param {HTMLElement} target - the element scrolled to, normally the status line above the result list
 * @param {number} count - total results the search produced, across every page
 */
export function renderJumpLink(container: HTMLElement, target: HTMLElement, count: number): void {
    container.replaceChildren()
    if (count === 0) {
        container.append("No results")
        container.hidden = false
        return
    }
    const button = document.createElement("button")
    button.type = "button"
    button.className = "search-jump__link"
    button.textContent = `Jump to ${count} ${count === 1 ? "result" : "results"} ↓`
    // Honors prefers-reduced-motion: an unrequested smooth scroll is exactly the vestibular trigger that
    // setting exists for, and `behavior: "auto"` still lands in the same place, instantly
    button.addEventListener("click", () => {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" })
    })
    container.appendChild(button)
    container.hidden = false
    // Every completed search with results scrolls the visitor to them without requiring the click above
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        target.scrollIntoView({ behavior: "smooth", block: "start" })
    }
}

/** Empties and hides the jump summary - for a cleared query, or while a search is still running. */
export function clearJumpLink(container: HTMLElement): void {
    container.replaceChildren()
    container.hidden = true
}
