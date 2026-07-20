/*
Migration: add an optional citations column to composers and compositions, keeping entry_date/change_date
as the table's last two columns.

citations stores a JSON-encoded object mapping a source name (the display text) to a value that is an
https link, a DOI, or an ISBN (docs/dev/miscellaneous.txt's "data model changes" section). Nullable and
optional: an absent/empty citations set is stored as NULL, mirroring the tags column. Application code
(src/lib/api/common.ts) is the only reader/writer of this column's JSON shape.

SQLite's ALTER TABLE ADD COLUMN always appends the new column as the table's LAST physical column, but
this project's convention is that entry_date/change_date are always the final two columns (in either
order) — see db_init.sql and lib/api/d1.ts's COMPOSER/COMPOSITION schemas, where citations sits between
tags and entry_date. A plain ALTER TABLE ADD COLUMN would therefore leave a live database's physical
column order diverging from a fresh db_init.sql install (the same class of drift that caused the
composition tags/entry_date swap bug fixed in 2377842), so both tables are rebuilt instead
(create-new -> copy -> drop-old -> rename), mirroring db_rebuild_change_date_notnull.sql's approach.

contributors is untouched: citations is only added to composers and compositions.

Ordering (mirrors db_rebuild_change_date_notnull.sql): compositions has FKs into composers, and the local
engine enforces foreign keys immediately, so compositions must be stashed and dropped before composers is
rebuilt, then recreated afterward with its FKs and rows restored.

Rebuilding a table drops its triggers and any indexes not implied by an inline column constraint (a
UNIQUE column constraint regenerates its own auto-index, but idx_compositions_composer_name_part and the
two entry_date-immutability triggers do not) — both are recreated at the end, verbatim from db_init.sql.

See src/lib/api/d1.ts (COMPOSER/COMPOSITION schemas) and db_init.sql.
*/

-- 1. stash compositions in a constraint-free backup so composers can be rebuilt freely
CREATE TABLE compositions_backup AS SELECT * FROM compositions;

-- 2. drop compositions (no table references compositions, so no RESTRICT is triggered) — this also drops
--    trg_compositions_entry_date_immutable and idx_compositions_composer_name_part, recreated in step 4/5
DROP TABLE compositions;

-- 3. rebuild composers with citations inserted before entry_date/change_date — this also drops
--    trg_composers_entry_date_immutable, recreated in step 5
CREATE TABLE composers_new (
  composer_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
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
INSERT INTO composers_new (composer_id, name, role, birth_year, death_year, country, bio, image, tags, entry_date, change_date)
  SELECT composer_id, name, role, birth_year, death_year, country, bio, image, tags, entry_date, change_date FROM composers;
DROP TABLE composers;
ALTER TABLE composers_new RENAME TO composers;

-- 4. recreate compositions with citations inserted before entry_date/change_date, and restore rows
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
INSERT INTO compositions (composition_id, name, composer_id, contrib_primary_1, contrib_primary_2, contrib_addl, author_secondary, type, part, rating_suzuki, rating_nyssma, publish_location, publish_name, publish_year, uri_type, uri, key, range, position_highest, notes_pedagogical, notes_historical, notes_other, image, phases, tags, entry_date, change_date)
  SELECT composition_id, name, composer_id, contrib_primary_1, contrib_primary_2, contrib_addl, author_secondary, type, part, rating_suzuki, rating_nyssma, publish_location, publish_name, publish_year, uri_type, uri, key, range, position_highest, notes_pedagogical, notes_historical, notes_other, image, phases, tags, entry_date, change_date FROM compositions_backup;

-- 5. drop the backup and recreate what rebuilding compositions/composers dropped
DROP TABLE compositions_backup;

CREATE UNIQUE INDEX IF NOT EXISTS idx_compositions_composer_name_part ON compositions (composer_id, name, COALESCE(part, ''));

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
