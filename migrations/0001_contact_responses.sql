CREATE TABLE IF NOT EXISTS contact_responses (
response_id INTEGER PRIMARY KEY AUTOINCREMENT,
subject TEXT,
name TEXT NOT NULL,
email TEXT,
phone TEXT,
body TEXT NOT NULL,
source_path TEXT,
spam_score INTEGER NOT NULL,
spam_flags TEXT,
read_at INTEGER,
entry_date INTEGER NOT NULL,
change_date INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_responses_read_at ON contact_responses (read_at);
CREATE INDEX IF NOT EXISTS idx_contact_responses_entry_date ON contact_responses (entry_date);

CREATE TRIGGER IF NOT EXISTS trg_contact_responses_entry_date_immutable
BEFORE UPDATE OF entry_date ON contact_responses
WHEN NEW.entry_date <> OLD.entry_date
BEGIN
    SELECT RAISE(ABORT, 'entry_date is immutable after creation');
END;

CREATE TRIGGER IF NOT EXISTS trg_contact_responses_queue_limit
BEFORE INSERT ON contact_responses
WHEN (SELECT COUNT(*) FROM contact_responses) >= 500
BEGIN
    DELETE FROM contact_responses
    WHERE response_id = (
        SELECT response_id FROM contact_responses
        WHERE read_at IS NOT NULL
        ORDER BY entry_date ASC, response_id ASC
        LIMIT 1
    );
    SELECT CASE
        WHEN (SELECT COUNT(*) FROM contact_responses) >= 500
        THEN RAISE(ABORT, 'contact_response_queue_full')
    END;
END;
