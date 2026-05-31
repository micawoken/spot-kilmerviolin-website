# Diversifying the Violin Curriculum for Violin Teaching
Vanessa Cruz, Kenny Hoang, Emma Kuegel, Cam Schwind, Alyssa Spina, Michael Wong

Last updated (date tbd)

## Summary
This repository contains an Astro framework website deployable to Cloudflare Workers representing the research products of this project. The project is deployed to Michael Wong's business Cloudflare account (contact@michaelwongmusic.com), and it uses bindings and tokens from his account to access the website's databases and authentication/authorization system for administrator pages.

Guides to modify the website are available in docs/guides. For a video version, visit URL. To modify database information, such as information on a composer or composition, use the administrator page at URL and follow the instructions in docs/guides/admin.md or in this video.

Instructions provided in the guides and videos referenced earlier provide instructions on how to modify the website's content. If you have experience programming in TypeScript and want to modify the back-end API and/or the DevOps system, notes from the sysadmin are available in docs/dev. If you don't have a background in programming and/or software development, you can contact the sysadmin at contact@michaelwongmusic.com to request changes.

## Version info
Still working on it :p

## Directory structure
/src - Folder containing the website
    /components - stores React/Preact JSX/TSX website components (such as headers)
    /content - stores pages of the website
        /[...] Folders store website content
        /admin Stores administrator pages
    /docs - stores help guides and developer info
    /layouts - does something
    /lib - Stores database and business logic code
        /api - Stores database level code and primitive authorization functions
        /public - Stores higher-level and public-facing functions
    /middleware - Stores Astro middleware for processing requests
    /pages - outlines structure and composition of website
        /api/v1/ - provides API endpoints to contributors
        /admin
        /composers - Stores structure of composers page
            /[id] - Stores structure of each comopser page
        /contributors - Stores structure of contributors page
            /[id] - Stores structure of each contributor page
        /works - Stores structure of works page
            /[id] - Stores structure of each work page
        /[...] other page configs 
    