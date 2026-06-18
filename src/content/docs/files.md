---
title: File Management
description: How to upload, manage, and reference image files stored in the file store
author: Michael Wong
---

## Overview

The file store holds assets — mainly images — that records can reference through their **image** field.
Instead of pasting an external image URL into a composer, composition, or contributor, you can upload an
image once and point the record at it. Files live in a Cloudflare R2 bucket and are reached through the
admin file pages and the file picker on the entity forms.

The following actions are available from the [File Management home](/admin/files):

- **Add new file** — upload a file (images are optimized automatically).
- **View file info** — see a file's key, URL, type, size, and dimensions.
- **Replace existing file** — swap new bytes in while keeping the same key (and existing references).
- **Delete file** — permanently remove a file.
- **List files** — browse every stored file with previews.

## Video Guide

(YouTube embed)

## Uploading and optimizing images

When you upload an image, it is automatically converted to an efficient web format (WebP) and scaled
down so it is no wider than 1600 pixels. Smaller images are never enlarged. Only the optimized version
is kept — the original is discarded. Files that are not images (or are SVGs) are stored as-is.

Each file is identified by its **key**, which is its filename. When you upload, you may supply a name to
set the key; otherwise the uploaded file's own name is used. Filenames are sanitized to safe characters.
Because images are re-encoded to WebP, a file's stored format may differ from its key's extension — the
URL still serves the correct image.

## Referencing a file from a record (the image picker)

On the composer, composition, and contributor forms, the **Image URL** field has a **Pick file** helper.
Type part of a file name and press **Pick file** to list matching files; selecting one fills the Image
URL field with that file's address. The picker draws from two sources:

1. **Bundled images** — optimized assets published from `src/files` at build time (see below). These are
   listed first and take priority.
2. **Uploaded images** — files in the R2 store, served at `/api/v1/files/<key>`.

## Bundled images (`src/files`)

Files placed in the project's `src/files` directory are part of the codebase. During each site build they
are optimized with the same settings as uploads and published to `/files/<name>`, and a manifest is
generated so the file picker can offer them. Every file in `src/files` is published even if no record
references it. Use this for images that should ship with the site itself rather than be uploaded at
runtime.

## Storage and limits

The store runs on Cloudflare's R2 free plan. To stay within it:

- A **storage ceiling** (9 GB) is enforced on upload; an upload that would exceed it is rejected with an
  "Insufficient Storage" error. Current usage is shown on the [File Management home](/admin/files).
- File reads and writes are **rate limited** so normal use stays well under the plan's monthly operation
  allowances. If you ever hit a limit, wait a minute and try again.

## For developers

The file store is built in layers, mirroring the database stack:

- `src/lib/api/r2.ts` — thin R2 primitives (put/get/head/list/delete) plus storage-cap enforcement.
- `src/lib/api/images.ts` — image optimization via the Cloudflare `IMAGES` binding.
- `src/lib/api/files.ts` — the cached service layer other code should use; wraps R2 with Cache API + KV
  caching and invalidates on writes.
- `src/pages/api/v1/files.ts` and `src/pages/api/v1/files/[id].ts` — the REST endpoints (see the
  [API reference](/admin/docs/api)).
- `integrations/optimize-files.mjs` — the build step that publishes `src/files`.

Files are R2-only: the object key is the file's identity and metadata lives in the object's
customMetadata; there is no database table for files.
