---
title: Website Pages
description: Manage website pages
author: Michael Wong
---

## Overview
Website pages are controlled in two systems: the content-focused EmDash CMS, and the design-focused compositor system. This overview tells you how to create, update, and delete website pages.

## Which System to Use
There are two page systems you can use:
- EmDash CMS: you enter text and images into a page, and the system generates it using the default page template.
- Design pages: you drag and drop page components into a page.

**The preferred system is EmDash CMS - it is easier to manage.**

## Permissions
You must have the cms_editor permission to use EmDash CMS, and you must have the design_editor permission to use the compositor system. To publish, you must have the "rebuild" permission.

## EmDash CMS Pages
### Create
1. Visit [EmDash CMS](/_emdash/admin)
2. On the left sidebar, click "Pages" under "Content"
3. Click "Add New"
4. Enter a page title
5. Enter the page content
6. Enter a page description (required)
7. On the right panel, enter the slug: it is the path in the website where the page is located
- Example: for google.com/this/is/the/slug, the slug is "/this/is/the/slug"
8. Save your work
9. Publish when you are ready
10. To complete publication, **rebuild the site**

## Update
1. Visit [EmDash CMS](/_emdash/admin)
2. On the left sidebar, click "Pages" under "Content"
3. For the page you want to edit, click the pencil under "Actions"
4. Edit the page
5. Save, then publish
6. To complete publication, **rebuild the site**

## Delete
1. Visit [EmDash CMS](/_emdash/admin)
2. On the left sidebar, click "Pages" under "Content"
3. For the page you want to delete, click the red trash can icon under Actions

**WARNING**: when you delete a page, it goes in Trash. You may not have the permissions to empty the trash, so you may not be able to create a new page with the same slug.

## Design Pages
### Create
1. Access Advanced Options > Manage design pages
2. Under "Create a design", enter the name and slug (see earlier), and click "Create and open editor"
3. Drag and drop blocks from the catalog on the left onto the page
4. Modify block settings using the right sidebar
5. When done, click "Publish"
6. To complete publication, **rebuild the site**

### Update
1. Access Advanced Options > Manage design pages
2. Under "Existing designs", click "Open editor" for the page you want to edit
3. Drag and drop blocks from the catalog on the left onto the page
4. Modify block settings using the right sidebar
5. When done, click "Publish"
6. To complete publication, **rebuild the site**

### Delete
1. Visit [EmDash CMS](/_emdash/admin)
2. On the left sidebar, click "Designed Pages" under "Content"
3. For the page you want to delete, click the red trash can icon under Actions

**WARNING**: when you delete a page, it goes in Trash. You may not have the permissions to empty the trash, so you may not be able to create a new page with the same slug.

## Design Templates
Design templates are used to automatically build pages using database information. You can use the same steps as design pages to modify templates.

There are five special components only meant for design templates:
1. Content text: for non-database pages - contains the metadata of an EmDash CMS page (title or description)
2. Content rich text: for non-database pages - contains the content of an EmDash CMS page (formatted text and images)
3. Content image: for database pages - contains the image associated with a database record
4. Content field: for database fields - contains the value of a specific value in a record, with a label by default
5. Media + text: for database fields, puts the content image and a configurable container together

## Questions
Any questions? Contact [contact@michaelwongmusic.com](mailto:contact@michaelwongmusic.com).