# PLANNING DOC
by michael

## Task categories:
### Database primitives
 - D1 system access
 - D1 programmatic access (SQLStatement and VirtualSQLTable)
 - KV access
 - Cache API access
 - Cloudflare Access management
 - Worker Builds deploy trigger
 - Authentication/authorization
 - R2 system access (for photos)
### Database middleware
 - SQL op primitives
 - Exported database functions
### Back-end API
 - Endpoint implementation code
### Front-end page components
 - Identify what components are needed
 - Build said components
 - Build an admin page to administer it
 - Build the getStaticPages middleware to enable page generation via API


## Site build process
 - getStaticPages generates all composer, composition, and contributor pages at build time using internal API functions
 - Cloudflare Workers presumably stores all these pages as static assets
 - the API uses the aforementioned API functions to manipulate the database state (such as via the admin pages)
 - When commanded, a rebuild function can be called to perform a site rebuild on Worker Builds to update the static pages
 - Since static pages are used globally, all API endpoints require authentication

## Testing process
 - Unit tests in place for some API modules

## DevOps flow
 - Local development on VSC, synced and pushed to GitHub repository
 - GitHub Actions enforce a flow from development > staging via PR
 - GitHub Actions builds the site and deploys to workers.dev for staging
 - GitHub Actions enforce a flow from staging > main via PR
 - Worker Builds builds the site and deploys to custom domain for live viewing