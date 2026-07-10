#  HOW TO DEPLOY

This guide outlines how to deploy this Cloudflare Worker. It assumes you have just downloaded the repository code from GitHub using *git fetch*.

It is assumed you have some experience using git, GitHub, Cloudflare, and pnpm, but this guide should be accessible.

## Astro Worker

The Astro worker is a Cloudflare Worker powering a website using the Astro framework. The worker renders all public-facing pages, the administrative services, and the API that powers the administrative services.

1. Make sure you have Node.js installed:
- Install Node.js (latest version, at least 22+) through your node version manager (Google it; Volta is an example)
- Install pnpm (latest supported version for the node version) through your node version manager
2. Install dependencies - run *pnpm install*
3. Log into your Cloudflare Account: *npx wrangler login*
4. Set your secrets using *npx wrangler secret put [SECRET NAME]*
- CF_ACCESS_TOKEN: a Cloudflare Account API token scoped to:
  - Access: Policies (Read and Edit) — account-level. This is all the worker needs to manage enrollment; it edits the reusable Access policy's inline email rules directly. Do NOT grant the broad "Zero Trust (Read and Write)" scope — the worker no longer touches Gateway lists.
- CF_DEPLOY_HOOK: the last part of the deploy hook URL that the site can call to trigger a rebuild using Worker Builds
  - Create a deploy hook URL at cloudflare.com > Compute > Workers > (your worker) > Settings > Deploy Hooks. Only put the part after .../builds/deploy_hooks/[**secret**]
5. Load the secrets you just set in wrangler secrets into a .env file.
- Create a .env file in the root of this directory
- Add the secrets, in the format [secret_name]=[secret_value]
6. Configure your wrangler.jsonc file:
- Set up your vars:
  - Cloudflare account ID, in both places (key "account_id", and key "CF_ACCOUNT_ID" in the vars binding)
  - CF_ACCESS_POLICY_ID: the ID of the **reusable** Access policy the worker manages, at Zero Trust > Access controls > Policies > (your policy): it is the last part of the URL, after /policies/**policy_id**
    - The worker adds/removes contributor emails as inline `email` include rules on this policy (no reusable email list is used). Any other rules you set on the policy (groups, service tokens, etc.) are preserved.
    - The policy must be **reusable** (account-scoped). If your Access app still uses a legacy per-app policy, convert it first: `PUT /accounts/{account_id}/access/apps/{app_id}/policies/{policy_id}/make_reusable` (needs Access: Apps and Policies Edit for that one-time call).
  - CF_ACCESS_AUD: the AUD tag of the Zero Trust Access Policy, accessible at Zero Trust > Applications > (your application name) > Additional settings > AUD tag
    - To create an Access application: Zero Trust > Applications > Create new application
  - TEAM_DOMAIN: the team domain of your Cloudflare Access config, available in your Zero Trust home
- Set up your new databases for:
  - D1: create your D1 database and copy over the new ID
    - After you create it, run this command at the root of the astro website repo to set up your database: *npx wrangler d1 execute (your database name) --remote --file="./db_init.sql"*
    - Then, run this command to allow you to log in (replace brackets with actual values): *npx wrangler d1 execute (your database name) --remote --command="INSERT INTO contributors VALUES (null, [Your Name], null, null, null, null, null, [Your Email], 1, null, 1, null, null, "2026-06-30T00:00:00Z", "2026-06-30T00:00:00Z");*
  - KV: create your KV namespace and copy over the new ID
  - R2: create your new R2 bucket and copy over your bucket name
- Deploy target:
  - workers.dev: enable workers_dev as true, and delete all routes (your URL will be {worker_name}.{team_name}.workers.dev)
  - custom domain: disable workers_dev, and set custom domain in route as {"route": "{hostname}", "custom_domain": true}
7. Update your ALLOWED_ORIGINS in src/consts.ts to be your new website target
8. Set up git
- Change your git remote to your new repo target, and switch your branch to not be main
- Stage your changes *git add .*, commit your changes *git commit -m "updating account configs, etc."*, and push *git push*
9. Deploy process:
- Locally: run *npx astro build; npx wrangler deploy* (Windows PowerShell); *npx astro build && npx wrangler deploy* (Windows Command Prompt)
- Remotely: create and complete a pull request into main - Worker Builds will auto-build and deploy

Done!

Content editing goes through EmDash, the in-worker CMS at /_emdash (see docs/dev/emdash-migration.md) — no
separate CMS deployment is needed.
