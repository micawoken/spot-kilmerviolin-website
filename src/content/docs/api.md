---
title: API Reference for Developers
description: view documentation for the website's API
author: Michael Wong
---

## Overview

Although the Administrative Services admin page is the system that allows contributors to contribute, the Administrative Services application programming interface (API) is what powers the admin page and makes it work.

Contributors will not need to understand how the API works and can skip this doc. However, if you ever want to do more work using the API or want to modify how the API works, you can consult this document.

The API is an HTTP REST API with the following endpoints:
 - /api/v1/composers
 - /api/v1/contributors
 - /api/v1/compositions
 - /api/v1/identity
 - /api/v1/files
 - /api/v1/site
 - /api/v1/command
 - /api/v1/search

The current API version is version 1.

## Video Guide

(YouTube embed)

## General information

### Request and response shape

Requests and responses share a small, consistent shape so the client code can treat every endpoint
the same way.

A request body, when one is required, is **always a JSON array** — even when only one item is
expected. Most write endpoints expect an array containing exactly one item:

```json
[ { "name": "Antonín Dvořák", "birth_year": 1841, "death_year": 1904, "...": "..." } ]
```

A response body, if provided, is **always a JSON object** with three properties:

```json
{
  "success": true,
  "payload": [ "...the data, or null..." ],
  "comment": "a human-readable message, often an error description"
}
```

- `success` — whether the request succeeded. Check this before trusting `payload`.
- `payload` — the data the endpoint returns, or `null` when there is nothing to return.
- `comment` — a message, usually only supplied when an error occurs.

### The meta header

By default, the API complies with REST/CRUD API conventions and adopts a least-privilege mode of execution. That is, performing GET on, say, /api/v1/composers will return a list of composer IDs instead of a list of composer objects, and requests for data will assume the lowest authorization.

However, there are use cases (such as when you actually want a list of every composer record, or as an administrator you want to edit a protected contributor property) where you do want to deviate from these conventions. To do so, you or your service will transmit the `X-MWMSC-Request-Meta` header to the server. (This header is white-listed in the site's CORS configuration.)

The body of the `X-MWMSC-Request-Meta` header is a JSON object, such as the one below:

```
X-MWMSC-Request-Meta: {"full": true}
```

Meta information is only read when an endpoint asks for it, and each endpoint documents which meta fields it
honors below. Common meta fields you will see:

- `full` — on list endpoints, return complete records instead of just IDs.
- `names` — on the works endpoints, attach resolved composer/contributor names.
- `elevate` — ask the server to disable least-privilege and consider your administrator status for an operation that would
  otherwise be blocked by row-level security or the contribution edit lockout.

### Status codes

After calling the API, your HTTP response will include an HTTP status code indicating how the transaction went. Here is a reference of what codes you may see:

- **200 OK / 201 Created / 204 No Content** — your request succeeded
- **400 Bad Request** — your request had a problem with its body or meta
- **401 Unauthorized** — you are not signed in
- **403 Forbidden** — you are signed in, but you are not authorized to do this
- **404 Not Found** — the record does not exist
- **409 Conflict** — your operation conflicts with another system requirement (your data may already exist, or a database foreign key link is preventing your operation from continuing)
- **500 Internal Server Error** — something went wrong on the server

---

## Endpoint reference

The following is a summary of the JSDoc documentation for each endpoint.

(the following assume you have already authenticated and have an active contributor profile)

### Compositions (works)

#### `GET /api/v1/works`
Returns a list of work IDs, or full work records if requested.
- Permissions: none.
- Meta (optional): `full` (boolean) — return full records; `names` (boolean) — when `full` is true,
  return each record as a `CompositionWithNames` object (`{ object, names }`) with composer and
  contributor names resolved.
- Body: none.

#### `POST /api/v1/works`
Creates a new work record.
- Permissions: none, but a non-admin may only create a composition on which they are themselves a
  primary contributor; admins may name any registered user as a primary.
- Body: required; an array with a single `Composition` object.
- Returns the new record and a `Location` header.

#### `GET /api/v1/works/[id]`
Returns the composition record for the given ID.
- Permissions: none.
- Meta (optional): `names` (boolean) — return the record as a `CompositionWithNames` object.
- Body: none.

#### `PUT /api/v1/works/[id]`
Fully replaces the composition record.
- Permissions: must be a primary contributor, admin, or reviewer.
- Meta (optional): `elevate` (boolean) — consider admin status against the contribution edit lockout;
  `direct_contrib` (boolean) — manage contributors directly (do not auto-add the editor to the
  additional-contributor list).
- Body: required; an array with a single complete `Composition` object.

#### `PATCH /api/v1/works/[id]`
Partially updates the composition record; only supplied properties change.
- Permissions, Meta: same as `PUT`.
- Body: required; an array with a single partial `Composition` object.

#### `DELETE /api/v1/works/[id]`
Deletes the composition record.
- Permissions: must be a primary contributor, admin, or reviewer.
- Meta (optional): `elevate` (boolean).
- Body: none.

### Composers

#### `GET /api/v1/composers`
Returns a list of composer IDs, or full composer records if requested.
- Permissions: none.
- Meta (optional): `full` (boolean).
- Body: none.

#### `POST /api/v1/composers`
Adds a new composer record.
- Permissions: none.
- Body: required; an array with a single `Composer` object.
- Returns a `Location` header pointing at the new record.

#### `GET /api/v1/composers/[id]`
Returns the composer record for the given ID.
- Permissions: none. Meta/Body: none.

#### `PUT /api/v1/composers/[id]`
Fully replaces the composer record.
- Permissions: none.
- Body: required; an array with a single complete `Composer` object.

#### `PATCH /api/v1/composers/[id]`
Partially updates the composer record.
- Permissions: none.
- Body: required; an array with a single partial `Composer` object.

#### `DELETE /api/v1/composers/[id]`
Deletes the composer record.
- Permissions: none.
- Note: a composer referenced by any composition cannot be deleted (returns `409 Conflict`).

### Contributors

The contributors table also carries authorization data, so these endpoints default to
least-privileged access. Note that the *intended* way to add or remove people is through the identity
endpoints (or the IAM pages), not by creating contributor records directly.

#### `GET /api/v1/contributors`
Returns a list of contributor IDs, or full records if requested.
- Permissions: none, but row-level security applies — protected properties are stripped from every
  record that is not your own, unless you are an admin.
- Meta (optional): `full` (boolean).
- Body: none.

#### `POST /api/v1/contributors`
Adds a contributor record directly (used by the admin pages).
- Permissions: **admin**.
- Body: required; an array with a single `Contributor` object.

#### `GET /api/v1/contributors/[id]`
Returns the contributor record. Your own record comes back in full; others come back with protected
properties removed unless you elevate.
- Permissions: none; **admin** to see protected properties.
- Meta (optional): `elevate` (boolean) — if you are an admin, disable the safe-property filter.
- Body: none.

#### `PUT /api/v1/contributors/[id]`
Fully replaces the contributor record (including security-relevant fields).
- Permissions: **admin**.
- Body: required; an array with a single complete `Contributor` object.

#### `PATCH /api/v1/contributors/[id]`
Partially updates the contributor record.
- Permissions: **admin**, or none if editing your own record. Editing protected properties on any
  record requires elevation as an admin.
- Meta (optional): `elevate` (boolean).
- Body: required; an array with a single partial `Contributor` object.

#### `DELETE /api/v1/contributors/[id]`
Deletes the contributor record.
- Permissions: **admin**. Self-deletion is not allowed.

### Identity & access

#### `GET /api/v1/identity`
Lists the emails of users in the Cloudflare Access policy.
- Permissions: **admin** or the `user_addition` role.

#### `POST /api/v1/identity`
Grants a user access by adding their email to the Access policy.
- Permissions: **admin** or the `user_addition` role.
- Meta (optional): `autoenrollment` (boolean) — also create a contributor record so the user can skip
  self-enrollment; when true, also requires `confer` (boolean) and `name` (string), and optionally
  `major` (string or null) and `class_year` (number or null).
- Body: required; an array containing the one email string to add.

#### `PUT /api/v1/identity`
Not implemented — use `PATCH /api/v1/identity` or `PUT /api/v1/contributors/[id]`. Returns `405`.

#### `PATCH /api/v1/identity`
An identity-centric convenience endpoint for running several membership changes in one call: promote
or demote admins, activate or deactivate accounts, add or remove roles, and change sign-in emails.
- Permissions: **admin**.
- Body: required; an array with a single object. Supported scopes (up to five transactions each):
  - `admin`: `{ elevate?: string[], demote?: string[] }`
  - `active`: `{ activate?: string[], deactivate?: string[] }`
  - `roles`: `{ add?: { [email]: string[] }, remove?: { [email]: string[] } }`
  - `identity_email`: `{ [old_email]: new_email }`
- Per-row failures (e.g., an email with no contributor record) are reported back in the
  `X-MWMSC-Response-Errors` header rather than failing the whole call. For complex multi-step updates,
  prefer `PATCH`/`PUT` on `/api/v1/contributors/[id]`.

#### `DELETE /api/v1/identity`
Removes a user from the Access policy.
- Permissions: **admin** or the `user_addition` role.
- Meta (optional): `autodeactivation` (boolean, defaults to **true**) — also deactivate the
  contributor record so they cannot modify the database.
- Body: required; an array containing the one email string to remove.

#### `GET /api/v1/identity/self`
Returns the caller's own `Identity` object (email, enrollment status, permissions).
- Permissions: none.

#### `POST /api/v1/identity/self`
Completes self-enrollment and creates the caller's contributor record.
- Permissions: none (the caller must be enrollable).
- Body: required; an array with one partial `Contributor` containing `name` (required) and optionally
  `major` and `class_year` (omitted or null is stored as null).

#### `PATCH /api/v1/identity/self`
Changes the caller's own sign-in (identity) email.
- Permissions: none (must be your own record).
- Body: required; an array containing the one new email string.

### Search

#### `POST /api/v1/search`
Runs a ranked keyword search across the composer, composition, and contributor tables.
- Permissions: none beyond a valid identity (results are only id + name over non-sensitive columns).
- Body: required; an array with a single object `{ keyword: string, database?: "composers" |
  "compositions" | "contributors" | null }`. When `database` is null or omitted, all three tables are
  searched.

### Files

Files are binary, so — unlike every other endpoint — the file endpoints use `multipart/form-data` for
uploads instead of a single-item JSON array, and the read endpoint returns raw bytes instead of the JSON
envelope. The `[id]` segment is the file's **key** (its filename). See
[File Management](/admin/docs/files).

#### `GET /api/v1/files`
Returns a list of file keys, or full `FileMeta` records if requested.
- Permissions: none.
- Meta (optional): `full` (boolean).
- Body: none.

#### `POST /api/v1/files`
Uploads a new file (images are optimized to WebP). Rejects a key that already exists with `409`, and an
upload that would exceed the storage ceiling with `507`.
- Permissions: none.
- Body: required; `multipart/form-data` with a `file` part and an optional `name` field (sets the key).
- Returns the stored `FileMeta` and a `Location` header pointing at the new file.

#### `GET /api/v1/files/[id]`
Returns the file's raw bytes with its stored content type (not a JSON envelope).
- Permissions: none.
- Body: none.

#### `PUT /api/v1/files/[id]`
Replaces an existing file's bytes, keeping the key. Returns `404` if the key does not exist and `507` if
the write would exceed the storage ceiling.
- Permissions: none.
- Body: required; `multipart/form-data` with a `file` part.

#### `DELETE /api/v1/files/[id]`
Deletes the file.
- Permissions: none.

### Site

#### `GET /api/v1/site`
Returns build information (timestamp, build ID, git tag if available).
- Permissions: none.

#### `POST /api/v1/site`
Triggers a site rebuild through the deploy hook. See [Site Management](/admin/docs/site) for when to
do this and the build-minute budget.
- Permissions: none.

#### `DELETE /api/v1/site`
Purges the database cache. See [Site Management](/admin/docs/site).
- Permissions: none.

### Database terminal (advanced)

#### `POST /api/v1/command`
Executes one or more raw SQL strings directly against the D1 database. This bypasses all the validation
the regular endpoints perform — see [Advanced Options](/admin/docs/advanced) for the warnings.
- Permissions: **admin**.
- Body: required; an array of one or more SQL command strings.
- Meta: optional; `batch` (boolean, default `true`). When more than one command is supplied they run as a
  single atomic transaction, so a failure rolls back the whole set. Set `batch` to `false` to run the
  commands sequentially as independent statements (no rollback). Ignored for a single command.
- Returns the single D1 result for one command, or an array of results (one per command, in order) for
  multiple commands.
