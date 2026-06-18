---
title: Adding Website Pages
description: Instructions to add a new public-facing website page
author: Michael Wong
---

## Overview

This page explains how to add a new public-facing page to the website by writing a Markdown file. You
do not need to know how to program — Markdown is a simple way to write formatted text (headings,
lists, links, bold, and so on) in a plain text file. If you can write an email, you can write a
Markdown page.

Because the site is built with Astro, dropping a Markdown file into the right folder is enough to turn
it into a real page on the website. The rest of this guide walks through the details.


NOTE TO SELF - add info related to editing navigation components, etc.

## Video Guide

(YouTube embed)

## What is Markdown (.md)?

Markdown is a markup language written in plain text that allows you to easily incorporate structure and style into a piece of text. For example, you declare headings using `#` symbols and mark text as bold using `**double asterisks**`.

```markdown
# Heading 1 (big)
## Heading 2 (smaller)
### Heading 3 (even smaller)
[...]

You write text normally as if you were using Microsoft Word or Google Docs. When you want to **bold** text, you wrap it in two asterisk symbols, like this: `**bold**`. To make text *italic*, you use only one, like this: `*italic*`.

When you write a list, the Astro Markdown parser will automatically convert your list to show properly. You can use two types of lists:

An unordered bullet, like this:
- a bullet (entered as `- a bullet`)
- another bullet

An ordered list, like this:
1. a numbered item (entered as `1. a numbered item`)
2. another item


To add [a link](https://google.com), use the following format:
`[text that the link is attached to](https://the-link-you-want-to-go-to.net)`

To add an image, use the following format:
`![description of the image](absolute or relative URL of the image)`
```

When Astro builds the website, your Markdown files will be automatically converted into HTML that browsers understand using pre-written page templates.

Small bit of nuance: Astro will specifically compile [GitHub-flavored Markdown](https://github.github.com/gfm/), which is a specific and standardized version of Markdown. Reference the linked specification for more syntax information. 

## What is Markdown with JSX Extensions (.mdx)?

For almost everything you need to do, a normal `.md` file is fine. However, certain use cases require that code be able to run when the page is loaded.

Markdown with JSX Extensions (`.mdx`) allows for the embedding of components (like those used in React) using some programming features borrowed from JavaScript. You would only use `.mdx` if you want to add interactivity into your body text, so it is unlikely you will ever need to write this file.

## How do I write a Markdown file?

### Page metadata you must include

For Astro to correctly process your `.md` file, there is a section at the top of every file that begins and ends with three dashes (`---`). The section enclosed by these dashes comprises the frontmatter: it tells Astro how to build your page and what additional information (such as, but not limited to, the page title, page description, and author) to include when doing so.

The specific frontmatter data you must set depends on what type of page you are building. When writing public-facing pages, you will be using the PublicPage.astro layout, which requires a title, a description, and a last updated date.

It is formatted as follows:
```markdown
---
layout: ../layouts/PublicPage.astro
title: A New Public Page
description: A description of the new public page; it should be 130 to 160 characters long (about 30-40 words).
pubDate: MM/DD/YYYY
---
```

#### The layout field
The content of the layout field points to the relative file path of the layout folder. Therefore, the file path may begin with `".."`, which moves to the parent directory.

If you are putting your new page in src/pages (the default directory, to load at TBDTBD.com/your-new-page), your layout path is `../layouts/PublicPage.astro`. If you create a new folder and put a page in that folder (src/pages/new-folder, to load at TBDTBD.com/new-folder/your-new-page), you need to add another `../` to the beginning of the path, which looks like `../../layouts/PublicPage.astro`.

**If the layout field is incorrectly set, your page will not load.**

### Page body

Everything after the closing `---` is the page content, written in Markdown as described earlier. For
example:

```markdown
---
layout: ../layouts/PublicPage.astro
title: New Page
description: A fun new page
pubDate: 06/07/2026
---

## Hello

This is a new page. This is a **bold** point, and this is a link to [another page](/about).
(...more stuff here)
```

## How can I easily make a Markdown file?

You can write Markdown in any text editor or word processor, saving the file with a `.md`
extension. Refer to the [language specification](https://github.github.com/gfm/) for more information.

### Using Microsoft Word, then converting to .md
If it's easier, you can write the page in Microsoft Word or Google Docs, save as a `.docx` file, then convert it to Markdown.

Here is how to do that:
1. Write and format your page normally in Microsoft Word or Google Docs. Make sure to use your word processor's text styles for headings.
2. Save or export your file as a `.docx` file.
3. Use an online tool such as [Word2MD](https://word2md.com/) or a desktop program such as [Pandoc](https://pandoc.org/) to perform the conversion to GitHub-flavored Markdown.
4. Add or write the front-matter block in your text editor (such as Windows Notepad or macOS TextEdit) or code editor (such as Visual Studio Code).
5. Scan your file to make sure the conversion completed correctly.

## How do I add and preview the page?

The page becomes a route based on where you put the file:

- A public page goes in `src/pages`. For example, `src/pages/welcome.md` becomes the page at
  `/welcome`. (For more on how the folders map to URLs, see the [Codebase doc](/admin/docs/codebase).)
- Choose a clear, lowercase filename with no spaces — it becomes part of the web address.

To preview your work before publishing, someone running the project locally can start the development
server (`npm run dev`) and open the page in a browser; it updates as you edit. If you are not set up to
do that, you can still publish to the staging branch first (see below) to preview on the live staging
site before it reaches production.

## How do I publish the page?

Publishing a page means getting your file into the repository and then rebuilding the site. In short:

1. Add your `.md`/`.mdx` file to the src/pages folder (and a subfolder, if you are putting it there)
2. Commit your change:
- At GitHub.com: commit your change immediately using the screen dialog
- On your computer: run `git add .`, then `git commit -m "(your message goes here...)"`, then `git push origin development` in your operating system terminal
3. At GitHub, create a pull request to staging from development.
4. Review and approve your pull request.
5. Wait for the staging site to build. To monitor the status, go to the "Actions" tab on GitHub and verify the staging deploy process succeeded.
6. Visit your new page at the [staging site](https://spot-kilmer-violin-website.mwmsc.workers.dev).
7. If the page is satisfactory, create a pull request to main from staging.
8. Approve the pull request. Once the automated build is complete, your page will now be live.