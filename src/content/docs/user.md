---
title: User Management
description: Manage user status, administrator status, and API access
author: Michael Wong
---

## Overview

User management allows you to control existing users on the system. The following actions are available from the [User Management menu](/admin/user):

- **Activate user account** - Activates a user account, allowing it to work on the site
- **Deactivate user account** - Deactivates a user account, stopping permissions
- **Promote user to administrator** - Elevates a user to administrator, allowing unrestricted access
- **Demote user from administrator** - Lowers a user to standard, using roles-based permissions
- **Manage API tokens** - Create/revoke your API tokens
- **Manage build tokens** - Create/revoke build tokens

*Note: these functions work with the operations in [Identity and Access Management](/admin/iam): IAM creates/edits records, while User Management controls how they are used.*

## Active Status
Only accounts that are active can contribute to the project, including creating/editing/deleting records.

Accounts can be activated or deactivated with the relevant links by supplying their login emails. **To perform these operations, you must have user management permissions or be an administrator.**

## Administrator Status
Administrators are granted system control of the database. This includes, but is not limited to:
1. Access to the database terminal;
2. Access to the build token system;
3. Create/update/delete permissions on all contributors;
4. Create/update/delete permissions on IAM;
5. Activating/deactivating and promoting/demoting any user; and
6. Bypassing the contribution edit lockout.

Accounts can be promoted to or demoted from administrator using the relevant links by supplying their login emails. **To perform these operations, you must be an administrator.**

## API Tokens
Any active user can create API tokens to programmatically access database services using their custom code. API tokens are user-scoped: permissions of the API token are connected to the permissions of your user account.

The API tokens feature is not intended for general use: to access the API with a token, you must present that token in the Authorization header **and a Cloudflare Access Service Token.** To receive a service token, contact [contact@michaelwongmusic.com](mailto:contact@michaelwongmusic.com).

### Build tokens
Administrators can use a build token to use during website generation. Build tokens provide list-only limited access to the database. Data from build token requests is used to render pages during the build process before the new website is published.