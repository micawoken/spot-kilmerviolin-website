/*
Migrates composers' uniqueness from name-alone to (name, role): the same person can now be listed twice
under two different roles (e.g. as both "composer" and "arranger") without colliding, but not twice under
the same role. Mirrors idx_compositions_composer_name_part's pattern (see db_init.sql).

Run this ONCE against an EXISTING database that was initialized from an older db_init.sql (one whose
composers.name column still has a bare UNIQUE constraint). A database freshly initialized from the
CURRENT db_init.sql already has this shape and does not need this file.

SQLite (D1) cannot drop a column-level UNIQUE constraint with ALTER TABLE, so this rebuilds the table:
create composers_new without the constraint, copy every row across (verbatim, so no existing composer_id
changes), drop the old table, and rename the new one into place. Existing rows were already unique by name
alone under the old constraint, so they are a fortiori unique under the new (name, role) index — this
migration cannot fail on the data copy.

Run: npx wrangler d1 execute (your database name) --remote --file="./db_add_composer_name_role_unique.sql"
*/

PRAGMA foreign_keys=OFF;

CREATE TABLE composers_new (
composer_id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
role TEXT NOT NULL,
birth_year INTEGER NOT NULL,
death_year INTEGER NOT NULL,
country TEXT NOT NULL,
bio TEXT,
image TEXT,
tags TEXT,
citations TEXT,
entry_date INTEGER NOT NULL,
change_date INTEGER NOT NULL
);

INSERT INTO composers_new SELECT * FROM composers;

DROP TABLE composers;

ALTER TABLE composers_new RENAME TO composers;

-- ALTER TABLE RENAME updates sqlite_sequence to match automatically; this is a defensive no-op otherwise,
-- so the next AUTOINCREMENT id continues from the existing max(composer_id) instead of restarting.
UPDATE sqlite_sequence SET name = 'composers' WHERE name = 'composers_new';

CREATE UNIQUE INDEX IF NOT EXISTS idx_composers_name_role ON composers (name, role);

-- DROP TABLE also dropped trg_composers_entry_date_immutable (triggers belong to their table); recreate it
-- exactly as db_init.sql defines it.
CREATE TRIGGER trg_composers_entry_date_immutable
BEFORE UPDATE OF entry_date ON composers
WHEN NEW.entry_date <> OLD.entry_date
BEGIN
    SELECT RAISE(ABORT, 'entry_date is immutable after creation');
END;

PRAGMA foreign_keys=ON;
