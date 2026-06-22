# Pages CMS — setup & operation notes

The public-facing content (the `pages` collection and the site-chrome files — site settings, navigation,
footer) is edited through **Pages CMS**, an external app that edits this repo over the GitHub API. It is
driven by `.pages.yml` at the repo root. **None of its code runs in our Cloudflare Worker**, which is why
it replaced Keystatic (see `docs/dev/pages-cms-migration.md` for the why and the conversion record).

The on-disk contract is unchanged: Pages CMS writes the exact files the build-time readers already consume
(`src/content.config.ts` for the `pages` collection, `src/lib/content/*` for the settings files), so a
content edit is a commit here, which triggers a rebuild that bakes the new content into the bundle — the
established **edit → commit → rebuild** publish flow.

## Hosting: self-host on Vercel (planned)

The intended deployment is a **self-hosted Pages CMS on Vercel (Hobby plan)**. Pages CMS is open source
(https://github.com/pages-cms/pages-cms) and self-hosting requires creating your own GitHub App; follow
its README/`.env.local.example`. The hosted instance at `https://app.pagescms.org` is the alternative if
you don't want to run your own.

> Self-hosting is the recommended path given the access-control change below — it keeps content editing
> off a third-party service.

## One-time setup (owner action)

1. Deploy Pages CMS (Vercel Hobby self-host, or use the hosted `app.pagescms.org`).
2. Create/install a **GitHub App** for it with **Contents: Read and write** on `micawoken/entrusting-devilish-fish`
   (the hosted instance ships its own app you simply install; a self-host needs an app you create — see the
   Pages CMS README).
3. Open the repo in Pages CMS. It reads `.pages.yml` from the default branch and renders the editor.

No environment variables or secrets are added to **this** project — that was a Keystatic requirement and is
gone. All CMS credentials live with the Pages CMS deployment, not here.

## Access control — this changed from Keystatic

Keystatic ran in-app and was gated by the `cms_editor` permission (the `siteeditor` role) in
`src/middleware/identity.ts`. **Pages CMS is external, so that in-app gate no longer applies.** Anyone who
can sign into the Pages CMS instance **and** has access to the repo (or is added as a Pages CMS
collaborator) can edit content. To keep control tight:

- manage repo collaborators / Pages CMS collaborators deliberately, and/or
- self-host so access is bounded by your own GitHub App and instance.

The `cms_editor` permission and `siteeditor` role are **kept** in the codebase (`src/lib/api/types.d.ts`,
`src/lib/api/authorize.ts`) and now **drive the collaborator sync below** — the worker remains the source of
truth for who may edit content, even though the editor itself is external.

## Automated collaborator sync (worker → Pages CMS)

The Pages CMS `collaborator` table is kept in step with the worker's authorization state automatically, keyed
on the shared email (`contributors.identity_email` == the email an editor signs into Pages CMS with). A
contributor is provisioned as a CMS editor when they are an **admin**, or hold a role granting the
`cms_editor` permission (today `siteeditor`) **and** are **active**.

Two complementary paths (see `src/lib/api/cms_access_sync.ts`):

1. **Real-time push.** Contributor mutations that change authorization (`activateUser`, `deactivateUser`,
   `elevateUser`, `demoteUser`, `assignRole`, `removeRole`, `setRoles`, `removeUser`, and login-email
   changes — all in `src/lib/public/usermgmt.ts`) fire a fire-and-forget `POST`/`DELETE` (via
   `ctx.waitUntil`) to the Pages CMS endpoint `app/api/sync/cms-access`. A CMS outage never fails the worker
   request — the reconcile cron repairs it.
2. **Reconcile cron.** A Vercel cron on the Pages CMS fork (`app/api/cron/sync-cms-access`, scheduled in
   `vercel.json`) reads the D1 `contributors` table directly via the **Cloudflare D1 REST API** (read-only
   token) and repairs drift. It only adds/removes collaborators whose email matches a D1 contributor;
   hand-added, non-contributor collaborators are never touched.

### Configuration

| Side | Name | Kind | Purpose |
| --- | --- | --- | --- |
| Worker | `PAGES_CMS_SYNC_URL` | var (`wrangler.jsonc`) | the fork's `/api/sync/cms-access` endpoint; blank disables the push |
| Worker | `PAGES_CMS_SYNC_SECRET` | secret | bearer token the push authenticates with; blank disables the push |
| Fork | `WORKER_SYNC_SECRET` | env | must equal `PAGES_CMS_SYNC_SECRET` |
| Fork | `SYNC_OWNER` / `SYNC_REPO` | env | repo coordinates (default `micawoken` / `entrusting-devilish-fish`) |
| Fork | `CF_ACCOUNT_ID` / `CF_D1_DATABASE_ID` | env | from the worker's `wrangler.jsonc` |
| Fork | `CF_D1_API_TOKEN` | env | Cloudflare API token, D1 read scope, for the reconcile query |
| Fork | `CRON_SECRET` | env | guards the cron route (Vercel sends it as `Authorization: Bearer`) |

When the worker's URL/secret are unset the push cleanly no-ops (`cmsSyncConfigured`), so local/test runtimes
are never coupled to the integration.

> **Verify the D1 token scope:** confirm a Cloudflare API token scoped to **D1 → Read** is accepted by the
> `/d1/database/{id}/query` POST endpoint for the `SELECT`. If Read is rejected, use a D1-scoped Edit token
> restricted to this single account.

### Provisioning reviewers (GitHub write) vs writers (email collaborators)

Content **writers** edit through Pages CMS as email collaborators and need no GitHub repo access. Content
**reviewers/mergers** need GitHub write to merge the PRs that drive CI/CD. The reviewer population is
provisioned in-app through the **GitHub repository linkage** feature: the `siteeditor` role carries the
`github_link` permission to link a GitHub username, and an administrator authorizes that account as a
repository collaborator. See `docs/dev/github-linkage.md`.

## How `.pages.yml` maps to the on-disk files

| CMS entry        | On-disk path                            | Format            | Read by |
| ---------------- | --------------------------------------- | ----------------- | ------- |
| `pages`          | `src/content/pages/<slug>.mdoc`         | YAML frontmatter + markdown body | `src/content.config.ts`, `src/pages/[...slug].astro` |
| `site_settings`  | `src/content/settings/site.json`        | JSON              | `src/lib/content/site.ts` |
| `navigation`     | `src/content/settings/navigation.json`  | JSON              | `src/lib/content/nav.ts` |
| `footer`         | `src/content/settings/footer.json`      | JSON              | `src/lib/content/footer.ts` |

### Slug model (dedicated slug field)

A page's URL is its **filename** — `src/pages/[...slug].astro` routes off the entry filename. `.pages.yml`
templates the filename from a dedicated **`slug`** field (`filename: '{fields.slug}.mdoc'`), decoupled from
the title — reproducing Keystatic's separate slug field. Editing the slug renames the file (and changes the
URL); editing the title does not. The `slug` value is also written into the page's frontmatter; that key is
ignored by `content.config.ts` (zod strips it) and is harmless.

### Media (page-body images)

`media.input: public/uploads`, `media.output: /uploads`. Rich-text image uploads are committed under
`public/uploads/`, which Astro serves at `/uploads/...`. (The admin composition-image system — R2 and the
bundled `src/files` pool — is separate and unaffected.)

### Markdoc note

The `rich-text` body field emits standard Markdown, which is valid Markdoc, so `@astrojs/markdoc` renders
it unchanged. Markdoc-specific tags (`{% ... %}`) can't be authored through `rich-text`; if ever needed,
use a `code`/`text` field instead.

## In-app link to the CMS

There is intentionally **no in-app link** to Pages CMS yet. Once the CMS deployment is confirmed working,
add a link (e.g. in `src/components/AdminHeader.astro`) pointing at the instance URL for this repo —
`https://<your-pages-cms-host>/micawoken/entrusting-devilish-fish` (self-hosted) or
`https://app.pagescms.org/micawoken/entrusting-devilish-fish` (hosted).

## Smoke test after deployment

1. In Pages CMS, edit the example page and a setting (e.g. add a nav link).
2. Confirm the commit lands with the **same file paths/format** as the table above.
3. Pull, run `npm run build`, and confirm the site renders the change.
