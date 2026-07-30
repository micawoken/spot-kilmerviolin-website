---
title: Advanced Options
description: View advanced options documentation
author: Michael Wong
---

## Overview

The Advanced Options section organizes several special-purpose and rarely-used operations. In general, you are unlikely to ever use them, but they are provided for convenience.

These actions are:
- **Access database terminal** - allows administrators to run arbitrary SQL queries against the database
- **View entity metadata** - allows users to view creation/last modification data
- **View self-enrollment flow** - allows un-enrolled users to perform self-enrollment to create their contribution record
- **Manage design pages** - allows design editors and administrators the ability to create custom pages
- **Manage design templates** - allows design editors and administrators the ability to create templates to automatically build page collections (for composers, contributors, compositions, default pages, and others)
- **Manage design theme** - allows design editors and administrators the ability to modify design standards on the site

## Database Terminal
The database terminal is a SQL terminal provided to administrators. The terminal allows them to run arbitrary SQL queries. If you do not know what you are doing, *do not use the terminal*. A bad command could break the database or inject a bad configuration.

## Entity Metadata
By default, the creation and last modification date are not exposed when you view a database record. You can use the entity metadata tool to view this information for any record.

## Self-Enrollment Flow
When a user is allowed to login but does not have a contributor record, they cannot do anything until they have a contributor record, and they cannot create a contributor record. To fix this circular problem, self-enrollment allows the creation of a contributor record with zero permissions.

Self-enrollment is only enabled if the Worker configuration variable in wrangler.jsonc enables the feature. Otherwise, an individual with IAM or administrator permissions needs to create the record or perform autoenrollment.

## Design Pages
*In general, you should use EmDash for content pages.* However, if you need specific features on the page, such as buttons, you can use a design page.

Design pages should be configured for:
- The home page (using the slug "home"), and
- The 404 Page Not Found page (using the slug "404").

Other pages can be created, so long as the slug is not used in EmDash.

## Design Templates
All content is routed through a design template for rendering. A design template tells the website builder where information goes on the page and how it is organized.

The template builder is a quasi-WYSIWIG editor: you drag and drop blocks containing template fields and static text/image components. It is the same interface as design pages.

## Design Theme
While a design template controls where stuff goes, the design theme controls how it looks. You manage fonts, colors, spacing, and style here, to change how the website looks.

## Questions
Any questions? Contact [contact@michaelwongmusic.com](mailto:contact@michaelwongmusic.com).