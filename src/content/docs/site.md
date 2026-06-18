---
title: Site Management
description: How to rebuild the site, purge the cache, and view version information
author: Michael Wong
---

## Overview

The Site Management section covers operational tasks for the public-facing site. The following
actions are available from the [Site home](/admin/site):

- **Rebuild** — trigger a rebuild of the public site.
- **Purge cache** — invalidate cached responses so fresh content is served.
- **Version information** — view the deployed build and version details.

## Video Guide

(YouTube embed)

## Understanding how Database Data Updates the Website
(you can skip this section, but it may help understand when to purge the cache and when to rebuild the website)
This website is generated with the Astro framework. In this website's configuration, the public-facing content of the website is generated during a build process that accesses the database and stores static, unchanging files for the website. (Administrative services is server-side rendered, so it is not statically generated.)

The website's public content is fixed to what the database was when the build process was performed. So, when you make a change to the database, it will not affect the public website until you rebuild.

This website uses multiple levels of caching to reduce queries on the D1 SQLite database that powers the website. (I am not paying for Cloudflare Workers Paid.) Caching stores a copy of the database to serve when needed. This is helpful if the data does not change much, but as a user, you will probably change the database.

When you make a change to the database, these caches are not affected. By default, when you request information from the database, it will check the caches first, so you may see old data that does not reflect your changes. So, when you make a change to the database, you may see stale data until you purge (or delete) the cache.

## Rebuilding the Website
Use **Rebuild site** to rebuild the website. Your ability to rebuild the website is constrained by build minutes alloted by Cloudflare Worker Builds - you are granted 2000 build minutes on Cloudflare's servers, and each build takes about a minute or two. **Do not rebuild the website until you are done with editing for the day.**

## Purging the Cache
Use **Purge cache** to purge the cache. **Please do not purge the cache unless you encounter significant issues with stale data.**