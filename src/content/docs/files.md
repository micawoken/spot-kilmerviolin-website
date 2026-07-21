---
title: File Management
description: How to upload, manage, and reference image files stored in the file store
author: Michael Wong
---

## Overview

Some database fields, such as image URL, are used to display website media. To simplify how website media is managed, you can use the File Management system to upload, retrieve, replace, and delete media stored on our servers.

The following actions are available from the [File Management home](/admin/files):

- **Add new file** — upload a file (images are optimized automatically). Alt text is required.
- **View file info** — see a file's key, URL, type, size, dimensions, and alt text; alt text can be
  edited here without re-uploading the file.
- **Replace existing file** — swap new bytes in while keeping the same key (and existing references).
  Alt text is required here too.
- **Delete file** — permanently remove a file.
- **List files** — browse every stored file with previews.

### Alt text

Every uploaded file requires alt text (up to 256 characters), describing the image for screen readers
and search engines. It is set when a file is uploaded or replaced, and can be edited afterward from a
file's info page. Files added to `src/files` (see below) require alt text too, supplied as a sidecar text
file rather than through the admin interface. Because of this, a `.txt` file placed in `src/files` is
always treated as an alt-text sidecar and is never itself published as a servable asset.

## Video Guide

(YouTube embed)

## Storage Architecture

(you can skip this if you are looking for instructions)

We store images in two places:
1. In the project repository, in the folder src/files, and
2. In Cloudflare R2 object storage.

Images in the src/files folder do not consume cloud storage limits and are not deleteable without a git commit. Images in Cloudflare R2 can be modified by an active user but consume storage limits.

It is encouraged to use the src/files store as much as possible.

### Identifying files
Files, after uploading, are assigned a unique file key. This key is used to look up the file and is based on the file name. You can use the built-in search function to search for file keys.

### Image optimization

When you upload an image, it is automatically converted to an efficient web format (WebP) and scaled
down so it is no wider than 1600 pixels. We do this to conserve storage space.

## Adding a File
You can either:
1. Use [Add new file](/admin/file/add), entering the required alt text alongside the image, or
2. Add the file to the src/files folder along with a same-named `.txt` sidecar carrying its alt text
   (e.g. `composer-portrait.jpg` needs `composer-portrait.jpg.txt`, 1-256 characters), commit both files
   to the development branch on GitHub, and follow the deployment verification process. A missing or
   oversized sidecar fails the build.

## Viewing a File
Use [View file info](/admin/file/view).

## Replacing a File
This depends on where it is stored:
- If it is in the cloud: use [Replace existing file](/admin/file/edit)
- If it is in src/files: replace the file in the repository, commit the change, and follow the deployment verification process.

## Deleting a File
This depends on where it is stored:
- If it is in the cloud: use [Delete file](/admin/file/delete)
- If it is in src/files: delete the file in the repository, commit the change, and follow the deployment verification process.

## For developers

The file store is built in layers, mirroring the database stack:

- `src/lib/api/r2.ts` — thin R2 primitives (put/get/head/list/delete) plus storage-cap enforcement.
- `src/lib/api/images.ts` — image optimization via the Cloudflare `IMAGES` binding.
- `src/lib/api/files.ts` — the cached service layer other code should use; wraps R2 with Cache API + KV
  caching and invalidates on writes.
- `src/pages/api/v1/files.ts` and `src/pages/api/v1/files/[id].ts` — the REST endpoints (see the
  [API reference](/admin/docs/api)). `PUT` also supports an alt-text-only update (no `file` part).
- `integrations/optimize-files.mjs` — the build step that publishes `src/files`, enforcing the alt-text
  sidecar requirement.
- `src/lib/build/bundled-file-alt.ts` — reads the same sidecar files at page-build time so entity pages
  can render bundled images with real alt text.

Files are R2-only: the object key is the file's identity and metadata (including alt text) lives in the
object's customMetadata; there is no database table for files.

`/api/v1/files/{id}` requires an authenticated identity, so an entity's image field cannot reference it
directly on a public page. When rendering an entity's `image` field, `src/lib/compositor/media.ts`
resolves an `/api/v1/files/{key}` value to `FILES_PUBLIC_URL` (the R2_FILES bucket's public origin, set
in the build environment — see `.env.example`) instead, mirroring how `EMDASH_MEDIA_PUBLIC_URL` solves
the same problem for CMS media. If `FILES_PUBLIC_URL` is unset, the build fails rather than shipping a
broken image. Note the whole R2_FILES bucket is public once this origin is attached — it stores whatever
admins upload through the file library, not just entity images.
