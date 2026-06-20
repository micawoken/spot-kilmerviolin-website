/**
 * vitest.config.ts
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

import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

export default defineConfig({
    plugins: [
        cloudflareTest({
            // the wrangler config's main (@astrojs/cloudflare/entrypoints/server) only exists in
            // Astro builds; tests import library modules directly, so a stub entrypoint is used
            main: "./tests/test-worker.ts",
            wrangler: {
                configPath: "./wrangler.jsonc"
            }
        })
    ]
})