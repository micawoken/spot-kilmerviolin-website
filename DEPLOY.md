#  HOW TO DEPLOY

This guide outlines how to deploy this Cloudflare Worker in conjunction with the Pages CMS instance. It assumes you have just downloaded the repository code from GitHub using *git fetch*.

It is assumed you have some experience using git, GitHub, Cloudflare, and pnpm, but this guide should be accessible.

## Astro Worker

The Astro worker is a Cloudflare Worker powering a website using the Astro framework. The worker renders all public-facing pages, the administrative services, and the API that powers the administrative services.

1. Make sure you have Node.js installed:
- Install Node.js (latest version, at least 22+) through your node version manager (Google it; Volta is an example)
- Install pnpm (latest supported version for the node version) through your node version manager
2. Install dependencies - run *pnpm install*
3. Log into your Cloudflare Account: *npx wrangler login*
4. Set your secrets using *npx wrangler secret put [SECRET NAME]*
- CF_ACCESS_TOKEN: a Cloudflare Account API token granting access to:
  - Zero Trust (Read and Write)
- CF_DEPLOY_HOOK: the last part of the deploy hook URL that the site can call to trigger a rebuild using Worker Builds
  - Create a deploy hook URL at cloudflare.com > Compute > Workers > (your worker) > Settings > Deploy Hooks. Only put the part after .../builds/deploy_hooks/[**secret**]
- GITHUB_ADMIN_TOKEN: a GitHub account token granting read access to metadata and read/write access to administration
  - Create here: Github User Settings > Developer settings > Personal access tokens > Fine-grained tokens
- PAGES_CMS_SYNC_SECRET: a secret used to faciliate data transfer between the Pages CMS instance and this worker (to authorize emails to use the CMS)
  - Generate using this command: *openssl rand -hex 64*
5. Load the secrets you just set in wrangler secrets into a .env file.
- Create a .env file in the root of this directory
- Add the secrets, in the format [secret_name]=[secret_value]
6. Configure your wrangler.jsonc file:
- Set up your vars:
  - Cloudflare account ID, in both places (key "account_id", and key "CF_ACCOUNT_ID" in the vars binding)
  - CF_ACCESS_LIST_ID: the ID of the Zero Trust reusable component, accessible at Zero Trust > Reusable Components > Lists > (your list): it is the last part of the URL, after /lists/**list_id**
    - To create a new list: Zero Trust > Reusable Components > Lists > Create manual list; list type is email
  - CF_ACCESS_AUD: the AUD tag of the Zero Trust Access Policy, accessible at Zero Trust > Applications > (your application name) > Additional settings > AUD tag
    - To create an Access application: Zero Trust > Applications > Create new application
  - GITHUB_REPO_OWNER: the username of the GitHub account to host the repository
  - GITHUB_REPO_NAME: the name of the repository
  - PAGES_CMS_SYNC_URL: the API endpoint of the Pages CMS instance to perform the permissions sync, always ending with /api/sync/cms-access
  - TEAM_DOMAIN: the team domain of your Cloudflare Access config, available in your Zero Trust home
- Set up your new databases for:
  - D1: create your D1 database and copy over the new ID
    - After you create it, run this command at the root of the astro website repo to set up your database: *npx wrangler d1 execute (your database name) --remote --file="./db_init.sql"*
    - Then, run this command to allow you to log in (replace brackets with actual values): *npx wrangler d1 execute (your database name) --remote --command="INSERT INTO contributors VALUES (null, [Your Name], null, null, null, null, null, [Your Email], 1, null, 1, null, null, null, null, "2026-06-30T00:00:00Z", "2026-06-30T00:00:00Z");*
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

## Pages CMS

The Pages CMS instance is a fork of [Pages CMS](https://pagescms.org) (a Next.js app) deployed on **Vercel**, backed by a **Supabase** PostgreSQL database. Authorized site editors use it to edit website content: a user is authorized if they are an administrator or if they possess the cms_editor permission; data syncing is enabled by a real-time call from the Worker to add/remove contributors and a daily verification check by Pages CMS against the database.

It is assumed you have some experience with Vercel, Supabase, and a GitHub App, but this guide should be accessible. Most of the work is creating accounts/resources and pasting their values into Vercel environment variables.

1. Fork the repository:
- Fork this Pages CMS repo to your own GitHub account. The deployed instance tracks the *main* branch.
2. Create your Supabase project:
- Create a free project at [supabase.com](https://supabase.com). Choose a strong database password and save it.
- Get the **session pooler** connection string: Supabase > Project Settings > Database > Connection string > **Session pooler** (host ends in *pooler.supabase.com*, port **5432**).
- IMPORTANT: append *?sslmode=require* to the end of the string; your connection string will not have it, and you must add it.
- IMPORTANT: always use the **session pooler (5432)**, never the transaction pooler (6543).
3. Create your GitHub App:
- Create one with the bundled helper, run locally against your fork: *npm install* then *npm run setup:github-app -- --base-url https://your-cms-domain* (use *--owner-type org --org your-org* if the app should live in an organization).
- Note the following secrets in your env file: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, GITHUB_APP_NAME, and GITHUB_APP_WEBHOOK_SECRET
- Install the app on the account that owns your content repo, and grant it access to that repo
4. Create your Vercel project:
- Import your fork into [Vercel](https://vercel.com). The framework is auto-detected (Next.js); no build-command overrides are needed.
- The build runs *next build* only - database migrations are intentionally **not** run during the build (see step 7).
5. Set environment variables in Vercel (Project > Settings > Environment Variables), for the Production environment:
- Core:
  - DATABASE_URL: the Supabase session-pooler string from step 2, **including** *?sslmode=require*
  - BETTER_AUTH_SECRET: a random secret - generate with *openssl rand -base64 32*
  - CRYPTO_KEY: a separate random secret - generate with *openssl rand -base64 32*
  - BASE_URL: the single canonical URL of this CMS instance (e.g. *https://your-cms-domain*). Do not mix a custom domain and the *.vercel.app URL for the same install.
  - ADMIN_EMAILS: comma-separated allowlist of emails that may access the admin panel
- GitHub App (from step 3): GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, GITHUB_APP_NAME, GITHUB_APP_WEBHOOK_SECRET
- Worker sync (links the CMS to the Astro worker):
  - WORKER_SYNC_SECRET: must be **the exact same value** as the worker's PAGES_CMS_SYNC_SECRET secret (from the Astro Worker section above). This authorizes the worker's calls.
  - SYNC_OWNER: the GitHub username/org that owns the content repo (e.g. the GITHUB_REPO_OWNER from the worker config)
  - SYNC_REPO: the content repo name (e.g. the GITHUB_REPO_NAME from the worker config)
- D1 read-back (lets the daily reconcile cron read the worker's contributor list):
  - CF_ACCOUNT_ID: your Cloudflare account ID
  - CF_D1_DATABASE_ID: the ID of the worker's D1 database
  - CF_D1_API_TOKEN: a Cloudflare API token with D1 read access
- Cron auth:
  - CRON_SECRET: a random secret guarding the scheduled routes - generate with *openssl rand -base64 32*. Vercel injects the matching Bearer header into its own cron calls automatically.
6. Point the worker at this instance:
- Set the worker's PAGES_CMS_SYNC_URL (in *wrangler.jsonc*, see the Astro Worker section) to this instance's sync endpoint: *https://your-cms-domain/api/sync/cms-access*.
7. Run database migrations (decoupled from the Vercel build):
- Migrations run via the GitHub Action *.github/workflows/db-migrate.yml*, which fires on push to *main* when anything under the *db/migrations/* folder or the *db/schema.ts* file changes, and can also be triggered manually (workflow dispatch).
- Add a repository secret named **SUPABASE_DB_URL** (GitHub repo > Settings > Secrets and variables > Actions) set to the **same session-pooler** connection string from step 2. The migrate Action uses *psql*, so the *?sslmode=require* suffix is optional there but harmless.
- To migrate manually instead, run *npm run db:migrate* locally with DATABASE_URL pointed at the session pooler.
8. Keep the free-tier database awake:
- Supabase auto-pauses idle free-tier databases. Two redundant pingers prevent this, both running a trivial *SELECT 1*:
  - A Vercel cron at */api/cron/keepalive* (daily, configured in *vercel.json*), guarded by CRON_SECRET.
  - A GitHub Action *.github/workflows/supabase-keepalive.yml* (every 3 days), which reuses the **SUPABASE_DB_URL** secret from step 7.
- Note: GitHub disables scheduled workflows after ~60 days of repository inactivity - push something occasionally or re-enable them if they stop.
9. Deploy:
- Push to *main* (or merge a pull request into it). Vercel auto-builds and deploys; the migrate and keep-alive Actions run as described above.

Done!
