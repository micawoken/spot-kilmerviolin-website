# lib/public

## Overview
ES modules in lib/public provide abstraction over the fundamental database-layer APIs in lib/api and provide other services intended to be more user-facing.

## By-file
 - ratelimit.ts - Implements Cloudflare Rate Limiting on the API, administrator pages, and search
 - search.ts - Provides functions to administer a public API endpoint performing search on the database
 - usermgmt.ts - Provides functions to administer the administrator user add, update, and delete