# README - lib/api

## Overview
This directory stores functions and machinery used to access the databases in Cloudflare D1, Cloudflare KV, and the Cloudflare Worker Cache API. This directory also stores other machinery related to accessing the internal API, including authentication/authorization and user management.

### By file
 - authenticate.ts: stores functions related to identity authentication (proving a user is who they say they are)
 - authorize.ts: stores functions related to identity authorization (proving a user can do what they say they can do)
 - caching.ts: stores functions related to accessing the Cache API
 - common.ts: stores common library functions for the project API (mainly type conversion and string concatenation)
 - common.test.ts: a test file to demonstrate that common.ts behaves as expected
 - d1.ts: stores functions to directly access Cloudflare D1 (a SQL database)
 - database.ts: stores high-level functions to get/add/update/partially update/delete database records [functions here should be used by business logic to access the database]
 - kv.ts: stores functions to directly access Cloudflare Workers KV (a NoSQL database, used for caching SQL tables)
 - sql.ts: defines two objects, SQLStatement and VirtualSQLTable, related to defining and executing SQL commands
 - sql.test.ts: a test file to demonstrate that sql.ts behaves as expected
 - types.d.ts: common type definitions within the API

## Caching specification
See caching.ts to view the caching specification.

## Making additions
The type definitions limit the available options for work types. To add more, contact the sysadmin at contact@michaelwongmusic.com.

Very generally, adding more work types involves:
1. Adding the new value to the enum, and
2. Updating the admin interface to support the new value