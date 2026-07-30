---
title: Compositions
description: Add, view, edit, delete, and list compositions
author: Michael Wong
---

## Overview

The Compositions section lets you maintain the catalogue of musical works in the database. The
following actions are available from the [Compositions menu](/admin/works):

- **Add new composition** - create a new work record
- **View composition info** - look up an existing work by its identifier
- **Edit existing composition** - change the details of a work already in the database
- **Delete composition** - permanently remove a work
- **List compositions** - browse all works currently stored
- **Import compositions** - import compositions to the database using a file

## Name Nuance
In internal systems, musical works are referred to as "compositions." On the public website, the term "work" is used.

## Composition Records
A composition record is the database's information about a specific composition, which includes who the composer is, what type of work it is, characteristics about the work, commentary on the work, and who entered it in the database.

### Managing credit
By default, the system will track who creates a composition and who updates a composition for you. When you create or edit a composition, the system will automatically credit you.

(If you are an administrator, you can disable contributor auto-management for a given operation.)

### Types of contributors
There are two types of contributors recorded in the database:
1. Primary contributors (1 required, 2 max), and
2. Additional contributors (0 required, unlimited).

Primary contributors are used to enforce the contribution edit lockout (detailed below); there is no other functional difference.

#### Contribution edit lockout
The contribution edit lockout is designed to protect a contributor's work on a composition from unpermitted changes. The system works using the primary contributors assigned to a composition record: if the user attempting to edit or delete a composition is not a primary contributor, the system will reject the operation.

The effect of this is that **the only contributors who can edit a composition are the ones who created it.** (If only one primary contributor was set, that contributor can designate one other contributor as primary; that change is not reversible.)

If you are not a primary contributor, there are two ways to escape the contribution edit lockout:
1. Administrators always bypass the contribution edit lockout; and
2. Users with the reviewer role (or otherwise granted the "overrides_lockout" permission) bypass the lockout.

## Create/Read/Update/Delete Compositions
To do these operations, access the relevant link.

## Import Compositions
To import a composition, you need to upload a CSV file in the following format:
- header row: (all column names comma-separated; citations are not imported)
- remaining rows: compositions to import

Once uploaded, click "Load" to process the file. Fix any errors the system reports.

Once errors are fixed, run server validation: the system will tell you what other problems there are.

Once you fix the server-detected errors, you can complete import.