---
title: Site Management
description: Manage site configuration
author: Michael Wong
---

## Overview

The Site Management section covers operational tasks for the public-facing site. The following actions are available from the [Site menu](/admin/site):

- **Search database** - search by keyword across the database;
- **View site info** - view version metadata about the current site
- **View site analytics** - if enabled, view Cloudflare Web Analytics for the website
- **Access EmDash CMS** - open the EmDash CMS editor in a new tab
- **Rebuild site** - trigger a rebuild of the public site
- **Purge cache** - invalidate cached database responses

## Database Search
You can use database search to search by keyword across the database.

## Site Information
### Version Metadata
**View site info** allows you to access information about this version of the website code. This includes the ID of the website code build, the date/time it was built, and configuration information on the page.

### Analytics
If activated, you can view page analytics and see what pages are accessed most frequently.

## EmDash CMS
EmDash CMS is the primary content management system used to create website pages. See the EmDash CMS documentation to review instructions.

## Rebuild Site
When you make edits to the website, including changes to the database and creating new website pages, they are not published immediately, *even if you press "Publish."* To complete publication, you need to **rebuild the site.**

Rebuilding the site commands a Cloudflare Builds instance to regenerate the website and connect the new version to the Internet. Builds take approximately 75-90 seconds to complete.

You can check if the rebuild succeeded by using **View site info** - check the timestamp at the top.

You can only initiate a rebuild *at least 30 minutes after the last rebuild.* (Administrators are subject to a 3-minute cooldown.)

## Purge Cache
When you edit the database, we don't immediately update other references to the database in the website's memory. This may cause search results and views of database records to be outdated.

To fix this, you can **purge the cache**: this deletes our temporary copies in our memory of the database, making your results correct immediately. However, **you do not need to do this**: your work was saved, and any visual problems you see are temporary and will go away over time.