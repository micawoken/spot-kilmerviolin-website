---
title: File Management
description: How to upload, manage, and reference image files stored in the file store
author: Michael Wong
---

## Overview

Some database fields, such as image URL, are used to display website media. To simplify how website media is managed, you can use the File Management system to upload, retrieve, replace, and delete media stored on our servers.

The following actions are available from the [File Management home](/admin/files):

- **Add new file** — upload a file (images are optimized automatically).
- **View file info** — see a file's key, URL, type, size, and dimensions.
- **Replace existing file** — swap new bytes in while keeping the same key (and existing references).
- **Delete file** — permanently remove a file.
- **List files** — browse every stored file with previews.

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
1. Use [Add new file](/admin/file/add), or
2. Add the file to the src/files folder, commit the file to the development branch on GitHub, and follow the deployment verification process.

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
  [API reference](/admin/docs/api)).
- `integrations/optimize-files.mjs` — the build step that publishes `src/files`.

Files are R2-only: the object key is the file's identity and metadata lives in the object's
customMetadata; there is no database table for files.
