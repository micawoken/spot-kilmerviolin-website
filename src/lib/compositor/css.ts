/**
 * lib/compositor/css.ts
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

// A `?raw` import ships byte-for-byte with no build-time minification, so any /* */ comment in the source
// file is inlined straight into the served HTML (compositor.css into every public entity/design page via
// PublicPage.astro; both compositor.css and search-form.css into the design editor's live-preview canvas).
// Apply this to every ?raw CSS import so the source files can stay fully commented for maintainers without
// that commentary ever reaching a browser. Not a general-purpose CSS parser: assumes authored source (no
// comment markers inside string literals or content: values), which holds for this repo's own stylesheets.
export function stripCssComments(css: string): string {
    return css
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}
