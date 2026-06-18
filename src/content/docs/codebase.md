---
title: Quickstart and Folder Structure
description: Overview of the structure of the repository folder
author: Michael Wong
---

## Overview

This doc outlines how this project's files, pages, and code are organized. You should read this first before reviewing other documentation pages.

You do not need to understand every part of this document. To get the essential information, review the next three large sections, or you can watch the video guide.

## Video Guide

(YouTube embed)

## Key Technologies to Understand

You will see these names in the docs that you should understand:
- **Astro** — [Astro](https://astro.build) is the website framework used to build this website. Its purpose is to read the files in this project and generate a website from it.
- **Cloudflare** — Cloudflare is an Internet infrastructure company that will host our website for a very low cost. It provides several technologies to make this work:
  - **Cloudflare Workers** — runs the website: it spins up a small web server every time someone wants to access the website.
  - **Cloudflare D1** — stores the project database. You will use Administrative Services to interact with the database to add compositions and composers.
  - **Cloudflare KV / Workers Cache API** — makes the project database faster. Stores a copy of the database that can be read faster globally.
  - **Cloudflare Access** — secures these admin pages. Requires that you must be registered with the system and sign in with Google before editing.

You should also know the following about URLs:
- URL path: the part of the URL after the first forward slash: `https://www.google.com/`*path-to-page*


## Quick Start
If you want to manage the project database (managing composers and compositions), review the composers and contributors documentation. You can also explore the Admin home page - these operations can be run fully in your browser.

If you want to add a page on the website, review the *Adding pages* guide.

## Folder Structure Overview
When you view the project's code on GitHub, you will see the following folders:
- public - stores website assets
- src - stores most of the website
- tests - stores database tests to make sure the website works correctly
- tests_local - stores special database tests run separately if needed

You will use the *src* folder for all changes. Here are the folders that matter:
- src/pages - new website pages go in this folder. You can also create a folder in src/pages if you want to add another path component: for a path */path-to-page*, if you move path-to-page.md from src/pages to src/pages/special, the new URL path is */special/path-to-page*
- src/files - image files that ship with the site itself. Drop image files here; on each build they are optimized and published, and the [file picker](/admin/docs/files) on the entity forms offers them when you fill in an image. (To upload images at runtime instead, use [File Management](/admin/docs/files).)
- src/content - new website posts that appear in a series (such as for a blog) go here. No blog is currently set up, so this isn't needed.

You can review the rest if you like. It will probably be more useful to watch the videos and, if you still have questions, to contact Michael Wong at [contact@michaelwongmusic.com](mailto:contact@michaelwongmusic.com).

## src/lib

`src/lib` stores the foundational code that powers the website and its connection to the database.

There are two folders in `src/lib`:
- **`src/lib/api`** — the machinery that enables access to the database, provides an interface to the database for other pieces of code, and provides other low-level system services.
  - `database.ts` — high-level get/add/update/delete functions, used by other high-level libraries
  - `d1.ts` — direct access to D1 (SQL), and exports specifications about the SQL tables
  - `common.ts` — shared system helpers
  - `http.ts` — processing HTTP requests and responses
  - `authenticate.ts` / `authorize.ts` — proving who you are and what you are allowed to do
  - `caching.ts`, `kv.ts` — caching layers in front of D1
  - `r2.ts`, `images.ts`, `files.ts` — the file store: low-level R2 access, image optimization (via the
    Cloudflare Images binding), and the cached service layer in front of them. `files.ts` is to R2 what
    `database.ts` is to D1. See [File Management](/admin/docs/files).
  - `access_iam_mgmt.ts` — talks to the Cloudflare API to manage who can sign in.
  - `search.ts`, `country.ts`, `rebuild.ts`, `verinfo.ts` — keyword search, country-code validation,
    triggering rebuilds, and reporting build info.
  - `types.d.ts` — the shared type definitions (`Composer`, `Composition`, `Contributor`, `Identity`,
    and their database counterparts). A good place to start if you want to understand the data model.
- **`src/lib/public`** — high-level logic that supports the admin pages and user-facing flows, such as
  `authservice.ts` (the per-request permission check), `usermgmt.ts` (user creation/enrollment),
  `validation.ts` (checks if an email is valid), and `ratelimit.ts` (implements rate limiting).

## src/content

`src/content` holds Markdown content managed as Astro content collections (configured in
`src/content.config.ts`):

- **`src/content/docs`** — these documentation pages

## src/pages

`src/pages` defines the site's URLs. Astro will convert the path of every file in this directory (minus `src/pages` and the file extension) to the exact URL path.

**`src/pages/*`** stores public-facing pages, such as the home page (`index.astro`), about page (`about.astro`), and admin page (`admin.astro`).

**`src/pages/admin/*`** — the admin pages

**`src/pages/api/v1/*`** — the Administrative Services API, which powers the admin pages

## src/components and src/layouts
Astro files (`.astro`) use components and layouts to build website pages from smaller reusable pieces.

- **`src/components`** — reusable pieces of website HTML and code
- **`src/layouts`** — a website template that body content can be dropped into

## src/middleware
Before every server-side rendered request, Astro will run several checks to see what type of request you are making.

These checks will run before server-side code runs:
1. Whether your request is a CORS preflight request (if so, it will respond automatically)
2. Whether you are signed in to Cloudflare Access (if so, generate a server-side Identity object)
3. Whether your request is subject to a rate limit.

## public/*

The `public` folder holds static files that are served exactly as-is, at the root of the site — things
like the favicon, images, and other assets that do not need processing. A file at `public/image.jpg` is
reachable at `/image.jpg`.
