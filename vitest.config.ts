/**
 * vitest.config.ts
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

import { createRequire } from "node:module"
import { cloudflareTest } from "@cloudflare/vitest-pool-workers"
import { configDefaults, defineConfig } from "vitest/config"

// obscenity's "module"/"import" export condition (dist/index.mjs) re-exports its CJS build through a
// default-import interop shim (`import mod from "./index.js"; export const X = mod.X`) that resolves `mod`
// to undefined under vitest-pool-workers' module loader, throwing on import - unrelated to
// lib/public/spam.ts itself. The real Astro/Wrangler build never hits this: esbuild inlines obscenity's CJS
// source directly with its own interop wrapper instead of going through this shim. Aliasing straight to the
// resolved CJS entry (an absolute path, so it bypasses the package's `exports` map, which does not expose
// dist/index.js under the "import" condition tests resolve through) sidesteps the broken shim in tests too.
const obscenityCjsEntry = createRequire(import.meta.url).resolve("obscenity")

export default defineConfig({
    test: {
        projects: [
            {
                resolve: {
                    alias: {
                        obscenity: obscenityCjsEntry
                    }
                },
                plugins: [
                    cloudflareTest({
                        // Astro's generated worker entrypoint is unavailable before a build
                        main: "./tests/test-worker.ts",
                        wrangler: {
                            configPath: "./wrangler.jsonc"
                        }
                    })
                ],
                test: {
                    name: "workers",
                    exclude: [...configDefaults.exclude, "tests/contact-*-interactions.test.ts"]
                }
            },
            {
                test: {
                    name: "dom",
                    include: ["tests/contact-*-interactions.test.ts"],
                    environment: "happy-dom"
                }
            }
        ]
    }
})
