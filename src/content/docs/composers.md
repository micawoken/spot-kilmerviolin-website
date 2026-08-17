---
title: Composers
description: View composers documentation
author: Michael Wong
---

## Overview

The Composers section lets you maintain the people credited as composers of the works in the database. The following actions are available from the [Composers menu](/admin/composers):

- **Add new composer** - create a new composer record
- **View composer info** - look up an existing composer
- **Edit existing composer** - change a composer's details
- **Delete composer** - permanently remove a composer
- **List composers** - browse all composers currently stored
- **Import composers** - import composers to the database

## Composer Records
A composer is a database record containing an individual's:
- name,
- birth year,
- death year (or still alive),
- country,
- biography,
- citations, and
- tags.

### Name
Use their preferred name, if possible. If not possible, you may use an English or romanized version.

### Birth Year
Their year of birth (as most accurately known).

### Death Year
Their death year; if still alive, it is entered as -1 and shows as "Present"

### Country
The country they are associated with
A bit of nuance: "country" is not clearly defined since it could mean many different things. In general, use the country they were most strongly associated with, in your opinion.

### Biography
A written biography from one of you guys `:)`

### Citations
Citations using HTTPS URLs, ISBNs, or DOI numbers can be added.

### Tags
Any common tags you want to associate with the composer.

## Create/Read/Update/Delete Composers
To do these operations, access the relevant link.

## Import Composers
To import a composer, you need to upload a CSV file in the following format:
- header row: (all column names comma-separated; citations are not imported)
- remaining rows: composers to import

Once uploaded, click "Load" to process the file. Fix any errors the system reports.

Once errors are fixed, run server validation: the system will tell you what other problems there are.

Once you fix the server-detected errors, you can complete import.

## Questions
Any questions? Contact [contact@michaelwongmusic.com](mailto:contact@michaelwongmusic.com).