/**
 * live.config.ts
 *
 * Astro live content collections for EmDash (staged CMS migration).
 * EmDash content is served at request time from its D1 store through this loader — distinct from the
 * build-time flat-file collections in content.config.ts (docs, pages), which stay in place during the
 * staged migration. Query entries with getLiveCollection/getLiveEntry from "astro:content".
 *
 * Collections/content types are defined in the EmDash admin UI (/_emdash/admin), not here; the single
 * `_emdash` live collection internally routes to whatever content types exist in the CMS.
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

import { defineLiveCollection } from "astro:content"
import { emdashLoader } from "emdash/runtime"

export const collections = {
    _emdash: defineLiveCollection({
        loader: emdashLoader()
    })
}
