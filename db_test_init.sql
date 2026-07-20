/*
Loads test data into the database
Run this file on a local D1 database for testing

DO NOT RUN THIS FILE ON REMOTE

*/


/*
name TEXT UNIQUE NOT NULL,
class_year INTEGER NOT NULL,
major TEXT NOT NULL,
phases TEXT NOT NULL,
bio TEXT,
public_email TEXT,
identity_email TEXT UNIQUE NOT NULL,
active INTEGER NOT NULL,
roles TEXT NOT NULL,
admin INTEGER NOT NULL,
image TEXT,
tags TEXT,
entry_date INTEGER NOT NULL,
change_date INTEGER NOT NULL
*/
INSERT INTO contributors VALUES (
    NULL,
    "First Last",
    2026,
    "Excellent Major",
    "1,2",
    "I'm just a bio",
    "example@example.com",
    "example@example.com",
    1,
    "reviewer",
    0,
    NULL,
    "",
    1704067200000, -- entry_date (creation)
    1704067200000  -- change_date (last modified)
), (
    NULL,
    "Grilled Chicken",
    2028,
    "Cryptid Analysis",
    "2,3,4,",
    "I'm just a bill",
    "example@example.com",
    "example2@example.com",
    1,
    "",
    1,
    "https://mwmsc.net/favicon.ico",
    "grilled-chicken,yummy,tasty",
    1704067200000,
    1704067200000
), (
    NULL,
    "Test Name",
    2024,
    "History",
    "1,",
    "Once upon a time",
    "email@example.com",
    "identity2@example.com",
    0,
    "",
    0,
    NULL,
    "test,",
    1704067200000,
    1704067200000
), (
    NULL,
    "Test User", -- intended for active testing
    2026,
    "Default Major",
    "2,3",
    "I'm a test user, please help me!",
    "test-active@example.com",
    "test-active@example.com",
    1,
    "reviewer",
    0,
    NULL,
    "test",
    1704067200000,
    1704067200000
);

/*
composer_id INTEGER PRIMARY KEY AUTOINCREMENT,
name TEXT UNIQUE NOT NULL,
role TEXT NOT NULL,
year_birth INTEGER NOT NULL,
year_death INTEGER NOT NULL,
country TEXT NOT NULL,
bio TEXT,
image TEXT,
tags TEXT,
citations TEXT,
entry_date INTEGER NOT NULL,
change_date INTEGER NOT NULL
*/
INSERT INTO composers VALUES (
    NULL,
    "Bach Bae",
    "composer",
    1000,
    2000,
    "Germany",
    "Doing some counterpoint",
    NULL,
    "test-tag,commaless,",
    NULL, -- citations
    1704067200000, -- entry_date (creation)
    1704067200000  -- change_date (last modified)
), (
    null,
    "Barber Barbershop",
    "composer",
    1500,
    -1, -- test alive
    "United States",
    "americaaaaaaa",
    "https://mwmsc.net/favicon.ico",
    ",",
    '{"IMSLP":"https://imslp.org/wiki/Category:Barber,_Samuel"}', -- citations
    1704067200000,
    1704067200000
), (
    NULL,
    "Test Composer",
    "composer",
    1900,
    1950,
    "USA",
    "A test composer",
    NULL,
    "test",
    NULL, -- citations
    1704067200000,
    1704067200000
);

/*
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
*/

INSERT INTO compositions VALUES (
    null,
    "Test Composition",
    1, -- Bach Bae
    1, -- First Last
    NULL,
    NULL,
    -- skipping full name since generated
    NULL,
    "Test Type",
    NULL,
    10,
    10,
    "New York",
    "Test Publisher",
    6767,
    "https",
    "https://example.com",
    "C Major",
    "G3-C6",
    "III",
    "Pedagogical notes here",
    "Historical notes here",
    "Other notes here",
    NULL,
    "1,2",
    "test,", -- tags
    NULL, -- citations
    1704067200000, -- entry_date (creation)
    1704067200000  -- change_date (last modified)
), (
    null,
    "Violin Concerto, Op. 14",
    2, -- Barber Barbershop
    4, -- linked to user account that can sign in
    2, -- Test Name
    "",
    -- skipping full name since generated
    "",
    "Test Type",
    NULL,
    10,
    10,
    "New York",
    "Test Publisher",
    1939,
    "isbn",
    "9781000000000",
    "G Major",
    "G3-E8",
    "XII",
    "Pedagogical notes here",
    "Historical notes here",
    "Other notes here",
    "https://mwmsc.net/favicon.ico",
    "3,4",
    "test,barber", -- tags
    '{"IMSLP":"https://imslp.org/wiki/Category:Barber,_Samuel","DOI Example":"10.1000/testdoi"}', -- citations
    1704067200000, -- entry_date (creation)
    1704067200000  -- change_date (last modified)
);
