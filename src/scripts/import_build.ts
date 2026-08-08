/**
 * scripts/import_build.ts
 *
 * The DOM-free core of the admin CSV import: it maps CSV cells to API record objects, resolves composer and
 * contributor NAME references to ids (with fuzzy "did you mean…?" suggestions), maps the free-text
 * "contribution period" to phase numbers, sanitizes/interprets messy spreadsheet text (see the per-field
 * comments in buildComposition), and reports the client-side issues/warnings that block or flag a row. The
 * DOM wiring (file picking, the editable preview grid, the server dry-run/commit) lives in import.ts and
 * calls into this module, so this logic can be unit-tested without a browser.
 *
 * Sanitization split: the general hygiene rules (trim/control-character cleanup, tag hygiene, enum-case
 * unification, image URL validation, ISBN-13 preference) mirror lib/api/d1.ts's server-side enforcement, so
 * this is a client-side preview of the same rules, not their only enforcement. The messier interpretive
 * rules specific to importing free-text spreadsheet cells (rating/publish_year digit extraction, uri_type
 * inference, the key/range/position_highest auto-correction, the secondary-author "Name (Role)" matcher)
 * are import-only: they exist to cure CSV text a purpose-built form field would never contain, and surface
 * a non-blocking `warnings` entry wherever they interpreted something ambiguous.
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
import {
    cleanText,
    normalizeUnicodeForm,
    canonicalEnumValue,
    sanitizeTags,
    preferIsbn13,
    extractLeadingInt,
    extractFirstValidToken,
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
 * A client-side blocking issue or non-blocking warning: a human-readable message plus, when it concerns
 * exactly one grid column, that column's name. `column` lets import.ts highlight the right input directly
 * instead of guessing from the message text (its columnsFromIssue heuristic, still used for server dry-run
 * issues, which arrive as plain strings) — guessing is what let an unresolved author_secondary name wrongly
 * light up the composer column, since resolveReference's generic label there is also "composer".
 */
export interface BuildIssue {
    message: string
    column?: string
}

/**
 * The outcome of building one record from its cells: the API object, any client-side blocking issues, and
 * any non-blocking warnings. A warning (e.g. "uri_type was inferred", "used the first of several keys
 * given") means the row was interpreted rather than rejected — it does not gate validate/commit the way an
 * issue does, but is worth the admin's attention.
 */
export interface BuildResult {
    record: Record<string, unknown>
    issues: BuildIssue[]
    warnings: BuildIssue[]
}

/**
 * Resolution context for composition imports: the name→record maps and candidate name lists used to resolve
 * references and suggest corrections, plus the set of composer+name keys already present in the database and
 * the admin-supplied period→phase mapping.
 */
export interface WorksContext {
    composerByName: Map<string, NamedRecord>
    /** (name, role) → composer record, used only for secondary authors (see resolveSecondaryAuthor) —
     *  composers are unique on (name, role) (idx_composers_name_role), so a name-only lookup can resolve to
     *  the wrong role variant when the same person appears under more than one role. */
    composerByNameRole: Map<string, NamedRecord>
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

/** Spellings donated CSV data commonly uses for "the composer is not known" — collapsed to the
 *  "Unknown" sentinel below. Distinct from {@link TRADITIONAL_COMPOSER_ALIASES}: this means "we don't
 *  know who wrote it", not "there was no individual composer". Matched against normalizeName's output
 *  with one trailing "." stripped, so "Unknown", "UNKNOWN COMPOSER", "unk.", and "N/A" all collapse the
 *  same way. */
const UNKNOWN_COMPOSER_ALIASES = new Set(["unknown", "unknown composer", "unk", "n/a", "na"])

/** Spellings for a work with no individual composer (the folk/anonymous-authorship case) — collapsed to
 *  the "Traditional" sentinel below. See {@link UNKNOWN_COMPOSER_ALIASES} for the contrast. */
const TRADITIONAL_COMPOSER_ALIASES = new Set(["traditional", "trad"])

/**
 * Collapses a composer-name cell to one of two canonical sentinel names — "Unknown" or "Traditional" —
 * when it's a recognized variant meaning "not a known individual composer" (see the two alias sets
 * above). Applied before {@link resolveReference} so every recognized variant resolves against the SAME
 * composer record instead of the resolver treating "Unknown", "unk.", and "N/A" as three different,
 * unresolvable names (or, once created, three near-duplicate composer rows). Returns `raw` unchanged for
 * every other name — a composer actually named e.g. "Unknown" would need to collide with this list to be
 * affected, which is not a realistic concern for a person/ensemble name.
 */
export function sentinelComposerName(raw: string): string {
    const key = normalizeName(raw).replace(/\.+$/, "")
    if (UNKNOWN_COMPOSER_ALIASES.has(key)) return "Unknown"
    if (TRADITIONAL_COMPOSER_ALIASES.has(key)) return "Traditional"
    return raw
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

/** Parses an optional string cell: blank (after control-character/whitespace cleanup) → null; otherwise the
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
 * Extracts a rating/publish_year cell's leading digits, tolerating stray prose around the number (e.g.
 * "Level 5 stars" -> "5", "c. 1923" -> "1923", "(1923?)" -> "1923"); blank stays blank. Import-only: a
 * purpose-built number input would never contain this kind of text.
 */
function digitsOrRaw(raw: string): string | null {
    const cleaned = cleanText(raw)
    if (cleaned === "") {
        return null
    }
    const extracted = extractLeadingInt(cleaned)
    return extracted === null ? cleaned : extracted.toString()
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
 * Builds a (normalized name, normalized role) → record map for composer secondary-author resolution.
 * Composers are unique on (name, role) (idx_composers_name_role), so — unlike the primary `composer`
 * field's plain indexByName lookup — this lets the same name resolve to a different id depending on the
 * role a secondary-author entry names (or defaults to; see resolveSecondaryAuthor).
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
    const trimmed = cleanText(raw)
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

/**
 * Parses a secondary-author entry's optional "(Role)" suffix — e.g. "J.S. Bach (arranger)" — defaulting to
 * "arranger" when no role is given (owner decision: an unannotated secondary-author credit is almost always
 * an arrangement). The role's casing is unified against AuthorRole when it matches one of the six canonical
 * values, mirroring the general enum-case-unification rule.
 */
function parseSecondaryAuthorEntry(raw: string): { name: string; role: string } {
    const cleaned = cleanText(raw)
    const match = /^(.*)\(([^()]*)\)\s*$/.exec(cleaned)
    if (match === null) {
        return { name: cleaned, role: AuthorRole.ARRANGER }
    }
    const name = cleanText(match[1])
    const roleRaw = cleanText(match[2])
    const role = roleRaw === "" ? AuthorRole.ARRANGER : (canonicalEnumValue(roleRaw, Object.values(AuthorRole)) ?? roleRaw)
    return { name, role }
}

/**
 * Resolves a composition's secondary-author entry ("Name" or "Name (Role)") to a composer id via the
 * (name, role) index (see {@link parseSecondaryAuthorEntry} and `WorksContext.composerByNameRole`) — unlike
 * {@link resolveReference}, which the primary `composer` field still uses and which cannot disambiguate two
 * composers who share a name under different roles.
 */
function resolveSecondaryAuthor(
    raw: string,
    ctx: WorksContext,
    column: string
): { id: number | null; issue: BuildIssue | null } {
    const parsed = parseSecondaryAuthorEntry(raw)
    if (parsed.name === "") {
        return { id: null, issue: null }
    }
    const name = sentinelComposerName(parsed.name)
    const role = parsed.role
    const key = `${normalizeName(name)} ${normalizeName(role)}`
    const match = ctx.composerByNameRole.get(key)
    if (match !== undefined) {
        return { id: match.id, issue: null }
    }
    const suggestion = nearestName(name, ctx.composerNames)
    const hint = suggestion !== null ? ` — did you mean "${suggestion}"?` : ""
    return { id: null, issue: { message: `unknown composer "${name}" with role "${role}"${hint}`, column } }
}

/** Builds a composer record from its CSV cells (blank optional fields → null; tags split on ";"). */
export function buildComposer(cells: Record<string, string>): BuildResult {
    const issues: BuildIssue[] = []
    const name = normalizeUnicodeForm(cleanText(cells.name))
    if (name === "") {
        issues.push({ message: "name is required", column: "name" })
    }

    // role is a NOT NULL column, but (unlike name) that was never enforced client-side — blank slipped
    // through to a generic server dry-run failure instead of a clear preview issue
    const roleRaw = cleanText(cells.role)
    if (roleRaw === "") {
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
 * Builds a name-only "inactive placeholder" contributor from its CSV cells. Extra columns are ignored; the
 * blank identity_email is filled with a generated fallback address server-side. No permissions are conferred.
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
 * the free-text contribution period to phase numbers. Unresolved names and unmapped non-blank periods are
 * reported as issues (with typo suggestions); the resulting record's unresolved id fields are left null so
 * the authoritative server dry-run reports any remaining problems.
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
    // secondary authors resolve on (name, role), not name alone — see resolveSecondaryAuthor
    const secondary = splitList(cells.author_secondary).map((entry) => resolveSecondaryAuthor(entry, ctx, "author_secondary"))
    for (const resolved of secondary) {
        if (resolved.issue !== null) {
            issues.push(resolved.issue)
        }
    }

    // free-text contribution period → phase numbers (blank period → no phases, no mapping required)
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

    // key: usually a single value, but a stray list (often semicolon-delimited, matching this CSV's own
    // in-cell list separator) is a common mis-entry; take the first non-blank segment and warn, then
    // case-unify the result against the Key enum
    const keyRawCell = cleanText(cells.key)
    let key: string | null = null
    if (keyRawCell !== "") {
        const segments = keyRawCell
            .split(CSV_LIST_SEPARATOR)
            .map((segment) => cleanText(segment))
            .filter((segment) => segment !== "")
        if (segments.length > 1) {
            warnings.push({
                message: `multiple keys given ("${keyRawCell}"); used the first ("${segments[0]}")`,
                column: "key"
            })
        }
        const first = segments[0] ?? ""
        key = canonicalEnumValue(first, Object.values(Key)) ?? first
    }

    // range: tolerate whitespace around the "-" separator and respell a double-accidental note (e.g. "Fx3")
    // to the single-accidental/natural spelling isValidPosition's pattern accepts (see cleanPitchRangeCell)
    const rangeRaw = cleanText(cells.range)
    const range = rangeRaw === "" ? null : cleanPitchRangeCell(rangeRaw)

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
    // cell is first reduced to its leading digits, tolerating prose like "Level 5 stars".
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

    const tagResult = sanitizeTags(splitList(cells.tags), MAX_TAG_LENGTH, MAX_TAGS_PER_RECORD)
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
            part: stringOrNull(cells.part),
            key,
            range,
            position_highest,
            notes_pedagogical: stringOrNull(cells.notes_pedagogical),
            notes_historical: stringOrNull(cells.notes_historical),
            notes_other: stringOrNull(cells.notes_other),
            image: imageRaw === "" ? null : imageRaw,
            rating: constructRating(suzuki, nyssma),
            publication_info: constructPubInfo(
                stringOrNull(cells.publish_name),
                stringOrNull(cells.publish_location),
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
 * Builds a row's dedup key: its normalized name alone, or name+role when the record carries a `role`
 * (composers only — mirrors idx_composers_name_role, UNIQUE on (name, role), not name alone). Contributor
 * records have no `role` field, so they fall back to the name-only key (contributors.name is UNIQUE alone).
 */
function nameDuplicateKey(record: Record<string, unknown>): string | null {
    const name = record.name
    if (typeof name !== "string" || name.trim() === "") return null
    const role = record.role
    return typeof role === "string" ? `${normalizeName(name)} ${normalizeName(role)}` : normalizeName(name)
}

/**
 * Flags composer/contributor rows whose (name[, role]) collides with an existing record or repeats another
 * row within the file, appending an issue to each affected result in place. contributors.name is UNIQUE
 * server-side; composers has idx_composers_name_role, UNIQUE on (name, role) — a collision on either would
 * abort the atomic import, so flagging it in the preview lets the file be cured before submitting. Mirrors
 * the server's findNameConflicts.
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
