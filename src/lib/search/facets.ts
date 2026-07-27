/**
 * lib/search/facets.ts
 *
 * Shared core for advanced database search (docs/dev/plan-prelaunch-features.md §10). Pure and
 * dependency-light — imported by the build-time facet endpoint (database-facets.json.ts) and the
 * `/search` and `/search/advanced` client scripts. `ADVANCED_FIELDS` is the criteria form's single
 * field-definition list, rendered only by pages/search/advanced.astro — the Puck `PagefindSearch`
 * component and `DatabaseRoot.astro` used to duplicate that form inline, but now just link to that page
 * (catalog.tsx's `advancedLink` option) rather than rendering their own copy of it.
 *
 * Every filterable field follows a `[field][operator][value]` shape: text fields (composer, country,
 * role) choose contains/is; number fields (year, ratings, birth/death year) choose is/before/after/
 * between/around or is/at-least/at-most. `key` and `type` stay plain exact-match selects — there is only
 * one sensible operator for an enum, so no operator control is rendered for them (an operator dropdown
 * with a single, unchangeable option would be UI noise, not the multi-choice behavior the rest of this
 * file is about). Entity type (composer/composition/contributor) is its own multi-select checkbox group
 * on the advanced-search template, not an ADVANCED_FIELDS entry — see `nounOptions`.
 *
 * Pagefind's own filters are discrete-value only — no ranges, no comparisons — so structured filtering
 * (year ranges, rating minimums) runs off `FacetEntry`/`matchesFacets` instead, against a build-time JSON
 * index (database-facets.json.ts) rather than the rendered page HTML: entity pages render through
 * editor-authored Puck templates, so a field's presence in the DOM depends on whether a designer placed
 * it — facets are built from the D1 records themselves.
 *
 * Verified safe for the browser/editor bundle: this module's only non-relative import is
 * `../api/common`, whose only import is `./validation`, whose only import is `../../consts` — no
 * `cloudflare:workers` or other server-only dependency on that path.
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
 * One row of the build-time facet index (database-facets.json.ts). Absent fields are omitted from the
 * JSON entirely, not emitted as `null` — keeps the payload small and lets {@link matchesFacets} treat
 * "absent" and "not applicable to this noun" the same way.
 */
export interface FacetEntry {
    url: string
    noun: EntityNoun
    name: string
    /** composition only — composer's display name, for substring matching and result subtitles */
    composer?: string
    composerId?: number
    /** composition only — {@link normalizeKeyForSearch} pitch-class reference, e.g. "7-minor" */
    keyRef?: string
    /** composition only — raw WorkType value */
    type?: string
    /** composition only — publish_year */
    year?: number
    suzuki?: number
    nyssma?: number
    /** composer only — ISO 3166-1 alpha-2 code (matched against both the code and its resolved name) */
    country?: string
    /** composer only — raw role text */
    role?: string
    birthYear?: number
    deathYear?: number
    /** contributor only — not a filterable field today (no ADVANCED_FIELDS entry), carried for completeness */
    classYear?: number
}

export type TextOperator = "contains" | "is"
export interface TextCriterion {
    op: TextOperator
    value: string
}

export type NumberOperator = "is" | "before" | "after" | "atLeast" | "atMost" | "between" | "around" | "alive"
export interface NumberCriterion {
    op: NumberOperator
    /** unused (and not read) when op is "alive" — that operator alone needs no value */
    value: number
    /** only meaningful (and only read) when op is "between" */
    valueTo?: number
}

/** "Around" tolerance for publish/birth/death year, in years either side of the given value. An explicit
 *  round-number assumption (not derived from any product spec) — revisit if it ever needs to be field- or
 *  user-configurable. */
const AROUND_YEAR_TOLERANCE = 5

/** Structured search criteria. `nouns` (empty/absent = any) plus one optional criterion per filterable
 *  field; `keyRef`/`type`/`role` are plain exact-match values (all three are closed-vocabulary selects, not
 *  free text), everything else is a `[field][operator][value]` criterion object. */
export interface FacetCriteria {
    nouns?: EntityNoun[]
    composer?: TextCriterion
    keyRef?: string
    type?: string
    year?: NumberCriterion
    suzuki?: NumberCriterion
    nyssma?: NumberCriterion
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
 *  options, or (for text/number) its available operators — the first entry is the default. */
export interface AdvancedFieldDef {
    /** also the FacetCriteria/URLSearchParams key this control reads and writes */
    param: string
    label: string
    control: FacetControlKind
    options?: AdvancedFieldOption[]
    placeholder?: string
    /** present only for text/number fields; absent (select fields) means "exact match, no operator UI" */
    operators?: readonly FacetOperatorOption[]
    /** number fields only — rendered as the value/"to" inputs' min/max attributes */
    min?: number
    max?: number
    /** which entity nouns this criterion is meaningful for — grouping metadata for renderers; matching
     *  itself needs no noun gate, since a field absent on a noun's entries just never matches it */
    nouns: EntityNoun[]
}

const ALL_NOUNS: EntityNoun[] = ["composer", "composition", "contributor"]

/** Groups the 42-member `Key` enum into its 24 enharmonic-collapsed (pitch-class × mode) options,
 *  labelling paired spellings together (e.g. "C♯/D♭ major") rather than arbitrarily picking one. */
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

/** Display label for a pitch-class reference (e.g. "7-minor" -> "G♯/A♭ minor"), or the ref itself if unknown. */
export function keyRefLabel(ref: string): string {
    return KEY_LABEL_BY_REF.get(ref) ?? ref
}

// Reverse index from a query-syntax key token ("g-minor", "c#-major", "ab-major" — note+accidental exactly
// as the Key enum spells it, lowercased, hyphen before the mode) to its pitch-class reference.
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

/** The three entity-type options for the advanced-search noun checkbox group (docs: "do filtering only" —
 *  unlike plain /search, /search/advanced stays database-scoped, but lets multiple nouns be checked at
 *  once rather than picking exactly one). No "Any" pseudo-option: an empty selection already means any. */
export function nounOptions(): AdvancedFieldOption[] {
    return ALL_NOUNS.map((noun) => ({ label: ENTITY_NOUN_LABELS[noun], value: ENTITY_NOUN_SLUGS[noun] }))
}

const ANY_OPTION: AdvancedFieldOption = { label: "Any", value: "" }

/** Sentinel option value for "this field is unset on the entry" — distinct from {@link ANY_OPTION}'s empty
 *  string, which means "no filter applied" (matches every entry regardless of the field). Only meaningful
 *  for a select field whose underlying data can genuinely be absent (key/type/role — see
 *  database-facets.json.ts's conditional `if (record.key) …`/`if (record.type) …`/`if (record.role) …`);
 *  never collides with a real value since it's neither a `Key`/`WorkType`/`AuthorRole` enum member nor a
 *  `normalizeKeyForSearch` pitch-class reference. */
export const NONE_VALUE = "none"
const NONE_OPTION: AdvancedFieldOption = { label: "(None)", value: NONE_VALUE }

const TEXT_OPERATORS: readonly FacetOperatorOption[] = [
    { value: "contains", label: "Contains" },
    { value: "is", label: "Is exactly" }
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
// "Alive" so a living composer (the -1 sentinel, omitted from the facets JSON entirely — see
// database-facets.json.ts) can be filtered for without a year value.
const DEATH_YEAR_OPERATORS: readonly FacetOperatorOption[] = [...YEAR_OPERATORS, { value: "alive", label: "Alive" }]

function authorRoleOptions(): AdvancedFieldOption[] {
    return Object.values(AuthorRole).map((value) => ({ label: value[0].toUpperCase() + value.slice(1), value }))
}

const currentYear = new Date().getFullYear()

/**
 * The shared field-definition list /search/advanced maps over to render its filter fieldset. Field
 * controls are static enums / free-entry text / number inputs — no live option lists (see
 * plan-prelaunch-features.md §10's "deliberately out of scope").
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
        param: "key",
        label: "Key",
        control: "select",
        options: [ANY_OPTION, NONE_OPTION, ...KEY_OPTIONS],
        nouns: ["composition"]
    },
    {
        param: "type",
        label: "Work type",
        control: "select",
        options: [ANY_OPTION, NONE_OPTION, ...workTypeOptions()],
        nouns: ["composition"]
    },
    { param: "year", label: "Publication year", control: "number", operators: YEAR_OPERATORS, nouns: ["composition"] },
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
        options: [ANY_OPTION, NONE_OPTION, ...authorRoleOptions()],
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
    const value = (entryValue ?? "").toLowerCase()
    const query = criterion.value.toLowerCase()
    return criterion.op === "is" ? value === query : value.includes(query)
}

// Composer country matches both the raw ISO code and its resolved display name (e.g. "de" and "Germany"
// both hit), so this can't reuse matchesText's single-string comparison.
function matchesCountry(entry: FacetEntry, criterion: TextCriterion): boolean {
    const query = criterion.value.toLowerCase()
    const code = (entry.country ?? "").toLowerCase()
    const name = entry.country ? countryCodeName(entry.country).toLowerCase() : ""
    return criterion.op === "is" ? code === query || name === query : code.includes(query) || name.includes(query)
}

function matchesNumber(entryValue: number | undefined, criterion: NumberCriterion): boolean {
    // "Alive" is the inverse of every other operator here: a living composer has no deathYear at all (the
    // -1 sentinel is omitted from the facets JSON — see database-facets.json.ts), so this is the one case
    // where "value absent" is the match, not an automatic non-match.
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

// key/type/role are all optional on FacetEntry (database-facets.json.ts only sets them when the D1 record
// has a truthy value) — NONE_VALUE (a select option distinct from ANY_OPTION's "no filter" empty string)
// asks for entries where the field is absent, rather than for a literal value equal to it.
function matchesNullableSelect(entryValue: string | undefined, criterionValue: string): boolean {
    if (criterionValue === NONE_VALUE) return entryValue === undefined
    return entryValue === criterionValue
}

/** The single predicate every search surface uses to test one facet entry against submitted criteria. */
export function matchesFacets(entry: FacetEntry, criteria: FacetCriteria): boolean {
    if (criteria.nouns && criteria.nouns.length > 0 && !criteria.nouns.includes(entry.noun)) return false
    if (criteria.composer && !matchesText(entry.composer, criteria.composer)) return false
    if (criteria.keyRef && !matchesNullableSelect(entry.keyRef, criteria.keyRef)) return false
    if (criteria.type && !matchesNullableSelect(entry.type, criteria.type)) return false
    if (criteria.year && !matchesNumber(entry.year, criteria.year)) return false
    if (criteria.suzuki && !matchesNumber(entry.suzuki, criteria.suzuki)) return false
    if (criteria.nyssma && !matchesNumber(entry.nyssma, criteria.nyssma)) return false
    if (criteria.country && !matchesCountry(entry, criteria.country)) return false
    if (criteria.role && !matchesNullableSelect(entry.role, criteria.role)) return false
    if (criteria.birthYear && !matchesNumber(entry.birthYear, criteria.birthYear)) return false
    if (criteria.deathYear && !matchesNumber(entry.deathYear, criteria.deathYear)) return false
    return true
}

/** Whether any criterion is set — gates database-mode snapping and JSON-only (keyword-less) filtering. */
export function hasCriteria(criteria: FacetCriteria): boolean {
    return Object.keys(criteria).length > 0
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

function readTextCriterion(params: URLSearchParams, param: string, operators: readonly FacetOperatorOption[]): TextCriterion | undefined {
    const value = readString(params, param)
    if (value === undefined) return undefined
    const opRaw = params.get(`${param}_op`)
    const op = (operators.find((candidate) => candidate.value === opRaw)?.value ?? operators[0].value) as TextOperator
    return { op, value }
}

function readNumberCriterion(params: URLSearchParams, param: string, operators: readonly FacetOperatorOption[]): NumberCriterion | undefined {
    const opRaw = params.get(`${param}_op`)
    const op = (operators.find((candidate) => candidate.value === opRaw)?.value ?? operators[0].value) as NumberOperator
    // "Alive" needs no value at all (see matchesNumber) — read it before the value check below, which would
    // otherwise bail out with nothing typed into the (hidden, for this operator) value input.
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
 *  criteria. Each text/number field reads its bare param plus an optional `{param}_op` (falls back to
 *  that field's default operator) and, for a "between" number criterion, `{param}To`. */
export function parseFacetParams(params: URLSearchParams): FacetCriteria {
    const criteria: FacetCriteria = {}
    const nouns = params
        .getAll("noun")
        .map(parseNounSlug)
        .filter((noun): noun is EntityNoun => noun !== undefined)
    if (nouns.length > 0) criteria.nouns = nouns
    const composer = readTextCriterion(params, "composer", TEXT_OPERATORS)
    if (composer) criteria.composer = composer
    const key = readString(params, "key")
    if (key) criteria.keyRef = key
    const type = readString(params, "type")
    if (type) criteria.type = type
    const year = readNumberCriterion(params, "year", YEAR_OPERATORS)
    if (year) criteria.year = year
    const suzuki = readNumberCriterion(params, "suzuki", RATING_OPERATORS)
    if (suzuki) criteria.suzuki = suzuki
    const nyssma = readNumberCriterion(params, "nyssma", RATING_OPERATORS)
    if (nyssma) criteria.nyssma = nyssma
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

/** Criteria -> URL params, the inverse of {@link parseFacetParams} — makes results shareable/back-forward-able. */
export function criteriaToParams(criteria: FacetCriteria): URLSearchParams {
    const params = new URLSearchParams()
    for (const noun of criteria.nouns ?? []) params.append("noun", ENTITY_NOUN_SLUGS[noun])
    if (criteria.composer) {
        params.set("composer", criteria.composer.value)
        params.set("composer_op", criteria.composer.op)
    }
    if (criteria.keyRef) params.set("key", criteria.keyRef)
    if (criteria.type) params.set("type", criteria.type)
    const setNumber = (param: string, criterion: NumberCriterion | undefined): void => {
        if (!criterion) return
        params.set(`${param}_op`, criterion.op)
        // "Alive" carries no value (see matchesNumber/readNumberCriterion) — writing a placeholder number
        // would just be noise in the URL.
        if (criterion.op === "alive") return
        params.set(param, String(criterion.value))
        if (criterion.op === "between" && criterion.valueTo !== undefined) params.set(`${param}To`, String(criterion.valueTo))
    }
    setNumber("year", criteria.year)
    setNumber("suzuki", criteria.suzuki)
    setNumber("nyssma", criteria.nyssma)
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
// "after" is already a strict comparison).
function parseMinToken(value: string): NumberCriterion | undefined {
    const match = value.match(/^(>=|>)?(\d+)$/)
    if (!match) return undefined
    const [, op, num] = match
    const n = Number(num)
    return op === ">" ? { op: "after", value: n } : { op: "atLeast", value: n }
}

const QUERY_TOKEN = /^(noun|composer|key|type|year|suzuki|nyssma|country|role):(.+)$/i

/**
 * The `/search` free-text query syntax parser: strips recognized `field:value` tokens out of `raw`,
 * returning the leftover free text (for Pagefind) alongside the structured criteria those tokens
 * produced. An unrecognized or malformed token (e.g. `key:not-a-key`) is left in the free text rather
 * than silently dropped, so it still counts toward the Pagefind keyword search.
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
