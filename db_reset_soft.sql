/*
Resets the compositions and composers tables
Run this file when re-importing from the spreadsheet

*** WARNING: this will delete all project work. Do not run this file unless you know what you are doing ***

To correct an error in the production database, perform a rollback on Cloudflare D1
*/

DROP TABLE IF EXISTS compositions;
DROP TABLE IF EXISTS composers;
DROP TABLE IF EXISTS repertoire;

CREATE TABLE composers (
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

-- the same person may appear twice under different roles (e.g. as both "composer" and "arranger"), but
-- not twice under the same one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_composers_name_role ON composers (name, role);

CREATE TABLE compositions (
composition_id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT NOT NULL,
composer_id INTEGER NOT NULL,
contrib_primary_1 INTEGER NOT NULL,
contrib_primary_2 INTEGER,
contrib_addl TEXT,
author_secondary TEXT,
type TEXT NOT NULL,
part TEXT,
rating_suzuki INTEGER,
rating_nyssma INTEGER,
publish_location TEXT NOT NULL,
publish_name TEXT NOT NULL,
publish_year INTEGER NOT NULL,
uri_type TEXT NOT NULL,
uri TEXT,
key TEXT,
range TEXT,
position_highest TEXT,
notes_pedagogical TEXT,
notes_historical TEXT,
notes_other TEXT,
image TEXT,
phases TEXT NOT NULL,
tags TEXT,
citations TEXT,
entry_date INTEGER NOT NULL,
change_date INTEGER NOT NULL,
FOREIGN KEY (composer_id) REFERENCES composers(composer_id) ON UPDATE CASCADE ON DELETE RESTRICT,
FOREIGN KEY (contrib_primary_1) REFERENCES contributors(contributor_id) ON UPDATE CASCADE ON DELETE RESTRICT,
FOREIGN KEY (contrib_primary_2) REFERENCES contributors(contributor_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

-- a composer may not have two compositions with the same name AND part;
-- COALESCE(part, '') makes a NULL part collide with an empty part so two part-less rows still conflict
CREATE UNIQUE INDEX IF NOT EXISTS idx_compositions_composer_name_part ON compositions (composer_id, name, COALESCE(part, ''));

-- entry_date is the creation timestamp and must never change after insert; only change_date tracks edits.
-- Fires only when entry_date is actually being set to a new value, so ordinary UPDATEs that don't touch it are unaffected.

CREATE TRIGGER trg_composers_entry_date_immutable
BEFORE UPDATE OF entry_date ON composers
WHEN NEW.entry_date <> OLD.entry_date
BEGIN
    SELECT RAISE(ABORT, 'entry_date is immutable after creation');
END;

CREATE TRIGGER trg_compositions_entry_date_immutable
BEFORE UPDATE OF entry_date ON compositions
WHEN NEW.entry_date <> OLD.entry_date
BEGIN
    SELECT RAISE(ABORT, 'entry_date is immutable after creation');
END;
