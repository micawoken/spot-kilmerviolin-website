/**
 * lib/search/facets.ts
 *
 * Shared core for advanced database search
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

import { AuthorRole, Key, WorkType, normalizeKeyForSearch } from "../api/common"
import { countryCodeName } from "../../scripts/format"
import { ENTITY_NOUN_LABELS, ENTITY_NOUN_SLUGS, type EntityNoun } from "../compositor/entity-fields"

/**
 * One row of the build-time facet index (search/advanced/db-search-index.json.ts)
 */
export interface FacetEntry {
    url: string
    noun: EntityNoun
    name: string
    /** composition only - composer's display name, for substring matching and result subtitles */
    composer?: string
    composerId?: number
    /** composition only - resolved display names of `author_secondary`, joined with ", " */
    secondaryAuthors?: string
    /** composition only - instrument part (e.g. "violin"), free text rather than an enum */
    part?: string
    /** composition only - {@link normalizeKeyForSearch} pitch-class reference, e.g. "7-minor" */
    keyRef?: string
    /** composition only - raw WorkType value */
    type?: string
    /** composition only - publish_year */
    year?: number
    /** composition only - publication_info.name */
    publisher?: string
    suzuki?: number
    nyssma?: number
    /** composer, composition, and contributor - free-form tags, joined with ", " */
    tags?: string
    /** composer only - ISO 3166-1 alpha-2 code (matched against both the code and its resolved name) */
    country?: string
    /** composer only - raw role text */
    role?: string
    birthYear?: number
    deathYear?: number
    /** contributor only - not a filterable field */
    classYear?: number
}

export type TextOperator = "contains" | "is" | "regex" | "fuzzy"
export interface TextCriterion {
    op: TextOperator
    value: string
}

export type NumberOperator = "is" | "before" | "after" | "atLeast" | "atMost" | "between" | "around" | "alive"
export interface NumberCriterion {
    op: NumberOperator
    /** unused (and not read) when op is "alive" - that operator alone needs no value */
    value: number
    /** only meaningful (and only read) when op is "between" */
    valueTo?: number
}

/** "Around" tolerance for publish/birth/death year, in years either side of the given value */
const AROUND_YEAR_TOLERANCE = 5

/** Structured search criteria */
export interface FacetCriteria {
    nouns?: EntityNoun[]
    composer?: TextCriterion
    secondaryAuthors?: TextCriterion
    part?: TextCriterion
    keyRef?: string
    type?: string
    year?: NumberCriterion
    publisher?: TextCriterion
    suzuki?: NumberCriterion
    nyssma?: NumberCriterion
    tags?: TextCriterion
    country?: TextCriterion
    role?: string
    birthYear?: NumberCriterion
    deathYear?: NumberCriterion
}

export type FacetControlKind = "select" | "text" | "number"

export interface AdvancedFieldOption {
    label: string
    value: string
}

export interface FacetOperatorOption {
    value: TextOperator | NumberOperator
    label: string
}

/** One criterion's shared shape: URL/form param name, label, control kind, and (for a select) its
 *  options, or (for text/number) its available operators */
export interface AdvancedFieldDef {
    /** also the FacetCriteria/URLSearchParams key this control reads and writes */
    param: string
    label: string
    control: FacetControlKind
    options?: AdvancedFieldOption[]
    placeholder?: string
    /** present only for text/number fields; absent (select fields) means "exact match, no operator UI" */
    operators?: readonly FacetOperatorOption[]
    /** number fields only - rendered as the value/"to" inputs' min/max attributes */
    min?: number
    max?: number
    /** which entity nouns this criterion is meaningful for - grouping metadata for renderers; matching
     *  itself needs no noun gate, since a field absent on a noun's entries just never matches it */
    nouns: EntityNoun[]
}

const ALL_NOUNS: EntityNoun[] = ["composer", "composition", "contributor"]

/** Groups the 42-member `Key` enum into its 24 enharmonic-collapsed (pitch-class x mode) options,
 *  labelling paired spellings together (e.g. "C#/Db major") rather than arbitrarily picking one */
export function keyOptions(): AdvancedFieldOption[] {
    const spelling = (note: string): string => {
        if (note.length === 1) return note
        return note[1] === "#" ? `${note[0]}♯` : `${note[0]}♭`
    }
    const order: string[] = []
    const notesByRef = new Map<string, { mode: string; notes: string[] }>()
    for (const raw of Object.values(Key)) {
        const key = raw as Key
        const ref = normalizeKeyForSearch(key)
        const [note, mode] = key.split(" ")
        let bucket = notesByRef.get(ref)
        if (!bucket) {
            bucket = { mode: mode.toLowerCase(), notes: [] }
            notesByRef.set(ref, bucket)
            order.push(ref)
        }
        bucket.notes.push(spelling(note))
    }
    return order.map((ref) => {
        const { mode, notes } = notesByRef.get(ref) as { mode: string; notes: string[] }
        return { value: ref, label: `${notes.join("/")} ${mode}` }
    })
}

const KEY_OPTIONS = keyOptions()
const KEY_LABEL_BY_REF = new Map(KEY_OPTIONS.map((option) => [option.value, option.label]))

/** Display label for a pitch-class reference (e.g. "7-minor" -> "G#/Ab minor"), or the ref itself if unknown. */
export function keyRefLabel(ref: string): string {
    return KEY_LABEL_BY_REF.get(ref) ?? ref
}

// Reverse index from a query-syntax key token ("g-minor", "c#-major", "ab-major" - note+accidental exactly
// as the Key enum spells it, lowercased, hyphen before the mode) to its pitch-class reference
const KEY_REF_BY_TOKEN = new Map<string, string>(
    Object.values(Key).map((raw) => {
        const key = raw as Key
        const [note, mode] = key.split(" ")
        return [`${note.toLowerCase()}-${mode.toLowerCase()}`, normalizeKeyForSearch(key)]
    })
)

function parseKeyToken(raw: string): string | undefined {
    return KEY_REF_BY_TOKEN.get(raw.trim().toLowerCase())
}

function workTypeOptions(): AdvancedFieldOption[] {
    return Object.values(WorkType).map((value) => ({ label: value, value }))
}

/** The three entity-type options for the advanced-search noun checkbox group */
export function nounOptions(): AdvancedFieldOption[] {
    return ALL_NOUNS.map((noun) => ({ label: ENTITY_NOUN_LABELS[noun], value: ENTITY_NOUN_SLUGS[noun] }))
}

/** Lightweight subsequence fuzzy match  */
function fuzzyMatch(text: string, query: string): boolean {
    const t = text.toLowerCase()
    let searchFrom = 0
    for (const ch of query.toLowerCase()) {
        const index = t.indexOf(ch, searchFrom)
        if (index === -1) return false
        searchFrom = index + 1
    }
    return true
}

/**
 * Longest accepted user-supplied regex pattern
 */
export const MAX_REGEX_PATTERN_LENGTH = 200

function isValidRegex(pattern: string): boolean {
    if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
        return false
    }
    try {
        new RegExp(pattern)
        return true
    } catch {
        return false
    }
}

/**
 * Milliseconds a pattern may take on the probe below before it is refused
 *
 */
const REGEX_PROBE_BUDGET_MS = 50

/**
 * A string built to provoke backtracking: a long single-character run that does not satisfy a trailing
 * anchor or literal; `(a+)+$` and friends explore exponentially many partitions of it
 *
 * Kept short (22 characters) on purpose
 */
const REGEX_PROBE = "a".repeat(22) + "!"

/**
 * Whether a pattern completes the probe within budget
 *
 *
 * @param {string} pattern the user-supplied pattern (already known to compile)
 * @returns {boolean} true when the pattern is fast enough to run over the dataset
 */
function isRegexFastEnough(pattern: string): boolean {
    try {
        const compiled = new RegExp(pattern, "i")
        const started = Date.now()
        compiled.test(REGEX_PROBE)
        return Date.now() - started <= REGEX_PROBE_BUDGET_MS
    } catch {
        return false
    }
}

const ANY_OPTION: AdvancedFieldOption = { label: "Any", value: "" }

/** Sentinel option value for "this field is unset on the entry" */
export const NONE_VALUE = "none"
const NONE_OPTION: AdvancedFieldOption = { label: "(None)", value: NONE_VALUE }

const TEXT_OPERATORS: readonly FacetOperatorOption[] = [
    { value: "contains", label: "Contains" },
    { value: "is", label: "Is exactly" },
    { value: "regex", label: "Regex match" },
    { value: "fuzzy", label: "Fuzzy match" }
]

const YEAR_OPERATORS: readonly FacetOperatorOption[] = [
    { value: "is", label: "Is" },
    { value: "before", label: "Before" },
    { value: "after", label: "After" },
    { value: "between", label: "Between" },
    { value: "around", label: `Around (±${AROUND_YEAR_TOLERANCE})` }
]

const RATING_OPERATORS: readonly FacetOperatorOption[] = [
    { value: "atLeast", label: "At least" },
    { value: "is", label: "Is" },
    { value: "atMost", label: "At most" },
    { value: "between", label: "Between" }
]

// Death year's own operator list, distinct from YEAR_OPERATORS (used by birth/publication year): adds
// "Alive" so a living composer (the -1 sentinel, omitted from the facets JSON entirely - see
// search/advanced/db-search-index.json.ts) can be filtered for without a year value
const DEATH_YEAR_OPERATORS: readonly FacetOperatorOption[] = [...YEAR_OPERATORS, { value: "alive", label: "Alive" }]

function authorRoleOptions(): AdvancedFieldOption[] {
    return Object.values(AuthorRole).map((value) => ({ label: value[0].toUpperCase() + value.slice(1), value }))
}

const currentYear = new Date().getFullYear()

/**
 * The shared field-definition list /search/advanced maps over to render its filter fieldset
 */
export const ADVANCED_FIELDS: readonly AdvancedFieldDef[] = [
    {
        param: "composer",
        label: "Composer",
        control: "text",
        placeholder: "e.g. Bach",
        operators: TEXT_OPERATORS,
        nouns: ["composition"]
    },
    {
        param: "secondaryAuthors",
        label: "Secondary authors",
        control: "text",
        placeholder: "e.g. Kreisler",
        operators: TEXT_OPERATORS,
        nouns: ["composition"]
    },
    {
        param: "part",
        label: "Part",
        control: "text",
        placeholder: "e.g. violin",
        operators: TEXT_OPERATORS,
        nouns: ["composition"]
    },
    {
        param: "key",
        label: "Key",
        control: "select",
        options: [ANY_OPTION, ...KEY_OPTIONS, NONE_OPTION],
        nouns: ["composition"]
    },
    {
        param: "type",
        label: "Work type",
        control: "select",
        options: [ANY_OPTION, ...workTypeOptions(), NONE_OPTION],
        nouns: ["composition"]
    },
    { param: "year", label: "Publication year", control: "number", operators: YEAR_OPERATORS, nouns: ["composition"] },
    {
        param: "publisher",
        label: "Publisher",
        control: "text",
        placeholder: "e.g. Schirmer",
        operators: TEXT_OPERATORS,
        nouns: ["composition"]
    },
    {
        param: "suzuki",
        label: "Suzuki rating",
        control: "number",
        operators: RATING_OPERATORS,
        min: 1,
        max: 10,
        nouns: ["composition"]
    },
    {
        param: "nyssma",
        label: "NYSSMA rating",
        control: "number",
        operators: RATING_OPERATORS,
        min: 1,
        max: 6,
        nouns: ["composition"]
    },
    {
        param: "tags",
        label: "Tags",
        control: "text",
        placeholder: "e.g. recital",
        operators: TEXT_OPERATORS,
        nouns: ["composer", "composition", "contributor"]
    },
    {
        param: "country",
        label: "Composer country",
        control: "text",
        placeholder: "e.g. France",
        operators: TEXT_OPERATORS,
        nouns: ["composer"]
    },
    {
        param: "role",
        label: "Composer role",
        control: "select",
        options: [ANY_OPTION, ...authorRoleOptions(), NONE_OPTION],
        nouns: ["composer"]
    },
    {
        param: "birthYear",
        label: "Birth year",
        control: "number",
        operators: YEAR_OPERATORS,
        min: 1,
        max: currentYear,
        nouns: ["composer"]
    },
    {
        param: "deathYear",
        label: "Death year",
        control: "number",
        operators: DEATH_YEAR_OPERATORS,
        min: 1,
        max: currentYear,
        nouns: ["composer"]
    }
]

const NOUN_BY_SLUG = new Map<string, EntityNoun>(
    Object.entries(ENTITY_NOUN_SLUGS).map(([noun, slug]) => [slug, noun as EntityNoun])
)

function parseNounSlug(value: string): EntityNoun | undefined {
    return NOUN_BY_SLUG.get(value.trim().toLowerCase())
}

function matchesText(entryValue: string | undefined, criterion: TextCriterion): boolean {
    const value = entryValue ?? ""
    const query = criterion.value
    switch (criterion.op) {
        case "is":
            return value.toLowerCase() === query.toLowerCase()
        case "contains":
            return value.toLowerCase().includes(query.toLowerCase())
        case "fuzzy":
            return fuzzyMatch(value, query)
        case "regex":
            // Caller validates the pattern up front (validateFacetCriteria) so a search run never reaches an
            // invalid one
            return isValidRegex(query) && new RegExp(query, "i").test(value)
    }
}

// Composer country matches both the raw ISO code and its resolved display name (e.g. "de" and "Germany"
// both hit), so this tries the criterion against each and takes either match
function matchesCountry(entry: FacetEntry, criterion: TextCriterion): boolean {
    const code = entry.country ?? ""
    const name = entry.country ? countryCodeName(entry.country) : ""
    return matchesText(code, criterion) || matchesText(name, criterion)
}

function matchesNumber(entryValue: number | undefined, criterion: NumberCriterion): boolean {
    // "Alive" is the inverse of every other operator here: a living composer has no deathYear at all (the
    // -1 sentinel is omitted from the facets JSON - see search/advanced/db-search-index.json.ts), so this is the one case
    // where "value absent" is the match, not an automatic non-match
    if (criterion.op === "alive") return entryValue === undefined
    if (entryValue === undefined) return false
    switch (criterion.op) {
        case "is":
            return entryValue === criterion.value
        case "before":
            return entryValue < criterion.value
        case "after":
            return entryValue > criterion.value
        case "atLeast":
            return entryValue >= criterion.value
        case "atMost":
            return entryValue <= criterion.value
        case "between":
            return entryValue >= criterion.value && entryValue <= (criterion.valueTo ?? criterion.value)
        case "around":
            return Math.abs(entryValue - criterion.value) <= AROUND_YEAR_TOLERANCE
    }
}

// key/type/role are all optional on FacetEntry
function matchesNullableSelect(entryValue: string | undefined, criterionValue: string): boolean {
    if (criterionValue === NONE_VALUE) return entryValue === undefined
    return entryValue === criterionValue
}

// Maps each non-noun FacetCriteria key to the ADVANCED_FIELDS entry it's read from, so criterionApplies
// below can reuse that field's `nouns` list instead of duplicating it
const CRITERION_PARAM: Record<Exclude<keyof FacetCriteria, "nouns">, string> = {
    composer: "composer",
    secondaryAuthors: "secondaryAuthors",
    part: "part",
    keyRef: "key",
    type: "type",
    year: "year",
    publisher: "publisher",
    suzuki: "suzuki",
    nyssma: "nyssma",
    tags: "tags",
    country: "country",
    role: "role",
    birthYear: "birthYear",
    deathYear: "deathYear"
}

const CRITERION_NOUNS = new Map<string, readonly EntityNoun[]>(
    ADVANCED_FIELDS.map((field) => [field.param, field.nouns])
)

/**
 * Whether `criterionKey` is meaningful for `noun` at all, per ADVANCED_FIELDS (e.g. "composer" is
 * composition-only, "country" is composer-only)
 */
function criterionApplies(criterionKey: Exclude<keyof FacetCriteria, "nouns">, noun: EntityNoun): boolean {
    const nouns = CRITERION_NOUNS.get(CRITERION_PARAM[criterionKey])
    return !nouns || nouns.includes(noun)
}

/** The single predicate every search surface uses to test one facet entry against submitted criteria. */
export function matchesFacets(entry: FacetEntry, criteria: FacetCriteria): boolean {
    if (criteria.nouns && criteria.nouns.length > 0 && !criteria.nouns.includes(entry.noun)) return false
    if (
        criteria.composer &&
        (!criterionApplies("composer", entry.noun) || !matchesText(entry.composer, criteria.composer))
    )
        return false
    if (
        criteria.secondaryAuthors &&
        (!criterionApplies("secondaryAuthors", entry.noun) ||
            !matchesText(entry.secondaryAuthors, criteria.secondaryAuthors))
    )
        return false
    if (criteria.part && (!criterionApplies("part", entry.noun) || !matchesText(entry.part, criteria.part)))
        return false
    if (
        criteria.keyRef &&
        (!criterionApplies("keyRef", entry.noun) || !matchesNullableSelect(entry.keyRef, criteria.keyRef))
    )
        return false
    if (criteria.type && (!criterionApplies("type", entry.noun) || !matchesNullableSelect(entry.type, criteria.type)))
        return false
    if (criteria.year && (!criterionApplies("year", entry.noun) || !matchesNumber(entry.year, criteria.year)))
        return false
    if (
        criteria.publisher &&
        (!criterionApplies("publisher", entry.noun) || !matchesText(entry.publisher, criteria.publisher))
    )
        return false
    if (criteria.suzuki && (!criterionApplies("suzuki", entry.noun) || !matchesNumber(entry.suzuki, criteria.suzuki)))
        return false
    if (criteria.nyssma && (!criterionApplies("nyssma", entry.noun) || !matchesNumber(entry.nyssma, criteria.nyssma)))
        return false
    if (criteria.tags && (!criterionApplies("tags", entry.noun) || !matchesText(entry.tags, criteria.tags)))
        return false
    if (criteria.country && (!criterionApplies("country", entry.noun) || !matchesCountry(entry, criteria.country)))
        return false
    if (criteria.role && (!criterionApplies("role", entry.noun) || !matchesNullableSelect(entry.role, criteria.role)))
        return false
    if (
        criteria.birthYear &&
        (!criterionApplies("birthYear", entry.noun) || !matchesNumber(entry.birthYear, criteria.birthYear))
    )
        return false
    if (
        criteria.deathYear &&
        (!criterionApplies("deathYear", entry.noun) || !matchesNumber(entry.deathYear, criteria.deathYear))
    )
        return false
    return true
}

/** Whether any criterion is set - gates database-mode snapping and JSON-only (keyword-less) filtering. */
export function hasCriteria(criteria: FacetCriteria): boolean {
    return Object.keys(criteria).length > 0
}

/** Checks every "regex"-op text criterion's pattern up front, before a search runs matchesFacets over the
 *  whole dataset */
export function validateFacetCriteria(criteria: FacetCriteria): string | undefined {
    const fields: Array<[value: string | undefined, label: string]> = [
        [criteria.composer?.op === "regex" ? criteria.composer.value : undefined, "composer"],
        [criteria.secondaryAuthors?.op === "regex" ? criteria.secondaryAuthors.value : undefined, "secondary authors"],
        [criteria.part?.op === "regex" ? criteria.part.value : undefined, "part"],
        [criteria.publisher?.op === "regex" ? criteria.publisher.value : undefined, "publisher"],
        [criteria.tags?.op === "regex" ? criteria.tags.value : undefined, "tags"],
        [criteria.country?.op === "regex" ? criteria.country.value : undefined, "composer country"]
    ]
    for (const [pattern, label] of fields) {
        if (pattern === undefined) continue
        if (!isValidRegex(pattern)) {
            return pattern.length > MAX_REGEX_PATTERN_LENGTH
                ? `That ${label} pattern is too long (maximum ${MAX_REGEX_PATTERN_LENGTH} characters).`
                : `That ${label} pattern is not a valid regular expression.`
        }
        if (!isRegexFastEnough(pattern)) {
            return `That ${label} pattern is too slow to run. Simplify it - nested repetition such as (a+)+ is the usual cause.`
        }
    }
    return undefined
}

function readString(params: URLSearchParams, key: string): string | undefined {
    const value = params.get(key)
    if (value === null) return undefined
    const trimmed = value.trim()
    return trimmed === "" ? undefined : trimmed
}

function readNumber(params: URLSearchParams, key: string): number | undefined {
    const value = readString(params, key)
    if (value === undefined) return undefined
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
}

function readTextCriterion(
    params: URLSearchParams,
    param: string,
    operators: readonly FacetOperatorOption[]
): TextCriterion | undefined {
    const value = readString(params, param)
    if (value === undefined) return undefined
    const opRaw = params.get(`${param}_op`)
    const op = (operators.find((candidate) => candidate.value === opRaw)?.value ?? operators[0].value) as TextOperator
    return { op, value }
}

function readNumberCriterion(
    params: URLSearchParams,
    param: string,
    operators: readonly FacetOperatorOption[]
): NumberCriterion | undefined {
    const opRaw = params.get(`${param}_op`)
    const op = (operators.find((candidate) => candidate.value === opRaw)?.value ?? operators[0].value) as NumberOperator
    // "Alive" needs no value at all (see matchesNumber)
    if (op === "alive") return { op, value: 0 }
    const value = readNumber(params, param)
    if (value === undefined) return undefined
    const criterion: NumberCriterion = { op, value }
    if (op === "between") {
        const valueTo = readNumber(params, `${param}To`)
        if (valueTo !== undefined) criterion.valueTo = valueTo
    }
    return criterion
}

/** URL params (as submitted by /search/advanced's form, or round-tripped by {@link criteriaToParams}) ->
 *  criteria; each text/number field reads its bare param plus an optional `{param}_op` (falls back to
 *  that field's default operator) and, for a "between" number criterion, `{param}To` */
export function parseFacetParams(params: URLSearchParams): FacetCriteria {
    const criteria: FacetCriteria = {}
    const nouns = params
        .getAll("noun")
        .map(parseNounSlug)
        .filter((noun): noun is EntityNoun => noun !== undefined)
    if (nouns.length > 0) criteria.nouns = nouns
    const composer = readTextCriterion(params, "composer", TEXT_OPERATORS)
    if (composer) criteria.composer = composer
    const secondaryAuthors = readTextCriterion(params, "secondaryAuthors", TEXT_OPERATORS)
    if (secondaryAuthors) criteria.secondaryAuthors = secondaryAuthors
    const part = readTextCriterion(params, "part", TEXT_OPERATORS)
    if (part) criteria.part = part
    const key = readString(params, "key")
    if (key) criteria.keyRef = key
    const type = readString(params, "type")
    if (type) criteria.type = type
    const year = readNumberCriterion(params, "year", YEAR_OPERATORS)
    if (year) criteria.year = year
    const publisher = readTextCriterion(params, "publisher", TEXT_OPERATORS)
    if (publisher) criteria.publisher = publisher
    const suzuki = readNumberCriterion(params, "suzuki", RATING_OPERATORS)
    if (suzuki) criteria.suzuki = suzuki
    const nyssma = readNumberCriterion(params, "nyssma", RATING_OPERATORS)
    if (nyssma) criteria.nyssma = nyssma
    const tags = readTextCriterion(params, "tags", TEXT_OPERATORS)
    if (tags) criteria.tags = tags
    const country = readTextCriterion(params, "country", TEXT_OPERATORS)
    if (country) criteria.country = country
    const role = readString(params, "role")
    if (role) criteria.role = role
    const birthYear = readNumberCriterion(params, "birthYear", YEAR_OPERATORS)
    if (birthYear) criteria.birthYear = birthYear
    const deathYear = readNumberCriterion(params, "deathYear", DEATH_YEAR_OPERATORS)
    if (deathYear) criteria.deathYear = deathYear
    return criteria
}

/** Criteria -> URL params, the inverse of {@link parseFacetParams} - makes results shareable/back-forward-able. */
export function criteriaToParams(criteria: FacetCriteria): URLSearchParams {
    const params = new URLSearchParams()
    for (const noun of criteria.nouns ?? []) params.append("noun", ENTITY_NOUN_SLUGS[noun])
    if (criteria.composer) {
        params.set("composer", criteria.composer.value)
        params.set("composer_op", criteria.composer.op)
    }
    if (criteria.secondaryAuthors) {
        params.set("secondaryAuthors", criteria.secondaryAuthors.value)
        params.set("secondaryAuthors_op", criteria.secondaryAuthors.op)
    }
    if (criteria.part) {
        params.set("part", criteria.part.value)
        params.set("part_op", criteria.part.op)
    }
    if (criteria.keyRef) params.set("key", criteria.keyRef)
    if (criteria.type) params.set("type", criteria.type)
    const setNumber = (param: string, criterion: NumberCriterion | undefined): void => {
        if (!criterion) return
        params.set(`${param}_op`, criterion.op)
        // "Alive" carries no value (see matchesNumber/readNumberCriterion) - writing a placeholder number
        // would just be noise in the URL.
        if (criterion.op === "alive") return
        params.set(param, String(criterion.value))
        if (criterion.op === "between" && criterion.valueTo !== undefined)
            params.set(`${param}To`, String(criterion.valueTo))
    }
    setNumber("year", criteria.year)
    if (criteria.publisher) {
        params.set("publisher", criteria.publisher.value)
        params.set("publisher_op", criteria.publisher.op)
    }
    setNumber("suzuki", criteria.suzuki)
    setNumber("nyssma", criteria.nyssma)
    if (criteria.tags) {
        params.set("tags", criteria.tags.value)
        params.set("tags_op", criteria.tags.op)
    }
    if (criteria.country) {
        params.set("country", criteria.country.value)
        params.set("country_op", criteria.country.op)
    }
    if (criteria.role) params.set("role", criteria.role)
    setNumber("birthYear", criteria.birthYear)
    setNumber("deathYear", criteria.deathYear)
    return params
}

function parseYearToken(value: string): NumberCriterion | undefined {
    const range = value.match(/^(\d+)-(\d+)$/)
    if (range) return { op: "between", value: Number(range[1]), valueTo: Number(range[2]) }
    const comparison = value.match(/^(>=|<=|>|<)(\d+)$/)
    if (comparison) {
        const [, op, num] = comparison
        const opMap: Record<string, NumberOperator> = { ">=": "atLeast", ">": "after", "<=": "atMost", "<": "before" }
        return { op: opMap[op], value: Number(num) }
    }
    if (/^\d+$/.test(value)) return { op: "is", value: Number(value) }
    return undefined
}

// Ratings only expose a "minimum"/"maximum"/"is" choice; a bare number or ">=" token both floor at that
// value, ">" floors one above it (kept as a strict "after" rather than pre-adding 1, since matchesNumber's
// "after" is already a strict comparison)
function parseMinToken(value: string): NumberCriterion | undefined {
    const match = value.match(/^(>=|>)?(\d+)$/)
    if (!match) return undefined
    const [, op, num] = match
    const n = Number(num)
    return op === ">" ? { op: "after", value: n } : { op: "atLeast", value: n }
}

const QUERY_TOKEN =
    /^(noun|composer|secondaryAuthors|part|key|type|year|publisher|suzuki|nyssma|tags|country|role):(.+)$/i

/**
 * The `/search` free-text query syntax parser: strips recognized `field:value` tokens out of `raw`,
 * returning the leftover free text (for Pagefind) alongside the structured criteria those tokens
 * produced
 */
export function parseFacetQuery(raw: string): { text: string; criteria: FacetCriteria; hasCriteria: boolean } {
    const criteria: FacetCriteria = {}
    const leftover: string[] = []
    for (const word of raw.trim().split(/\s+/).filter(Boolean)) {
        const match = word.match(QUERY_TOKEN)
        if (!match) {
            leftover.push(word)
            continue
        }
        const [, field, value] = match
        switch (field.toLowerCase()) {
            case "noun": {
                const resolved = parseNounSlug(value)
                if (resolved) criteria.nouns = [...(criteria.nouns ?? []), resolved]
                else leftover.push(word)
                break
            }
            case "composer":
                criteria.composer = { op: "contains", value }
                break
            case "secondaryauthors":
                criteria.secondaryAuthors = { op: "contains", value }
                break
            case "part":
                criteria.part = { op: "contains", value }
                break
            case "key": {
                const ref = parseKeyToken(value)
                if (ref) criteria.keyRef = ref
                else leftover.push(word)
                break
            }
            case "type":
                criteria.type = value
                break
            case "year": {
                const criterion = parseYearToken(value)
                if (criterion) criteria.year = criterion
                else leftover.push(word)
                break
            }
            case "publisher":
                criteria.publisher = { op: "contains", value }
                break
            case "suzuki": {
                const criterion = parseMinToken(value)
                if (criterion) criteria.suzuki = criterion
                else leftover.push(word)
                break
            }
            case "nyssma": {
                const criterion = parseMinToken(value)
                if (criterion) criteria.nyssma = criterion
                else leftover.push(word)
                break
            }
            case "tags":
                criteria.tags = { op: "contains", value }
                break
            case "country":
                criteria.country = { op: "contains", value }
                break
            case "role":
                criteria.role = value.toLowerCase()
                break
            default:
                leftover.push(word)
        }
    }
    return { text: leftover.join(" "), criteria, hasCriteria: hasCriteria(criteria) }
}
