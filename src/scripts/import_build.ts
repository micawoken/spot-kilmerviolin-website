/**
 * scripts/import_build.ts
 *
 * The DOM-free core of the admin CSV import: it maps CSV cells to API record objects, resolves composer and
 * contributor NAME references to ids (with fuzzy "did you mean…?" suggestions), maps the free-text
 * "contribution period" to phase numbers, and reports the client-side issues that block a row. The DOM
 * wiring (file picking, the editable preview grid, the server dry-run/commit) lives in import.ts and calls
 * into this module, so this logic can be unit-tested without a browser.
 *
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
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

import { nearestName } from "../lib/api/csv"
import { normalizeCountryCode } from "../lib/api/validation"
import {
    CSV_LIST_SEPARATOR,
    composer_csv_columns,
    contributor_csv_columns,
    composition_csv_columns,
    constructRating,
    ratingIssues,
    constructPubInfo
} from "./types"
import type { BulkNoun } from "./connector"

/** The three importable entity types; maps directly to the bulk endpoint noun. */
export type ImportType = BulkNoun

/** The maximum number of rows a single import request may carry (mirrors the server's MAX_BULK_ITEMS). */
export const MAX_IMPORT_ROWS = 999

/** A known record referenced by name (composer or contributor) used to resolve names to ids. */
export interface NamedRecord {
    id: number
    name: string
}

/**
 * A client-side blocking issue: a human-readable message plus, when the issue concerns exactly one grid
 * column, that column's name. `column` lets import.ts highlight the right input directly instead of
 * guessing from the message text (its columnsFromIssue heuristic, still used for server dry-run issues,
 * which arrive as plain strings) — guessing is what let an unresolved author_secondary name wrongly light
 * up the composer column, since resolveReference's generic label there is also "composer".
 */
export interface BuildIssue {
    message: string
    column?: string
}

/** The outcome of building one record from its cells: the API object plus any client-side blocking issues. */
export interface BuildResult {
    record: Record<string, unknown>
    issues: BuildIssue[]
}

/**
 * Resolution context for composition imports: the name→record maps and candidate name lists used to resolve
 * references and suggest corrections, plus the set of composer+name keys already present in the database and
 * the admin-supplied period→phase mapping.
 */
export interface WorksContext {
    composerByName: Map<string, NamedRecord>
    contributorByName: Map<string, NamedRecord>
    composerNames: string[]
    contributorNames: string[]
    existingKeys: Set<string>
    /** admin-supplied mapping of each distinct free-text period to its phase-number input (raw string) */
    phaseMap: Map<string, string>
}

/** The per-type column set and whether extra columns are tolerated (contributors ignore extras). */
export function columnSpec(type: ImportType): { columns: string[]; allowExtra: boolean } {
    switch (type) {
        case "composers":
            return { columns: composer_csv_columns, allowExtra: false }
        case "contributors":
            return { columns: contributor_csv_columns, allowExtra: true }
        case "works":
            return { columns: composition_csv_columns, allowExtra: false }
    }
}

/** Normalizes a name for exact map lookups the same way csv.ts's fuzzy matcher does (trim/lower/collapse). */
export function normalizeName(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, " ")
}

/**
 * Composite dedup key for a composition: composer id + case-insensitively-normalized name + part. A null or
 * blank part is treated as an empty part so two part-less works still collide (mirrors the server's
 * compositionDuplicateKey and the COALESCE(part,'') UNIQUE index).
 */
export function compositionKey(composerId: number, name: string, part: string | null): string {
    return `${composerId} ${normalizeName(name)} ${normalizeName(part ?? "")}`
}

/** Parses an optional integer cell: blank → null; otherwise the parsed value, or null when unparseable. */
function numberOrNull(raw: string): number | null {
    const trimmed = raw.trim()
    if (trimmed === "") {
        return null
    }
    const value = parseInt(trimmed, 10)
    return isNaN(value) ? null : value
}

/** Parses an optional string cell: blank → null; otherwise the trimmed value. */
function stringOrNull(raw: string): string | null {
    const trimmed = raw.trim()
    return trimmed === "" ? null : trimmed
}

/** Splits a list-valued cell on the in-cell separator (";"), trimming and dropping empty entries. */
function splitList(raw: string): string[] {
    return raw
        .split(CSV_LIST_SEPARATOR)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
}

/** Parses a phase-map input (comma/semicolon separated) into a sorted, de-duplicated list of phase numbers. */
export function parsePhases(raw: string): number[] {
    const seen = new Set<number>()
    for (const token of raw.split(/[,;]/)) {
        const value = parseInt(token.trim(), 10)
        if (!isNaN(value)) {
            seen.add(value)
        }
    }
    return Array.from(seen).sort((a, b) => a - b)
}

/** Builds a name→record map plus the candidate-name list for a set of known records. */
export function indexByName(records: NamedRecord[]): { byName: Map<string, NamedRecord>; names: string[] } {
    const byName = new Map<string, NamedRecord>()
    const names: string[] = []
    for (const record of records) {
        names.push(record.name)
        // first writer wins on a normalized collision; names are UNIQUE server-side so collisions are edge cases
        const key = normalizeName(record.name)
        if (!byName.has(key)) {
            byName.set(key, record)
        }
    }
    return { byName, names }
}

/**
 * Resolves a single (required or optional) name reference to an id.
 *
 * @param label the human noun used in the message (e.g. "composer", "contributor") — may legitimately
 *   collide with a different field's own column name (author_secondary resolves against composer names),
 *   so it is never used for column highlighting; `column` carries that instead.
 * @param column the exact grid column this reference came from, tagged onto the issue so import.ts can
 *   highlight it directly
 * @returns the resolved id (or null when blank/unresolved) and, when unresolved, a human-readable issue that
 *   includes a "did you mean…?" suggestion where a close match exists
 */
function resolveReference(
    raw: string,
    byName: Map<string, NamedRecord>,
    candidates: string[],
    label: string,
    column: string
): { id: number | null; issue: BuildIssue | null } {
    const trimmed = raw.trim()
    if (trimmed === "") {
        return { id: null, issue: null }
    }
    const match = byName.get(normalizeName(trimmed))
    if (match !== undefined) {
        return { id: match.id, issue: null }
    }
    const suggestion = nearestName(trimmed, candidates)
    const hint = suggestion !== null ? ` — did you mean "${suggestion}"?` : ""
    return { id: null, issue: { message: `unknown ${label} "${trimmed}"${hint}`, column } }
}

/** Builds a composer record from its CSV cells (blank optional fields → null; tags split on ";"). */
export function buildComposer(cells: Record<string, string>): BuildResult {
    const issues: BuildIssue[] = []
    const name = cells.name.trim()
    if (name === "") {
        issues.push({ message: "name is required", column: "name" })
    }
    return {
        record: {
            name,
            role: stringOrNull(cells.role),
            birth_year: numberOrNull(cells.birth_year),
            death_year: numberOrNull(cells.death_year),
            country: cells.country.trim() === "" ? null : normalizeCountryCode(cells.country),
            bio: stringOrNull(cells.bio),
            image: stringOrNull(cells.image),
            tags: splitList(cells.tags)
        },
        issues
    }
}

/**
 * Builds a name-only "inactive placeholder" contributor from its CSV cells. Extra columns are ignored; the
 * blank identity_email is filled with a generated fallback address server-side. No permissions are conferred.
 */
export function buildContributor(cells: Record<string, string>): BuildResult {
    const issues: BuildIssue[] = []
    const name = cells.name.trim()
    if (name === "") {
        issues.push({ message: "name is required", column: "name" })
    }
    return {
        record: {
            name,
            class_year: null,
            major: null,
            phases: null,
            bio: null,
            public_email: null,
            identity_email: "",
            image: null,
            roles: [],
            tags: [],
            active: false,
            admin: false
        },
        issues
    }
}

/**
 * Builds a composition record from its CSV cells, resolving composer/contributor names to ids and mapping
 * the free-text contribution period to phase numbers. Unresolved names and unmapped non-blank periods are
 * reported as issues (with typo suggestions); the resulting record's unresolved id fields are left null so
 * the authoritative server dry-run reports any remaining problems.
 */
export function buildComposition(cells: Record<string, string>, ctx: WorksContext): BuildResult {
    const issues: BuildIssue[] = []
    const name = cells.name.trim()
    if (name === "") {
        issues.push({ message: "name is required", column: "name" })
    }

    const composer = resolveReference(cells.composer, ctx.composerByName, ctx.composerNames, "composer", "composer")
    if (cells.composer.trim() === "") {
        issues.push({ message: "composer is required", column: "composer" })
    } else if (composer.issue !== null) {
        issues.push(composer.issue)
    }

    const primary1 = resolveReference(
        cells.contrib_primary_1,
        ctx.contributorByName,
        ctx.contributorNames,
        "contributor",
        "contrib_primary_1"
    )
    if (cells.contrib_primary_1.trim() === "") {
        issues.push({ message: "contrib_primary_1 is required", column: "contrib_primary_1" })
    } else if (primary1.issue !== null) {
        issues.push(primary1.issue)
    }

    const primary2 = resolveReference(
        cells.contrib_primary_2,
        ctx.contributorByName,
        ctx.contributorNames,
        "contributor",
        "contrib_primary_2"
    )
    if (primary2.issue !== null) {
        issues.push(primary2.issue)
    }

    // list-valued references: every named entry must resolve, else the row is blocked
    const additional = splitList(cells.contrib_addl).map((entry) =>
        resolveReference(entry, ctx.contributorByName, ctx.contributorNames, "contributor", "contrib_addl")
    )
    for (const resolved of additional) {
        if (resolved.issue !== null) {
            issues.push(resolved.issue)
        }
    }
    const secondary = splitList(cells.author_secondary).map((entry) =>
        resolveReference(entry, ctx.composerByName, ctx.composerNames, "composer", "author_secondary")
    )
    for (const resolved of secondary) {
        if (resolved.issue !== null) {
            issues.push(resolved.issue)
        }
    }

    // free-text contribution period → phase numbers (blank period → no phases, no mapping required)
    const periodRaw = cells.contribution_period.trim()
    let phases: number[] = []
    if (periodRaw !== "") {
        const mapping = ctx.phaseMap.get(periodRaw) ?? ""
        phases = parsePhases(mapping)
        if (phases.length === 0) {
            issues.push({
                message: `contribution period "${periodRaw}" is not mapped to a phase`,
                column: "contribution_period"
            })
        }
    }

    // a rating member that is non-blank but out of range is silently nulled by constructRating (indistinguishable
    // from "not rated"), so check for that separately and block the row instead of dropping the data
    issues.push(
        ...ratingIssues(stringOrNull(cells.rating_suzuki), stringOrNull(cells.rating_nyssma)).map((message) => ({
            message
        }))
    )

    return {
        record: {
            name,
            composer_id: composer.id,
            contrib_primary_1: primary1.id,
            contrib_primary_2: primary2.id,
            contrib_addl: additional.map((resolved) => resolved.id).filter((id): id is number => id !== null),
            author_secondary: secondary.map((resolved) => resolved.id).filter((id): id is number => id !== null),
            type: stringOrNull(cells.type),
            part: stringOrNull(cells.part),
            key: stringOrNull(cells.key),
            range: stringOrNull(cells.range),
            position_highest: stringOrNull(cells.position_highest),
            notes_pedagogical: stringOrNull(cells.notes_pedagogical),
            notes_historical: stringOrNull(cells.notes_historical),
            notes_other: stringOrNull(cells.notes_other),
            image: stringOrNull(cells.image),
            rating: constructRating(stringOrNull(cells.rating_suzuki), stringOrNull(cells.rating_nyssma)),
            publication_info: constructPubInfo(
                stringOrNull(cells.publish_name),
                stringOrNull(cells.publish_location),
                stringOrNull(cells.publish_year),
                stringOrNull(cells.uri_type),
                stringOrNull(cells.uri)
            ),
            phases,
            tags: splitList(cells.tags)
        },
        issues
    }
}

/**
 * Builds one row's record for the given import type. For compositions, `ctx` must be supplied (it carries the
 * name resolution maps and the period→phase mapping).
 */
export function buildRecord(type: ImportType, cells: Record<string, string>, ctx: WorksContext | null): BuildResult {
    switch (type) {
        case "composers":
            return buildComposer(cells)
        case "contributors":
            return buildContributor(cells)
        case "works":
            if (ctx === null) {
                throw new Error("a WorksContext is required to build composition records")
            }
            return buildComposition(cells, ctx)
    }
}

/**
 * Flags duplicate compositions (same composer + case-insensitive name) both within the built set and against
 * the database, appending an issue to each affected result in place. Only applies to composition imports.
 *
 * @param results the per-row build results (their records must carry composer_id and name)
 * @param existingKeys the set of composer+name keys already present in the database
 */
export function flagCompositionDuplicates(results: BuildResult[], existingKeys: Set<string>): void {
    // a record contributes to the dedup key only once its composer resolved and it has a name; part is
    // optional (a null/blank part is bucketed with other part-less works by compositionKey)
    const keyOf = (result: BuildResult): string | null => {
        const composerId = result.record.composer_id
        const name = result.record.name
        if (typeof composerId === "number" && typeof name === "string" && name !== "") {
            const part = result.record.part
            return compositionKey(composerId, name, typeof part === "string" ? part : null)
        }
        return null
    }
    const keyCounts = new Map<string, number>()
    for (const result of results) {
        const key = keyOf(result)
        if (key !== null) {
            keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1)
        }
    }
    for (const result of results) {
        const key = keyOf(result)
        if (key !== null) {
            if (existingKeys.has(key)) {
                result.issues.push({ message: "a composition with this name and part already exists for this composer" })
            } else if ((keyCounts.get(key) ?? 0) > 1) {
                result.issues.push({ message: "duplicate composition (same name, composer, and part) within this file" })
            }
        }
    }
}

/**
 * Flags composer/contributor rows whose name collides with an existing record (by case-insensitive,
 * whitespace-collapsed name) or repeats another row within the file, appending an issue to each affected
 * result in place. Both entities' names are UNIQUE server-side, so a collision would abort the atomic
 * import; flagging it in the preview lets the file be cured before submitting. Mirrors the server's
 * findNameConflicts.
 *
 * @param results the per-row build results (their records must carry a name)
 * @param existingNames the normalized names already present in the database for this entity
 * @param label the entity noun used in the message (e.g. "composer", "contributor")
 */
export function flagNameDuplicates(results: BuildResult[], existingNames: Set<string>, label: string): void {
    const counts = new Map<string, number>()
    for (const result of results) {
        const name = result.record.name
        if (typeof name === "string" && name.trim() !== "") {
            const key = normalizeName(name)
            counts.set(key, (counts.get(key) ?? 0) + 1)
        }
    }
    for (const result of results) {
        const name = result.record.name
        if (typeof name === "string" && name.trim() !== "") {
            const key = normalizeName(name)
            if (existingNames.has(key)) {
                result.issues.push({ message: `a ${label} with this name already exists`, column: "name" })
            } else if ((counts.get(key) ?? 0) > 1) {
                result.issues.push({ message: `duplicate ${label} name within this file`, column: "name" })
            }
        }
    }
}
