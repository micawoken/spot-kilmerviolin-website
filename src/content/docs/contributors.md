---
title: Contributors
description: View contributor documentation
author: Michael Wong
---

## Overview

The Contributors section lets you maintain the contributor records associated with the project. The following actions are available from the [Contributors menu](/admin/contributors):

- **Add new contributor** - create a new contributor record
- **View contributor info** - look up an existing contributor
- **Edit existing contributor** - change a contributor's details
- **Delete contributor** - permanently remove a contributor
- **List contributors** - browse all contributors currently stored
- **Import contributors** - import contributors to the database

## Contributor Records
A contributor record represents two things:
1. the identity of an individual who contributes to the project (to assign credit), and
2. the identity of a logged-in user who has access to the administrative service (to provide authorization).

### Methodology
It was technically simpler to have a single record that performs both functions; otherwise, two tables would need to be kept in sync, each representing mostly the same information. However, careful system design is the trade-off, making sure that users cannot perform privilege escalation.

### Permissions warning
**To perform most operations on this page, you must be an administrator.** Since contributor records contain user authorization information, and only administrators are allowed to change user authorization information, only an administrator can create, modify, or delete a contributor.

Administrators can be managed using [User Management](/admin/user).

**If you have the userenroll role, you should use the options in [Identity and Access Management](/admin/iam).** These will allow you to create and activate contributor records, including for new system users.

## Create/Read/Update/Delete Contributors
To do these operations, access the relevant link.

If you are an administrator and want to edit another individual's composition, you must check the box in the Administrative Options to use admin elevation. By default, the system will not permit you to perform the operation unless you explicitly request that your administrator status be used to do so.

### Automatic data redaction
By default, you cannot view the following information if you are not an administrator:
- identity_email: the email used to log in;
- admin: if the user is an administrator;
- roles: the roles the user possesses.

This is enforced at the server: your computer never receives the complete record, so it is impossible to access.

## Import Contributors
To import a contributor, you need to upload a CSV file in the following format:
- header row: "name" in column 1
- remaining rows: list of names in column 1

**You must be an administrator to perform this operation.**

Follow the load, server-side validation, and import process. (Make sure there are no duplicated names, or the import will fail.) By default, these contributors are created with zero permissions.

## Questions
Any questions? Contact [contact@michaelwongmusic.com](mailto:contact@michaelwongmusic.com).