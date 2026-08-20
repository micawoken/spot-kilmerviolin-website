/**
 * scripts/import_build.ts
 *
 * The DOM-free core of the admin CSV import
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

import { nearestName } from "../lib/api/csv"
import { isValidImageUrl, isValidPosition, normalizeCountryCode } from "../lib/api/validation"
import { AuthorRole, Key, WorkType } from "../lib/api/common"
import { isSentinelComposerName, sentinelComposerName } from "../lib/api/composer_sentinel"
import {
    cleanText,
    normalizeUnicodeForm,
    canonicalEnumValue,
    sanitizeTags,
    preferIsbn13,
    extractLeadingInt,
    extractFirstValidToken,
    extractFirstMatch,
    collapseDoubleSpaces,
    toTitleCase,
    escapeRegExp,
    cleanPitchRangeCell,
    inferUriType
} from "../lib/api/sanitize"
import { MAX_TAG_LENGTH, MAX_TAGS_PER_RECORD } from "../consts"
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
 * A client-side blocking issue or non-blocking warning
 */
export interface BuildIssue {
    message: string
    column?: string
}

/**
 * The outcome of building one record from its cells: the API object, any client-side blocking issues, and
 * any non-blocking warnings
 */
export interface BuildResult {
    record: Record<string, unknown>
    issues: BuildIssue[]
    warnings: BuildIssue[]
}

/**
 * Resolution context for composition imports
 */
export interface WorksContext {
    composerByName: Map<string, NamedRecord>
    /** (name, role) -> composer record, used only for secondary authors */
    composerByNameRole: Map<string, NamedRecord>
    /** normalized name -> every composer record sharing it, used for secondary-author role fallback */
    composerRecordsByName: Map<string, Array<NamedRecord & { role: string }>>
    contributorByName: Map<string, NamedRecord>
    composerNames: string[]
    contributorNames: string[]
    existingKeys: Set<string>
    /** admin-supplied mapping of each distinct free-text period to its phase-number input (raw string) */
    phaseMap: Map<string, string>
}

/** The per-type column set and whether extra columns are tolerated (contributors ignore extras) */
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
 * Composite dedup key for a composition: composer id + case-insensitively-normalized name + part
 */
export function compositionKey(composerId: number, name: string, part: string | null): string {
    return `${composerId} ${normalizeName(name)} ${normalizeName(part ?? "")}`
}

/** Parses an optional integer cell: blank -> null; otherwise the parsed value, or null when unparseable. */
function numberOrNull(raw: string): number | null {
    const trimmed = raw.trim()
    if (trimmed === "") {
        return null
    }
    const value = parseInt(trimmed, 10)
    return isNaN(value) ? null : value
}

/** Parses an optional string cell: blank (after control-character/whitespace cleanup) -> null; otherwise the
 *  cleaned value. */
function stringOrNull(raw: string): string | null {
    const cleaned = cleanText(raw)
    return cleaned === "" ? null : cleaned
}

/** Splits a list-valued cell on the in-cell separator (";"), cleaning and dropping empty entries. */
function splitList(raw: string): string[] {
    return raw
        .split(CSV_LIST_SEPARATOR)
        .map((part) => cleanText(part))
        .filter((part) => part.length > 0)
}

/**
 * Extracts a rating/publish_year cell's leading digits, tolerating stray prose around the number
 */
function digitsOrRaw(raw: string): string | null {
    const cleaned = cleanText(raw)
    if (cleaned === "") {
        return null
    }
    const extracted = extractLeadingInt(cleaned)
    return extracted === null ? cleaned : extracted.toString()
}

/**
 * Matches any canonical Key enum spelling, word-bounded so a value can't match inside a longer word. Used
 * to extract a key embedded in free text (see buildComposition), the same first-match approach digitsOrRaw
 * uses for the number columns.
 */
const KEY_MATCH_PATTERN = new RegExp(`\\b(?:${Object.values(Key).map(escapeRegExp).join("|")})\\b`)

/**
 * Matches a two-note pitch-range chunk (letter, optional accidental incl. double-sharp/flat, 1-2 digit
 * octave, dash, repeat) embedded in free text. Used to extract a range embedded in free text (see
 * buildComposition), the same first-match approach digitsOrRaw uses for the number columns.
 */
const RANGE_MATCH_PATTERN = /[A-G](?:x|bb|[#b])?\d{1,2}\s*-\s*[A-G](?:x|bb|[#b])?\d{1,2}/i

/** Parses a phase-map input (comma/semicolon separated) into a sorted, de-duplicated list of phase numbers */
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

/** Builds a name->record map plus the candidate-name list for a set of known records */
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
 * Builds a (normalized name, normalized role) -> record map for composer secondary-author resolution
 */
export function indexByNameRole(records: Array<NamedRecord & { role: string }>): Map<string, NamedRecord> {
    const byNameRole = new Map<string, NamedRecord>()
    for (const record of records) {
        const key = `${normalizeName(record.name)} ${normalizeName(record.role)}`
        if (!byNameRole.has(key)) {
            byNameRole.set(key, { id: record.id, name: record.name })
        }
    }
    return byNameRole
}

/**
 * Groups composer records by normalized name, used for composer secondary-author role fallback
 */
export function groupByName(records: Array<NamedRecord & { role: string }>): Map<string, Array<NamedRecord & { role: string }>> {
    const byName = new Map<string, Array<NamedRecord & { role: string }>>()
    for (const record of records) {
        const key = normalizeName(record.name)
        const group = byName.get(key)
        if (group === undefined) {
            byName.set(key, [record])
        } else {
            group.push(record)
        }
    }
    return byName
}

/**
 * Resolves a single (required or optional) name reference to an id.
 *
 * @param label the human noun used in the message (e.g. "composer", "contributor")
 * @param column the exact grid column this reference came from
 * @returns the resolved id (or null when blank/unresolved) and, when unresolved, a human-readable issue that
 *   includes a suggestion
 */
function resolveReference(
    raw: string,
    byName: Map<string, NamedRecord>,
    candidates: string[],
    label: string,
    column: string
): { id: number | null; issue: BuildIssue | null } {
    const trimmed = cleanText(raw)
    if (trimmed === "") {
        return { id: null, issue: null }
    }
    const match = byName.get(normalizeName(trimmed))
    if (match !== undefined) {
        return { id: match.id, issue: null }
    }
    const suggestion = nearestName(trimmed, candidates)
    const hint = suggestion !== null ? ` - did you mean "${suggestion}"?` : ""
    return { id: null, issue: { message: `unknown ${label} "${trimmed}"${hint}`, column } }
}

/**
 * Parses a secondary-author entry's optional "(Role)" suffix
 */
function parseSecondaryAuthorEntry(raw: string): { name: string; role: string } {
    const cleaned = cleanText(raw)
    const match = /^(.*)\(([^()]*)\)\s*$/.exec(cleaned)
    if (match === null) {
        return { name: cleaned, role: AuthorRole.ARRANGER }
    }
    const name = cleanText(match[1])
    const roleRaw = cleanText(match[2])
    const role =
        roleRaw === "" ? AuthorRole.ARRANGER : (canonicalEnumValue(roleRaw, Object.values(AuthorRole)) ?? roleRaw)
    return { name, role }
}

/**
 * Resolves a composition's secondary-author entry ("Name" or "Name (Role)") to a composer id
 */
function resolveSecondaryAuthor(
    raw: string,
    ctx: WorksContext,
    column: string
): { id: number | null; issue: BuildIssue | null; warning: BuildIssue | null } {
    const parsed = parseSecondaryAuthorEntry(raw)
    if (parsed.name === "") {
        return { id: null, issue: null, warning: null }
    }
    const name = sentinelComposerName(parsed.name)
    const role = parsed.role
    const key = `${normalizeName(name)} ${normalizeName(role)}`
    const match = ctx.composerByNameRole.get(key)
    if (match !== undefined) {
        return { id: match.id, issue: null, warning: null }
    }

    // name/role mismatch (e.g. arranger assumed by default, but the composer is on file under a different
    // role) - fall back to a role other than arranger/composer, but only when exactly one such candidate
    // exists; two or more is ambiguous and must be reported instead of guessed
    const otherRoleCandidates = (ctx.composerRecordsByName.get(normalizeName(name)) ?? []).filter((record) => {
        const recordRole = normalizeName(record.role)
        return recordRole !== normalizeName(AuthorRole.ARRANGER) && recordRole !== normalizeName(AuthorRole.COMPOSER)
    })
    if (otherRoleCandidates.length === 1) {
        const candidate = otherRoleCandidates[0]
        return {
            id: candidate.id,
            issue: null,
            warning: {
                message: `"${name}" has no "${role}" entry - assumed the "${candidate.role}" entry instead`,
                column
            }
        }
    }
    if (otherRoleCandidates.length > 1) {
        const roles = otherRoleCandidates.map((candidate) => candidate.role).join(", ")
        return {
            id: null,
            issue: { message: `"${name}" has no "${role}" entry and multiple other roles match (${roles})`, column },
            warning: null
        }
    }

    const suggestion = nearestName(name, ctx.composerNames)
    const hint = suggestion !== null ? ` - did you mean "${suggestion}"?` : ""
    return {
        id: null,
        issue: { message: `unknown composer "${name}" with role "${role}"${hint}`, column },
        warning: null
    }
}

/** Builds a composer record from its CSV cells (blank optional fields -> null; tags split on ";"). */
export function buildComposer(cells: Record<string, string>): BuildResult {
    const issues: BuildIssue[] = []
    const name = sentinelComposerName(normalizeUnicodeForm(cleanText(cells.name)))
    if (name === "") {
        issues.push({ message: "name is required", column: "name" })
    }
    const isSentinel = isSentinelComposerName(name)

    // role is a NOT NULL column, but (unlike name) that was never enforced client-side - blank slipped
    // through to a generic server dry-run failure instead of a clear preview issue. A sentinel identity
    // ("Unknown"/"Traditional") is exempt: applySentinelComposerDefaults fills it server-side.
    const roleRaw = cleanText(cells.role)
    if (roleRaw === "" && !isSentinel) {
        issues.push({ message: "role is required", column: "role" })
    }
    const role = roleRaw === "" ? "" : (canonicalEnumValue(roleRaw, Object.values(AuthorRole)) ?? roleRaw)

    const imageRaw = cleanText(cells.image)
    if (imageRaw !== "" && !isValidImageUrl(imageRaw)) {
        issues.push({ message: "image is not a valid URL or internal path", column: "image" })
    }

    const tagResult = sanitizeTags(splitList(cells.tags), MAX_TAG_LENGTH, MAX_TAGS_PER_RECORD)
    if (tagResult.error !== null) {
        issues.push({ message: tagResult.error, column: "tags" })
    }

    return {
        record: {
            name,
            role,
            birth_year: numberOrNull(cells.birth_year),
            death_year: numberOrNull(cells.death_year),
            country: cells.country.trim() === "" ? null : normalizeCountryCode(cells.country),
            bio: stringOrNull(cells.bio),
            image: imageRaw === "" ? null : imageRaw,
            tags: tagResult.tags
        },
        issues,
        warnings: []
    }
}

/**
 * Builds a name-only "inactive placeholder" contributor from its CSV cells
 */
export function buildContributor(cells: Record<string, string>): BuildResult {
    const issues: BuildIssue[] = []
    const name = normalizeUnicodeForm(cleanText(cells.name))
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
        issues,
        warnings: []
    }
}

/**
 * Builds a composition record from its CSV cells, resolving composer/contributor names to ids and mapping
 * the free-text contribution period to phase numbers
 */
export function buildComposition(cells: Record<string, string>, ctx: WorksContext): BuildResult {
    const issues: BuildIssue[] = []
    const warnings: BuildIssue[] = []
    const name = normalizeUnicodeForm(cleanText(cells.name))
    if (name === "") {
        issues.push({ message: "name is required", column: "name" })
    }

    const composer = resolveReference(
        sentinelComposerName(cells.composer),
        ctx.composerByName,
        ctx.composerNames,
        "composer",
        "composer"
    )
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
    // secondary authors resolve on (name, role), not name alone - see resolveSecondaryAuthor
    const secondary = splitList(cells.author_secondary).map((entry) =>
        resolveSecondaryAuthor(entry, ctx, "author_secondary")
    )
    for (const resolved of secondary) {
        if (resolved.issue !== null) {
            issues.push(resolved.issue)
        }
        if (resolved.warning !== null) {
            warnings.push(resolved.warning)
        }
    }

    // free-text contribution period -> phase numbers (blank period-> no phases, no mapping required)
    const periodRaw = cleanText(cells.contribution_period)
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

    // type is a NOT NULL, closed-enum column; case-unify against WorkType and (like composer role) flag a
    // blank value client-side instead of only surfacing it as a generic server dry-run failure
    const typeRaw = cleanText(cells.type)
    if (typeRaw === "") {
        issues.push({ message: "type is required", column: "type" })
    }
    const type = typeRaw === "" ? null : (canonicalEnumValue(typeRaw, Object.values(WorkType)) ?? typeRaw)

    // key: title-case the cell, then extract the first canonical Key spelling embedded in it, tolerating
    // stray prose around it - the same first-match approach digitsOrRaw uses for the number columns.
    // Title-casing first lets the match be a plain lookup against the (already title-cased) enum values.
    const keyRawCell = cleanText(cells.key)
    let key: string | null = null
    if (keyRawCell !== "") {
        const titleCased = toTitleCase(keyRawCell)
        const matched = extractFirstMatch(titleCased, KEY_MATCH_PATTERN)
        key = matched ?? titleCased
        if (matched !== null && matched !== titleCased) {
            warnings.push({ message: `key "${keyRawCell}" was interpreted as "${matched}"`, column: "key" })
        }
    }

    // range: extract the first pitch-range-shaped chunk embedded in the cell, tolerating stray prose around
    // it (same first-match approach as key/the number columns), then respell a double-accidental note (e.g.
    // "Fx3") to the single-accidental/natural spelling isValidPosition's pattern accepts (cleanPitchRangeCell)
    const rangeRaw = cleanText(cells.range)
    let range: string | null = null
    if (rangeRaw !== "") {
        const matched = extractFirstMatch(rangeRaw, RANGE_MATCH_PATTERN)
        if (matched === null) {
            range = rangeRaw
        } else {
            range = cleanPitchRangeCell(matched)
            if (matched !== rangeRaw) {
                warnings.push({ message: `range "${rangeRaw}" was interpreted as "${range}"`, column: "range" })
            }
        }
    }

    // position_highest: if the raw value isn't already valid, look for a standalone token that is (e.g.
    // "Position III (approx)" -> "III") and warn that it was interpreted; otherwise leave it as-is so the
    // existing server-side rejection is unchanged
    const posRaw = cleanText(cells.position_highest)
    let position_highest: string | null = null
    if (posRaw !== "") {
        if (isValidPosition(posRaw)) {
            position_highest = posRaw
        } else {
            const extracted = extractFirstValidToken(posRaw, isValidPosition)
            if (extracted !== null) {
                position_highest = extracted
                warnings.push({
                    message: `position_highest "${posRaw}" was interpreted as "${extracted}"`,
                    column: "position_highest"
                })
            } else {
                position_highest = posRaw
            }
        }
    }

    const imageRaw = cleanText(cells.image)
    if (imageRaw !== "" && !isValidImageUrl(imageRaw)) {
        issues.push({ message: "image is not a valid URL or internal path", column: "image" })
    }

    // a rating member that is non-blank but out of range is silently nulled by constructRating (indistinguishable
    // from "not rated"), so check for that separately and block the row instead of dropping the data. Each raw
    // cell is first reduced to its leading digits, tolerating prose like "Level 5 stars"
    const suzuki = digitsOrRaw(cells.rating_suzuki)
    const nyssma = digitsOrRaw(cells.rating_nyssma)
    issues.push(...ratingIssues(suzuki, nyssma).map((message) => ({ message })))

    // uri_type: infer from the uri's shape when a uri is given but no type was, and warn that it was
    // inferred rather than declared
    const uriRaw = stringOrNull(cells.uri)
    let uriType = stringOrNull(cells.uri_type)
    if (uriRaw !== null && uriType === null) {
        const inferred = inferUriType(uriRaw)
        if (inferred !== null) {
            uriType = inferred
            warnings.push({
                message: `uri_type was not specified; inferred "${inferred}" from the uri`,
                column: "uri_type"
            })
        }
    }
    // prefer ISBN-13 once the type is known to be isbn (general rule, applied regardless of whether the
    // type was declared or just inferred above)
    const uri = uriType === "isbn" && uriRaw !== null ? preferIsbn13(uriRaw) : uriRaw

    const tagResult = sanitizeTags(splitList(collapseDoubleSpaces(cells.tags)), MAX_TAG_LENGTH, MAX_TAGS_PER_RECORD)
    if (tagResult.error !== null) {
        issues.push({ message: tagResult.error, column: "tags" })
    }

    return {
        record: {
            name,
            composer_id: composer.id,
            contrib_primary_1: primary1.id,
            contrib_primary_2: primary2.id,
            contrib_addl: additional.map((resolved) => resolved.id).filter((id): id is number => id !== null),
            author_secondary: secondary.map((resolved) => resolved.id).filter((id): id is number => id !== null),
            type,
            // name/part directly identify the work, so unlike the free-text fields below their spacing is
            // left as entered (see collapseDoubleSpaces call sites)
            part: stringOrNull(cells.part),
            key,
            range,
            position_highest,
            notes_pedagogical: stringOrNull(collapseDoubleSpaces(cells.notes_pedagogical)),
            notes_historical: stringOrNull(collapseDoubleSpaces(cells.notes_historical)),
            notes_other: stringOrNull(collapseDoubleSpaces(cells.notes_other)),
            image: imageRaw === "" ? null : imageRaw,
            rating: constructRating(suzuki, nyssma),
            publication_info: constructPubInfo(
                stringOrNull(collapseDoubleSpaces(cells.publish_name)),
                stringOrNull(collapseDoubleSpaces(cells.publish_location)),
                digitsOrRaw(cells.publish_year),
                uriType,
                uri
            ),
            phases,
            tags: tagResult.tags
        },
        issues,
        warnings
    }
}

/**
 * Builds one row's record for the given import type. For compositions, `ctx` must be supplied (it carries the
 * name resolution maps and the period->phase mapping).
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
 * the database, appending an issue to each affected result in place
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
                result.issues.push({
                    message: "a composition with this name and part already exists for this composer"
                })
            } else if ((keyCounts.get(key) ?? 0) > 1) {
                result.issues.push({
                    message: "duplicate composition (same name, composer, and part) within this file"
                })
            }
        }
    }
}

/**
 * Builds a row's dedup key: its normalized name alone, or name+role when the record carries a `role`
 */
function nameDuplicateKey(record: Record<string, unknown>): string | null {
    const name = record.name
    if (typeof name !== "string" || name.trim() === "") return null
    const role = record.role
    return typeof role === "string" ? `${normalizeName(name)} ${normalizeName(role)}` : normalizeName(name)
}

/**
 * Flags composer/contributor rows whose (name[, role]) collides with an existing record or repeats another
 * row within the file, appending an issue to each affected result in place
 *
 * @param results the per-row build results (their records must carry a name, and a role for composers)
 * @param existingKeys the {@link nameDuplicateKey}-shaped keys already present in the database for this entity
 * @param label the entity noun used in the message (e.g. "composer", "contributor")
 */
export function flagNameDuplicates(results: BuildResult[], existingKeys: Set<string>, label: string): void {
    const counts = new Map<string, number>()
    for (const result of results) {
        const key = nameDuplicateKey(result.record)
        if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const result of results) {
        const key = nameDuplicateKey(result.record)
        if (key !== null) {
            if (existingKeys.has(key)) {
                result.issues.push({ message: `a ${label} with this name already exists`, column: "name" })
            } else if ((counts.get(key) ?? 0) > 1) {
                result.issues.push({ message: `duplicate ${label} name within this file`, column: "name" })
            }
        }
    }
}
