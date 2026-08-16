---
title: Identity & Access Management
description: Manage administrator identities, access, and account status
author: Michael Wong
---

## Overview

The Identity & Access Management section controls who may access the administrative services and what they may do. The following actions are available from the [IAM menu](/admin/iam):

- **My authorization info** - view your authorization info
- **Add new user** - add a new user for login
- **List users** - show all users who can log in
- **Add or remove roles** - self-explanatory
- **Change sign-in email** - change a user's login email
- **Delete user** - remove a user from login

## IAM Functions
Identity & Access Management (IAM) manages how the administrative services:
1. Prove who you are (authentication) so you can access the service; and
2. Give you the appropriate permissions (authorization) on the service.

As such, IAM services affect whether you can log onto the administrative services and what you will be able to do once you log on.

### Overlap with contributor records
**IAM add/remove user controls only control whether they can log into the system; they do not control what they do if they can login.** If you delete a user from IAM, but do not deactivate their record, *someone else could re-add them, and they could come back with full permissions.*

Similarly, if you deactivate a contributor record, *the user can still sign in.* (What they can do when deactivated depends on whether they are an administrator.)

## My Info
You can view your user authorization information using **My authorization info**. It shows your:
- Login email,
- User account type (standard or administrator),
- Roles, and
- Three yes/no values:
  - Allowed: whether the system has connected your login email to a contributor record (by login email);
  - Active: whether your account is active according to your contributor record; and
  - Enrollable: whether your account is eligible for self-enrollment.

## Adding/Removing Users
### Add user
Use **Add new user** to add a new user with their login email.

You may optionally use *auto-enrollment*: this creates their contributor record automatically, with a name and optional major and class year. Auto-enrollment exists to:
1. Bypass self-enrollment; and
2. For permissions conferral (see below).

#### Confer permissions
In auto-enrollment, you can give the new user the roles you have that are conferrable. For example, if you have the reviewer role, you can enable confer to give them the reviewer role. *Not all roles are conferrable.*

### Remove user
Use **Delete user** to remove a user with their login email.

By default, auto-deactivation is enabled: the system will automatically deactivate their contributor record, preventing them from editing the database. (If they are an administrator, deactivation does not work; see [User Management](/admin/user).)

## Role and Email Management
Use the relevant links to perform these operations.

The available roles are:
- reviewer: grants permission "overrides_lockout", allowing modification of compositions that one is not a primary on (conferrable)
- userenroll: grants permissions "user_activation" and "user_addition", allowing adding new IAM users and activating contributor accounts (not conferrable)
- siteeditor: grants permissions "cms_editor", "design_editor", and "rebuild", allowing for site content, design, and publication permissions
- designer: grants permissions "design_editor" and "rebuild", allowing for site design and publication permissions
- pagewriter: grants permissions "cms_editor" and "rebuild", allowing for site content and publication permissions