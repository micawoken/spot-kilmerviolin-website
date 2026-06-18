---
title: Identity & Access Management
description: How to manage administrator identities, access, and account status
author: Michael Wong
---

## Overview

The Identity & Access Management section controls who may access the administrative services and
what they may do. The following actions are available from the [IAM home](/admin/iam):

- **Add** — grant a new identity access.
- **Edit** — change an identity's details or permissions.
- **Activate / Deactivate** — enable or suspend an identity's access.
- **Remove** — revoke an identity's access entirely.
- **List** — browse all identities currently registered.

## Video Guide

(YouTube embed)

## What is Identity & Access Management (IAM)?
Identity & Access Management (IAM) manages how the administrative services:
1. Prove who you are (authentication) so you can access the service; and
2. Give you the appropriate permissions (authorization) on the service.

As such, IAM services affect whether you can log onto the administrative services and what you will be able to do once you log on.

### Data model
(you can skip this section, but it may help with understanding how security works on this site)
IAM is implemented in two parts:
 - Authentication is managed by Cloudflare Access: a common Access policy is used to protect /admin and /api.
 - Authorization is managed in contributor records using the admin, roles, and active properties.

These parts are connected using a contributor record's identity_email property. Once authentication passes, administrative services extracts the user's email, which is encoded in base64 and cryptographically verified in the Cloudflare Access JavaScript Web Token passed in via cookies. The identity middleware will perform a lookup of the extracted email, and the system will build an Identity object using the matched contributor record.

The Identity object contains three boolean values:
1. Allowed - whether the identity has successfully linked with a contributor record.
2. Active - whether the contributor record indicates the record is active; and
3. Enrollable - whether there is no record, and the system allows self-enrollment.

Most services require that a user be both allowed and active. Some pages related to profile management only require allowed, and the self-enrollment flow requires enrollable.

## How do I add a user who can log onto the system?
Use **Add user**. By default, unless the email you provide is associated with a contributor's sign-in email, they will not be able to modify the database until they perform the self-enrollment process.

If you prefer, you can create a contributor record for them by using auto-enrollment during the **Add user** process to provide their name (and optionally their major and class year) so they can log on immediately.

By default, when you create a new user (with self-enrollment or auto-enrollment), they cannot make contributions. An administrator must activate their account using **IAM > Activate user**

To perform this operation, you must either be an Administrator, or you must possess the userenroll role.

## How do I activate/deactivate a user?
Use **Activate user** or **Deactivate user**! To perform this operation, you must be an Administrator.

## How do I edit a user?
You can edit a user's roles using **Edit user**. You must be an Administrator to do this.

### Extended operations using the API
If you are comfortable writing an API call, you can send an HTTP PATCH request to /api/v1/identity to perform multiple transactions related to identity emails, role modifications, user additions, and user deletions. Review the API doc for more information.

## How do I delete a user?
Use **Delete user**. You must be an Administrator to do this.

Please note that deleting a user does **not** delete their associated contributor record.