/*
Migration: add the api_tokens table backing user-scoped API tokens (plan-prelaunch-features.md §2).

A user-scoped API token is a bearer secret that, presented alongside a mandatory Cloudflare Access service
token, resolves to the issuing contributor and inherits that contributor's live permissions in full. Only
the SHA-256 hash of the secret is ever stored (token_hash); the plaintext is shown once at issue time and
is not recoverable afterward. token_prefix holds a few leading characters for display/identification only.

This is a new table, not an alteration of an existing one, so no create-new/copy/drop/rename rebuild is
needed (contrast db_add_citations.sql).

entry_date/expires_date/revoked_date are epoch-ms integers, matching the project-wide timestamp convention.
entry_date is immutable after creation, mirroring the trigger already applied to contributors/composers/
compositions in db_init.sql.

See src/lib/api/tokens.ts (issuance/verification) and src/middleware/identity.ts (the X-Api-Token auth
branch).
*/

CREATE TABLE api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contributor_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    token_prefix TEXT NOT NULL,
    entry_date INTEGER NOT NULL,
    expires_date INTEGER NOT NULL,
    revoked_date INTEGER,
    FOREIGN KEY (contributor_id) REFERENCES contributors(contributor_id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX idx_api_tokens_token_hash ON api_tokens (token_hash);
CREATE INDEX idx_api_tokens_contributor_id ON api_tokens (contributor_id);

CREATE TRIGGER trg_api_tokens_entry_date_immutable
BEFORE UPDATE OF entry_date ON api_tokens
WHEN NEW.entry_date <> OLD.entry_date
BEGIN
    SELECT RAISE(ABORT, 'entry_date is immutable after creation');
END;
