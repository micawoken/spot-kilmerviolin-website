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