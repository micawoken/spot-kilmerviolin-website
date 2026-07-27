/**
 * lib/search/facets.ts
 *
 * Shared core for advanced database search (docs/dev/plan-prelaunch-features.md §10). Pure and
 * dependency-light — imported by the build-time facet endpoint (database-facets.json.ts), the
 * `/search` and `/search/advanced` client scripts, the Puck `PagefindSearch` component (catalog.tsx),
 * and `DatabaseRoot.astro`'s search bar. `ADVANCED_FIELDS` is the single field-definition list every one
 * of those renderers maps over, so they cannot drift in fields, labels, param names, or markup.
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

import { Key, WorkType, normalizeKeyForSearch } from "../api/common"
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

/** Structured search criteria. Every field is a discrete match except the three explicit ranges. */
export interface FacetCriteria {
    noun?: EntityNoun
    composer?: string
    keyRef?: string
    type?: string
    yearFrom?: number
    yearTo?: number
    suzukiMin?: number
    nyssmaMin?: number
    country?: string
    role?: string
    birthYear?: number
    deathYear?: number
}

export type FacetControlKind = "select" | "text" | "number"

export interface AdvancedFieldOption {
    label: string
    value: string
}

/** One criterion's shared shape: URL/form param name, label, control kind, and (for a select) its options. */
export interface AdvancedFieldDef {
    /** also the FacetCriteria/URLSearchParams key this control reads and writes */
    param: string
    label: string
    control: FacetControlKind
    options?: AdvancedFieldOption[]
    placeholder?: string
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

function nounOptions(): AdvancedFieldOption[] {
    return ALL_NOUNS.map((noun) => ({ label: ENTITY_NOUN_LABELS[noun], value: ENTITY_NOUN_SLUGS[noun] }))
}

const ANY_OPTION: AdvancedFieldOption = { label: "Any", value: "" }

/**
 * The shared field-definition list every advanced-search renderer (the Puck component, the /database
 * bar, /search/advanced) maps over. Field controls are static enums / free-entry text / number inputs —
 * no live option lists (see plan-prelaunch-features.md §10's "deliberately out of scope").
 */
export const ADVANCED_FIELDS: readonly AdvancedFieldDef[] = [
    { param: "noun", label: "Type", control: "select", options: [ANY_OPTION, ...nounOptions()], nouns: ALL_NOUNS },
    { param: "composer", label: "Composer", control: "text", placeholder: "e.g. Bach", nouns: ["composition"] },
    { param: "key", label: "Key", control: "select", options: [ANY_OPTION, ...KEY_OPTIONS], nouns: ["composition"] },
    { param: "type", label: "Work type", control: "select", options: [ANY_OPTION, ...workTypeOptions()], nouns: ["composition"] },
    { param: "yearFrom", label: "Published from", control: "number", nouns: ["composition"] },
    { param: "yearTo", label: "Published to", control: "number", nouns: ["composition"] },
    { param: "suzukiMin", label: "Suzuki rating (min)", control: "number", nouns: ["composition"] },
    { param: "nyssmaMin", label: "NYSSMA rating (min)", control: "number", nouns: ["composition"] },
    { param: "country", label: "Composer country", control: "text", placeholder: "e.g. France", nouns: ["composer"] },
    { param: "role", label: "Composer role", control: "text", placeholder: "e.g. arranger", nouns: ["composer"] },
    { param: "birthYear", label: "Birth year", control: "number", nouns: ["composer"] },
    { param: "deathYear", label: "Death year", control: "number", nouns: ["composer"] }
]

const NOUN_BY_SLUG = new Map<string, EntityNoun>(
    Object.entries(ENTITY_NOUN_SLUGS).map(([noun, slug]) => [slug, noun as EntityNoun])
)

function parseNounSlug(value: string): EntityNoun | undefined {
    return NOUN_BY_SLUG.get(value.trim().toLowerCase())
}

/** The single predicate every search surface uses to test one facet entry against submitted criteria. */
export function matchesFacets(entry: FacetEntry, criteria: FacetCriteria): boolean {
    if (criteria.noun && entry.noun !== criteria.noun) return false
    if (criteria.composer) {
        if (!(entry.composer ?? "").toLowerCase().includes(criteria.composer.toLowerCase())) return false
    }
    if (criteria.keyRef && entry.keyRef !== criteria.keyRef) return false
    if (criteria.type) {
        if (!(entry.type ?? "").toLowerCase().includes(criteria.type.toLowerCase())) return false
    }
    if (criteria.yearFrom !== undefined && (entry.year === undefined || entry.year < criteria.yearFrom)) return false
    if (criteria.yearTo !== undefined && (entry.year === undefined || entry.year > criteria.yearTo)) return false
    if (criteria.suzukiMin !== undefined && (entry.suzuki === undefined || entry.suzuki < criteria.suzukiMin)) return false
    if (criteria.nyssmaMin !== undefined && (entry.nyssma === undefined || entry.nyssma < criteria.nyssmaMin)) return false
    if (criteria.country) {
        const query = criteria.country.toLowerCase()
        const code = (entry.country ?? "").toLowerCase()
        const name = entry.country ? countryCodeName(entry.country).toLowerCase() : ""
        if (!code.includes(query) && !name.includes(query)) return false
    }
    if (criteria.role) {
        if (!(entry.role ?? "").toLowerCase().includes(criteria.role.toLowerCase())) return false
    }
    if (criteria.birthYear !== undefined && entry.birthYear !== criteria.birthYear) return false
    if (criteria.deathYear !== undefined && entry.deathYear !== criteria.deathYear) return false
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

/** URL params (as submitted by any of the shared forms, or round-tripped by {@link criteriaToParams}) -> criteria. */
export function parseFacetParams(params: URLSearchParams): FacetCriteria {
    const criteria: FacetCriteria = {}
    const noun = readString(params, "noun")
    if (noun) {
        const resolved = parseNounSlug(noun)
        if (resolved) criteria.noun = resolved
    }
    const composer = readString(params, "composer")
    if (composer) criteria.composer = composer
    const key = readString(params, "key")
    if (key) criteria.keyRef = key
    const type = readString(params, "type")
    if (type) criteria.type = type
    const yearFrom = readNumber(params, "yearFrom")
    if (yearFrom !== undefined) criteria.yearFrom = yearFrom
    const yearTo = readNumber(params, "yearTo")
    if (yearTo !== undefined) criteria.yearTo = yearTo
    const suzukiMin = readNumber(params, "suzukiMin")
    if (suzukiMin !== undefined) criteria.suzukiMin = suzukiMin
    const nyssmaMin = readNumber(params, "nyssmaMin")
    if (nyssmaMin !== undefined) criteria.nyssmaMin = nyssmaMin
    const country = readString(params, "country")
    if (country) criteria.country = country
    const role = readString(params, "role")
    if (role) criteria.role = role
    const birthYear = readNumber(params, "birthYear")
    if (birthYear !== undefined) criteria.birthYear = birthYear
    const deathYear = readNumber(params, "deathYear")
    if (deathYear !== undefined) criteria.deathYear = deathYear
    return criteria
}

/** Criteria -> URL params, the inverse of {@link parseFacetParams} — makes results shareable/back-forward-able. */
export function criteriaToParams(criteria: FacetCriteria): URLSearchParams {
    const params = new URLSearchParams()
    if (criteria.noun) params.set("noun", ENTITY_NOUN_SLUGS[criteria.noun])
    if (criteria.composer) params.set("composer", criteria.composer)
    if (criteria.keyRef) params.set("key", criteria.keyRef)
    if (criteria.type) params.set("type", criteria.type)
    if (criteria.yearFrom !== undefined) params.set("yearFrom", String(criteria.yearFrom))
    if (criteria.yearTo !== undefined) params.set("yearTo", String(criteria.yearTo))
    if (criteria.suzukiMin !== undefined) params.set("suzukiMin", String(criteria.suzukiMin))
    if (criteria.nyssmaMin !== undefined) params.set("nyssmaMin", String(criteria.nyssmaMin))
    if (criteria.country) params.set("country", criteria.country)
    if (criteria.role) params.set("role", criteria.role)
    if (criteria.birthYear !== undefined) params.set("birthYear", String(criteria.birthYear))
    if (criteria.deathYear !== undefined) params.set("deathYear", String(criteria.deathYear))
    return params
}

function parseYearToken(value: string): Pick<FacetCriteria, "yearFrom" | "yearTo"> | undefined {
    const range = value.match(/^(\d+)-(\d+)$/)
    if (range) return { yearFrom: Number(range[1]), yearTo: Number(range[2]) }
    const comparison = value.match(/^(>=|<=|>|<)(\d+)$/)
    if (comparison) {
        const [, op, num] = comparison
        const n = Number(num)
        if (op === ">=") return { yearFrom: n }
        if (op === ">") return { yearFrom: n + 1 }
        if (op === "<=") return { yearTo: n }
        return { yearTo: n - 1 }
    }
    if (/^\d+$/.test(value)) {
        const n = Number(value)
        return { yearFrom: n, yearTo: n }
    }
    return undefined
}

// Ratings only expose a "minimum" filter (FacetCriteria has no exact/max field for them), so an exact or
// ">" token both resolve to a floor: ">4" excludes 4 itself, so its floor is 5; "4" and ">=4" both floor at 4.
function parseMinToken(value: string): number | undefined {
    const match = value.match(/^(>=|>)?(\d+)$/)
    if (!match) return undefined
    const [, op, num] = match
    const n = Number(num)
    return op === ">" ? n + 1 : n
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
                if (resolved) criteria.noun = resolved
                else leftover.push(word)
                break
            }
            case "composer":
                criteria.composer = value
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
                const range = parseYearToken(value)
                if (range) Object.assign(criteria, range)
                else leftover.push(word)
                break
            }
            case "suzuki": {
                const min = parseMinToken(value)
                if (min !== undefined) criteria.suzukiMin = min
                else leftover.push(word)
                break
            }
            case "nyssma": {
                const min = parseMinToken(value)
                if (min !== undefined) criteria.nyssmaMin = min
                else leftover.push(word)
                break
            }
            case "country":
                criteria.country = value
                break
            case "role":
                criteria.role = value
                break
            default:
                leftover.push(word)
        }
    }
    return { text: leftover.join(" "), criteria, hasCriteria: hasCriteria(criteria) }
}
