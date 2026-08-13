/**
 * lib/api/csv.ts
 *
 * A small, dependency-free CSV toolkit shared by client (the admin import UI) and server. It provides an
 * RFC-4180-style parser (quoted fields, embedded commas/newlines, "" escaping, CRLF/LF), a header-aware
 * row mapper that validates the column set, and a fuzzy name matcher used to suggest corrections for
 * unresolved composer/contributor references during an import preview.
 *
 * This module deliberately imports nothing server-only (no `cloudflare:workers`) so it can be bundled into
 * client scripts the same way lib/api/validation.ts is.
 *
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This file is part of the spot-kilmerviolin-website program, available at
 * https://github.com/micawoken/spot-kilmerviolin-website.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 *
 * This license is also subject to additional terms as specified in the README.md.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Parse CSV text into a matrix of string cells.
 *
 * Follows RFC 4180 conventions: fields may be wrapped in double quotes, a quoted field may contain commas
 * and line breaks, and a literal double quote inside a quoted field is written as two double quotes ("").
 * Both CRLF and LF line endings are accepted. A trailing newline does not produce a spurious empty final
 * row, but genuinely empty lines in the middle are preserved as a single empty cell (the caller decides
 * whether to skip them).
 *
 * @param text the raw CSV text
 * @returns an array of rows, each an array of string cell values
 */
export function parseCsv(text: string): string[][] {
    const rows: string[][] = []
    let row: string[] = []
    let field = ""
    let inQuotes = false
    let fieldStarted = false // distinguishes a genuine empty trailing row from real content

    for (let i = 0; i < text.length; i++) {
        const char = text[i]
        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    // an escaped quote ("") contributes a single literal quote
                    field += '"'
                    i++
                } else {
                    inQuotes = false
                }
            } else {
                field += char
            }
            continue
        }
        switch (char) {
            case '"':
                inQuotes = true
                fieldStarted = true
                break
            case ",":
                row.push(field)
                field = ""
                fieldStarted = true
                break
            case "\r":
                // swallow CR; the following LF (if any) ends the row
                break
            case "\n":
                row.push(field)
                rows.push(row)
                row = []
                field = ""
                fieldStarted = false
                break
            default:
                field += char
                fieldStarted = true
                break
        }
    }
    // flush the final field/row unless the input ended exactly on a row boundary
    if (fieldStarted || field !== "" || row.length > 0) {
        row.push(field)
        rows.push(row)
    }
    return rows
}

/**
 * Parse CSV text with a header row into keyed row objects, validating the column set.
 *
 * The first non-discarded row is treated as the header. Its trimmed column names must equal
 * `expectedColumns` as a set (order does not matter, but there must be no missing or unexpected columns and
 * no duplicates). Each subsequent row must have exactly the header's width and is returned as a
 * `Record<columnName, cellValue>`. Fully empty rows (a single empty cell) are skipped so trailing blank
 * lines are tolerated.
 *
 * @param text the raw CSV text
 * @param expectedColumns the column names the header must contain
 * @param allowExtraColumns when true, columns beyond `expectedColumns` are permitted (and carried through
 *   in the row objects for the caller to ignore); only missing expected columns are an error. When false
 *   (default), the header must equal `expectedColumns` as a set.
 * @returns one object per data row, keyed by column name
 * @throws an Error with a clear message on an empty file, a header mismatch, or a row of the wrong width
 */
export function parseCsvWithHeader(
    text: string,
    expectedColumns: string[],
    allowExtraColumns = false
): Record<string, string>[] {
    const matrix = parseCsv(text)
    if (matrix.length === 0) {
        throw new Error("The CSV file is empty")
    }
    const header = matrix[0].map((column) => column.trim())
    // detect duplicate header columns (they would silently collide in the row objects)
    const seen = new Set<string>()
    for (const column of header) {
        if (seen.has(column)) {
            throw new Error(`Duplicate column "${column}" in the CSV header`)
        }
        seen.add(column)
    }
    const expected = new Set(expectedColumns)
    const missing = expectedColumns.filter((column) => !seen.has(column))
    const unexpected = allowExtraColumns ? [] : header.filter((column) => !expected.has(column))
    if (missing.length > 0 || unexpected.length > 0) {
        const parts: string[] = []
        if (missing.length > 0) {
            parts.push(`missing column(s): ${missing.join(", ")}`)
        }
        if (unexpected.length > 0) {
            parts.push(`unexpected column(s): ${unexpected.join(", ")}`)
        }
        throw new Error(`CSV header does not match the expected columns (${parts.join("; ")})`)
    }

    const out: Record<string, string>[] = []
    for (let r = 1; r < matrix.length; r++) {
        const cells = matrix[r]
        // skip a blank line (parseCsv yields a single empty cell for one)
        if (cells.length === 1 && cells[0].trim() === "") {
            continue
        }
        if (cells.length !== header.length) {
            throw new Error(
                `Row ${r + 1} has ${cells.length} column(s) but the header has ${header.length}; check for unescaped commas or quotes`
            )
        }
        const record: Record<string, string> = {}
        for (let c = 0; c < header.length; c++) {
            record[header[c]] = cells[c]
        }
        out.push(record)
    }
    return out
}

/**
 * Normalizes a name for fuzzy comparison: trimmed, lowercased, and internal whitespace collapsed to a
 * single space. Used so trivial variants ("J.  S. Bach " vs "j. s. bach") compare equal.
 */
function normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ")
}

/**
 * Computes the Levenshtein edit distance between two strings, bounded by `max`: as soon as the best
 * possible distance for the current row exceeds `max`, it returns `max + 1` without finishing. The bound
 * keeps the typo suggestion cheap over a large candidate list.
 *
 * @param a the first string
 * @param b the second string
 * @param max the maximum distance of interest
 * @returns the edit distance, or a value greater than `max` if it exceeds the bound
 */
function boundedLevenshtein(a: string, b: string, max: number): number {
    if (Math.abs(a.length - b.length) > max) {
        return max + 1
    }
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
    let curr = new Array<number>(b.length + 1)
    for (let i = 1; i <= a.length; i++) {
        curr[0] = i
        let rowMin = curr[0]
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
            if (curr[j] < rowMin) {
                rowMin = curr[j]
            }
        }
        if (rowMin > max) {
            return max + 1
        }
        ;[prev, curr] = [curr, prev]
    }
    return prev[b.length]
}

/**
 * Finds the candidate name closest to `target` for a "did you mean…?" suggestion.
 *
 * A normalized exact match (case/whitespace-insensitive) always wins. Otherwise the nearest candidate
 * within a small edit distance (default ≤ 2) of the normalized target is returned, or null if none is
 * close enough. The candidate's original (un-normalized) form is returned so it can be shown verbatim.
 *
 * @param target the unresolved name from the CSV
 * @param candidates the known names to match against
 * @param maxDistance the maximum edit distance to consider a suggestion (default 2)
 * @returns the closest candidate's original string, or null if none is within range
 */
export function nearestName(target: string, candidates: string[], maxDistance = 2): string | null {
    const normalizedTarget = normalizeName(target)
    let best: string | null = null
    let bestDistance = maxDistance + 1
    for (const candidate of candidates) {
        const normalizedCandidate = normalizeName(candidate)
        if (normalizedCandidate === normalizedTarget) {
            return candidate
        }
        const distance = boundedLevenshtein(normalizedTarget, normalizedCandidate, maxDistance)
        if (distance < bestDistance) {
            bestDistance = distance
            best = candidate
        }
    }
    return bestDistance <= maxDistance ? best : null
}
