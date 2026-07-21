/*
Migration: add the build_tokens table backing capability-scoped build tokens (plan-prelaunch-features.md §2,
decision D9).

A build token is a bearer secret with NO owning contributor and NO identity: it authenticates the build
process, not a person. It grants nothing by default and admits exactly the three read-only, full-list GET
routes enforced centrally by src/middleware/identity.ts (see buildTokenRouteAllowed in src/lib/api/tokens.ts).
This is deliberately a separate table/type from api_tokens (not a nullable contributor_id on that table) so
the two credential shapes can never be confused by a missing WHERE clause.

Only the SHA-256 hash of the secret is ever stored (token_hash); the plaintext is shown once at issue time
and is not recoverable afterward. token_prefix holds a few leading characters for display/identification
only.

This is a new table, not an alteration of an existing one, so no create-new/copy/drop/rename rebuild is
needed (contrast db_add_citations.sql).

entry_date/expires_date/revoked_date are epoch-ms integers, matching the project-wide timestamp convention.
entry_date is immutable after creation, mirroring the trigger already applied to api_tokens and the other
tables in db_init.sql.

See src/lib/api/tokens.ts (issuance/verification), src/middleware/identity.ts (the X-Build-Token auth
branch + route whitelist), and src/lib/build/d1-api.ts (the build-time reader that uses these tokens).
*/

CREATE TABLE build_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    token_prefix TEXT NOT NULL,
    entry_date INTEGER NOT NULL,
    expires_date INTEGER NOT NULL,
    revoked_date INTEGER
);

CREATE INDEX idx_build_tokens_token_hash ON build_tokens (token_hash);

CREATE TRIGGER trg_build_tokens_entry_date_immutable
BEFORE UPDATE OF entry_date ON build_tokens
WHEN NEW.entry_date <> OLD.entry_date
BEGIN
    SELECT RAISE(ABORT, 'entry_date is immutable after creation');
END;
