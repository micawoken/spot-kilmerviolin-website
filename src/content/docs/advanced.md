---
title: Advanced Options
description: View advanced options documentation
author: Michael Wong
---

## Overview

The Advanced Options section organizes several unusual actions that don't organize well with the other main categories.

These actions include:
- **Database Terminal** — run raw SQL directly against the database.
- **Promote to Administrator** — grant a user administrator permissions.
- **Demote from Administrator** — remove a user's administrator permissions.
- **Self-Enrollment** — complete your own contributor record if your login is not yet linked to one.

## Video Guide

(YouTube embed)

## Database Terminal

This option is provided to administrators to diagnose why issues may be occurring with the project database. The page provides administrators a method to write and execute raw SQL commands against the SQLite database and read the raw response from Cloudflare D1.

This tool is not designed for general use - the response you will read is the JSON-encoded object from D1, which may include additional information about your command.

**Do not use this tool if you do not know what you are doing.** Making a mistake on the terminal, such as deleting the contributors table, will cause Administrative Services to stop working for everyone. Before running a command here, you should have a good understanding of the SQL database language.

If you make a mistake, you have a few days to correct it: contact the system administrator to recover the data.

## Promote to Administrator

This option allows administrators to add additional administrators. An administrator has full control over the database, IAM, and site management.

## Demote from Administrator

This option allows administrators to remove an existing administrator.

Before running this operation, understand the following:
- Demotion only removes administrator status. It does **not** deactivate the account or remove any
  roles the user has.
- The reverse is also true: deactivating an administrator's account does **not** strip their
  administrator permissions. An inactive administrator still has full authorization and can maintain the database indefinitely. To actually revoke administrator access, you must demote them here.
- **Do not accidentally demote yourself.** If you do, you will lose access to all administrator pages and
  another administrator will have to restore your access. The page will warn you if you enter your own
  email.

## Self-Enrollment

The self-enrollment process exists because authentication (Cloudflare Access) and authorization records (contributor records) are maintained separately but must be matched using the identity email. Self-enrollment allows users with authentication to create a least-privileged authorization record.

To perform self-enrollment, an authenticated user must not be matched to a contributor record, and the system must have self-enrollment enabled.