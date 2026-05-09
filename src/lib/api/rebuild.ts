/**
 * lib/api/rebuild.ts
 * 
 * Provides a function to command Cloudflare Workers to rebuild the Astro site and redeploy the Worker
 * 
 * Used whenever the database is modified to update the static pages with the new data
 * 
 * 
 */

import { env } from "cloudflare:workers"


const deploy_hook_url = "https://api.cloudflare.com/client/v4/workers/builds/deploy_hooks/"

export async function rebuild() {
    const deploy_hook = deploy_hook_url + env.CF_DEPLOY_HOOK
    const response = await fetch(deploy_hook, {
        method: "POST"})
    if (!response.ok) {
        console.error("Failed to trigger rebuild:", response.statusText)
    } else {
        console.log("Rebuild triggered successfully")
    }
}