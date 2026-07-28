/**
 * lib/search/jump.ts
 *
 * The "Jump to N results" affordance shared by pages/search.astro and pages/search/advanced.astro.
 *
 * Both pages put their results below a tall control block (the advanced page's filter grid especially),
 * so on a short viewport a completed search can leave the result list entirely below the fold with no
 * on-screen change — the search reads as having done nothing. This renders a summary right under the
 * form that says how many results landed, and scrolls to them when clicked.
 *
 * Shown after every completed search regardless of viewport, deliberately: the alternative (measure
 * whether results are already visible) has to pick a moment to measure, and any moment is wrong as soon
 * as the visitor scrolls or the excerpts reflow.
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
 * Renders the jump summary for a completed search.
 *
 * A zero count renders as plain text, not a link: "No results" that scrolls you to "No results found."
 * is a wasted click. Any other count renders a button that scrolls `target` into view.
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
    // setting exists for, and `behavior: "auto"` still lands in the same place, instantly.
    button.addEventListener("click", () => {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" })
    })
    container.appendChild(button)
    container.hidden = false
}

/** Empties and hides the jump summary — for a cleared query, or while a search is still running. */
export function clearJumpLink(container: HTMLElement): void {
    container.replaceChildren()
    container.hidden = true
}
