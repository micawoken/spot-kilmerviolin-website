/**
 * worker.ts
 *
 * Worker entrypoint: delegates to the Astro adapter's handler and re-exports the Durable Objects the
 * wrangler config binds
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

import { handle } from "@astrojs/cloudflare/handler"

export { R2Quota } from "./lib/api/r2-quota"

export default {
    async fetch(request, env, context) {
        return await handle(request, env, context)
    }
} satisfies ExportedHandler<Env>
