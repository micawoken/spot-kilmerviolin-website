// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
	site: "https://example.com", // will set later
	integrations: [mdx(), sitemap()],
	adapter: cloudflare(),
	trailingSlash: "never",
	output: "server", // prerender needs to be enabled on the relevant pages
	security: {
		allowedDomains: [
			{
				hostname: "example.com", // will set later
				protocol: "https"
			},
			{
				hostname: "www.example.com", // will set later
				protocol: "https"
			}
		],
		checkOrigin: import.meta.env.PROD
	}
});
