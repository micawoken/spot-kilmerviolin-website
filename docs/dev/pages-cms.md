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
`src/lib/api/authorize.ts`) but are currently **unused** — retained in case a future worker-hosted CMS
gates on them again.

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
