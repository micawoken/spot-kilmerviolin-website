# Migration: Keystatic → Pages CMS

**Audience:** the engineer/agent performing the conversion. Read this whole file before touching code.

## Why we are switching

Keystatic runs **inside** the Astro app — it injects `/keystatic` (editor UI) and `/api/keystatic/*`
(server routes) that execute in our runtime, which is **workerd** (the Cloudflare adapter, for both
`astro dev` and production). That collides with workerd in four independent ways: local storage needs a
filesystem (none in workerd); GitHub storage needs Node-only code paths (stubbed out in Keystatic's
worker build); Astro v6 removed `locals.runtime.env`, which `@keystatic/astro` reads; and the dependency
optimizer needed hand-tuning to even load. We patched layers 1–3 and chose GitHub storage, but GitHub
mode still fails in workerd. Keystatic-in-workerd is a dead end.

**Pages CMS has the opposite architecture.** It is a standalone web app (hosted at `app.pagescms.org`, or
self-hostable on Vercel/Node) that edits the repo over the GitHub API, driven by a `.pages.yml` at the
repo root. **None of its code runs in our worker.** So none of the workerd problems exist.

The key enabler for *this* repo: **Pages CMS writes the exact same files, in the same formats, that we
already read.** So the build-time readers stay untouched and the swap is invisible to the rest of the app.

## What does NOT change (do not modify these)

These read the on-disk content directly and are agnostic to which CMS produced it. Pages CMS writes the
same shapes, so leave their logic alone (comment wording referencing "Keystatic" should be updated to
"the CMS" — see step 6, but that is cosmetic):

- `src/content.config.ts` — globs `src/content/pages/**/*.mdoc`, validates `{title, description, pubDate}`.
- `src/pages/[...slug].astro` — renders pages by filename-slug + markdoc body.
- `src/lib/content/nav.ts` — imports `src/content/settings/navigation.json` → `{ links: [{label, href}] }`.
- `src/lib/content/site.ts` — imports `src/content/settings/site.json` → `{ title, description }`.
- `src/lib/content/footer.ts` — imports `src/content/settings/footer.json` → `{ organization, tagline }`.

The on-disk contract Pages CMS must preserve:

| Surface       | Path                                      | Format                          | Shape |
| ------------- | ----------------------------------------- | ------------------------------- | ----- |
| pages         | `src/content/pages/<slug>.mdoc`           | YAML frontmatter + markdown body| frontmatter `title`, `description`, `pubDate` (YYYY-MM-DD); body is markdown |
| site settings | `src/content/settings/site.json`          | JSON                            | `{ "title": string, "description": string }` |
| navigation    | `src/content/settings/navigation.json`    | JSON                            | `{ "links": [{ "label": string, "href": string }] }` |
| footer        | `src/content/settings/footer.json`        | JSON                            | `{ "organization": string, "tagline": string }` |

## Step 1 — Add `.pages.yml` at the repo root

This reproduces the Keystatic schema (`keystatic.config.ts`) against the table above. Verify field
options against the live docs (https://pagescms.org/docs/configuration/) as you go; the structure is
correct but option spellings should be double-checked.

```yaml
# Pages CMS config. The CMS is external (app.pagescms.org or self-hosted); it edits this repo over the
# GitHub API. These entries must keep writing the same paths/formats the build-time readers expect — see
# docs/dev/pages-cms-migration.md. A save is a commit, which triggers a rebuild that bakes content in.

media:
  input: public/uploads      # REVIEW: where rich-text image uploads are committed
  output: /uploads           # REVIEW: public URL prefix for those images

content:
  # public-facing pages -> src/content/pages/<slug>.mdoc (rendered by src/pages/[...slug].astro)
  - name: pages
    label: Pages
    type: collection
    path: src/content/pages
    format: yaml-frontmatter
    filename: '{primary}.mdoc'   # see "Slug behavior" note below
    subfolders: false
    view:
      primary: title
      fields: [title, pubDate]
      sort:
        - field: pubDate
          direction: desc
    fields:
      - name: title
        label: Title
        type: string
        required: true
      - name: description
        label: Description
        type: text
        description: Short summary for search engines and link previews (~130–160 characters).
      - name: pubDate
        label: Last updated
        type: date
        options:
          format: yyyy-MM-dd     # must stay YYYY-MM-DD; content.config.ts coerces it to a Date
      - name: body
        label: Content
        type: rich-text          # writes the markdown body of the .mdoc file

  # site title/description -> src/content/settings/site.json
  - name: site_settings
    label: Site settings
    type: file
    path: src/content/settings/site.json
    format: json
    fields:
      - name: title
        label: Site title
        type: string
        description: Leave blank to use the built-in default (src/consts.ts).
      - name: description
        label: Site description
        type: text
        description: Leave blank to use the built-in default.

  # header navigation -> src/content/settings/navigation.json
  - name: navigation
    label: Navigation
    type: file
    path: src/content/settings/navigation.json
    format: json
    fields:
      - name: links
        label: Header links
        type: object
        list: true               # array of objects -> matches { links: [...] }
        fields:
          - name: label
            label: Label
            type: string
          - name: href
            label: Link
            type: string
            description: An on-site path like /about or a full URL.

  # footer -> src/content/settings/footer.json
  - name: footer
    label: Footer
    type: file
    path: src/content/settings/footer.json
    format: json
    fields:
      - name: organization
        label: Organization
        type: string
      - name: tagline
        label: Tagline
        type: text
```

**Slug behavior (decide explicitly):** Keystatic let the editor set the URL slug independently of the
title. Pages CMS derives the filename from the `filename` template. With `'{primary}.mdoc'` and
`primary: title`, renaming a page's title changes its filename and therefore its URL. Confirm
`src/pages/[...slug].astro` keys the route off the entry filename (it does today — that is how Keystatic
worked too), then choose: accept title-drives-slug (simplest, fine for this small site), or give editors
a dedicated slug field and template the filename off it. Document whichever you pick.

**Markdoc caveat:** `rich-text` emits standard Markdown into the `.mdoc` files. Plain Markdown is valid
Markdoc, so `@astrojs/markdoc` renders it unchanged. Markdoc-specific tags (`{% ... %}`) cannot be
authored through `rich-text` — but Keystatic's `fields.markdoc` was likewise markdown-first here, so this
is not a regression. If raw Markdoc tags are ever needed, use a `code`/`text` field instead.

## Step 2 — Remove the Keystatic integration and its workarounds

- `package.json`: remove `@keystatic/astro` and `@keystatic/core`; run `npm install`.
- `astro.config.mjs`: remove `import keystatic from "@keystatic/astro"`, remove `keystatic()` from the
  `integrations` array (including the `process.env.DISABLE_CMS ? ... ` conditional spread), and **remove
  the entire `vite.optimizeDeps` block** — it exists only to make Keystatic load in workerd. Rebuild to
  confirm nothing else relied on it.
- Delete `keystatic.config.ts`.
- Delete `src/middleware/keystatic.ts`.
- `src/middleware/index.ts`: remove `import { keystaticRuntimeEnv } from "./keystatic"` and remove
  `keystaticRuntimeEnv` from the `sequence(...)`. Update the explanatory comment above it.
- Delete `docs/dev/keystatic.md` (superseded by this file and the new ops doc in step 5).

## Step 3 — Remove the in-app `/keystatic` access gate

`src/middleware/identity.ts` gates `/keystatic` and `/api/keystatic` with the `cms_editor` role. Those
routes no longer exist, so remove that logic:

- The `isKeystaticUi` / `isKeystaticApi` block and its `cms_editor` check (~lines 236–248).
- `"keystatic"` from the path-allow conditional (~lines 150–151).
- The `/keystatic` bullet in the route-protection doc comment (~lines 136–141).

Decide what to do with the now-unused `cms_editor` permission / `siteeditor` role (see `lib/api/authorize.ts`):
either keep it for other purposes or remove it. Check `src/lib/api/types.d.ts` for Keystatic-related types
and drop them.

**Access-control consequence — surface this to the project owner.** CMS access is no longer gated by the
app's IAM role. With Pages CMS, anyone who can sign into Pages CMS *and* has access to the repo (or is
added as a Pages CMS collaborator) can edit content. To keep control tight: manage repo collaborators
deliberately and/or self-host Pages CMS. This is the main behavioral change of the migration.

## Step 4 — Give editors a way to reach the CMS

Keystatic was linked in-app at `/keystatic`. Replace that with a link to the external CMS. Check
`src/components/AdminHeader.astro` (and anywhere else that linked `/keystatic`) and point it at the Pages
CMS URL for this repo, e.g. `https://app.pagescms.org/<owner>/<repo>` (hosted) or the self-hosted URL.

## Step 5 — Set up Pages CMS access (manual, external)

Document this in a new `docs/dev/pages-cms.md` (ops notes) and have the owner perform it:

1. Go to `app.pagescms.org`, **sign in with GitHub**.
2. Install the **Pages CMS GitHub App** on the account/org that owns `micawoken/entrusting-devilish-fish`,
   granting access to that repo.
3. Open the repo in Pages CMS; it reads `.pages.yml` from the default branch and renders the editor.
4. For tighter control or no third-party dependency, **self-host** Pages CMS on Vercel/Node instead (it
   is open source: https://github.com/pages-cms/pages-cms) and create your own GitHub App. Self-hosting
   is the recommended path if the access-control change in step 3 is a concern.

No environment variables or secrets are added to *this* project — that was a Keystatic requirement and is
gone. The publish flow is unchanged in spirit: edit in Pages CMS → commit → rebuild bakes content in.

## Step 6 — Update stale "Keystatic" references and verify

- Update comment wording (Keystatic → "the CMS") in: `src/content.config.ts`, `src/lib/content/nav.ts`,
  `src/lib/content/site.ts`, `src/lib/content/footer.ts`, `src/components/PublicHeader.astro`,
  `src/components/PublicFooter.astro`. Logic stays the same.
- `grep -ri keystatic` to confirm nothing remains except history.
- `npm run build` and `npx tsc --noEmit` must pass.
- Smoke test: edit a page and a setting in Pages CMS, confirm the commit lands with the **same file
  paths/format** as the table above, pull, and confirm the site builds and renders the change.

## Net effect

The migration is mostly *deletions*: the `@keystatic/*` deps, the config, the middleware shim, the
`optimizeDeps` workaround, and the in-app gate all go away, replaced by one `.pages.yml`. The content
files and every reader are unchanged. The only genuinely new consideration is the access-control model
(step 3).
