/*
One-off backfill for the "Unknown"/"Traditional" name-only sentinel composers
*/

UPDATE composers
SET role = 'composer',
    birth_year = 1,
    death_year = 1,
    country = 'ZZ',
    bio = '',
    change_date = (strftime('%s', 'now') * 1000)
WHERE name IN ('Unknown', 'Traditional');
