---
title: Database Management - Contributors
description: How to add, view, edit, delete, and list contributors
author: Michael Wong
---

## Overview

The Contributors section lets you maintain the contributor records associated with the project. The
following actions are available from the [Contributors home](/admin/contributors):

- **Add new contributor** — create a new contributor record.
- **View contributor info** — look up an existing contributor.
- **Edit existing contributor** — change a contributor's details.
- **Delete contributor** — permanently remove a contributor.
- **List contributors** — browse all contributors currently stored.

## Video Guide

(YouTube embed)

## What is a contributor?
A contributor record represents two things:
1. the identity of an individual who contributes to the project (to assign credit), and
2. the identity of a logged-in user who has access to the administrative service (to provide authorization).

### Why is it like this?
To simplify design, I chose to merge the authorization-side and the identity-side since they are bound to the same person, and it eliminates the need for a separate table to manage this information. However, this introduces several authorization and security characteristics that are explained later in this doc.

## How do I create a contributor?
Use **Add new contributor**! However, you actually should not use this link because:
1. Creating a contributor record does not allow them to log in. Since the actual ability to log in is controlled by Identity & Access Management, you would also need to do so there.
2. You must be an Administrator to directly create a contributor. Since contributor records contain authorization information (such as whether one is an administrator and what their system roles are), only Administrators may directly create contributor records.

Instead, you should use Identity & Access Management > Add user. There, you should use the auto-enrollment feature, which will create a contributor record for you.

If you are an Administrator, you may use **Add new contributor**.

## How do I edit a contributor?
Use **Edit existing contributor**! By default, you will be able to edit your own contributor information (you will not be able to modify your authorization information), but you are encouraged to instead use **My Profile > Edit** to modify your contributor information.

You must be an Administrator to change information about contributors who are not you.

## How do I view a contributor?
You have three options:
1. List all of the contributors using **List contributors**, and pick out the one you want by ID number;
2. Look up the contributor by ID number using **View contributor info**, or
3. Search for the contributor using **View contributor info**.

You will be able to view a contributor's public information. You will not be able to view their authorization information.

## How do I delete a contributor?
Use **Delete contributor**. However, you should use this because:
1. Deleting a contributor record does not stop an individual from logging in;
2. You must be an Administrator to delete a contributor record; and
3. If the contributor is associated with any composition, the system will prevent you from deleting them.

Instead, use **Identity & Access Management > Delete user** with auto-deactivation enabled. This will stop them from logging in and deactivate their account so they can't modify the database.