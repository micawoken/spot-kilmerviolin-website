/**
 * lib/api/search.ts
 *
 * Keyword search over the three entity tables using MiniSearch
 *
 * Search prioritizes specific columns (such as name, composer name, tags, bio, and notes)
 *
 */

import MiniSearch from "minisearch"
import { countryCodeName } from "../../scripts/format"

/** the tables the search endpoint accepts */
export const VALID_DATABASES: SearchDatabase[] = ["composers", "compositions", "contributors"]

/** maximum number of hits returned per table, to bound the response size */
const RESULT_CAP = 50

/** options shared by every per-table search: prefix and light fuzzy matching */
const SEARCH_OPTIONS = { prefix: true, fuzzy: 0.2 }

/** a flattened, fully-stringified document fed to MiniSearch */
interface SearchDoc {
    id: number
    /** the string shown to the user for this hit (stored, not indexed for matching) */
    display: string
    [field: string]: string | number
}

/** coerces any scalar to an indexable string */
function str(value: unknown): string {
    return value === null || value === undefined ? "" : String(value)
}

/** joins an array field (tags, roles) to a single indexable string */
function arr(value: unknown): string {
    return Array.isArray(value) ? value.join(" ") : str(value)
}

/**
 * Builds a MiniSearch index over the supplied docs and runs the query, returning capped, ranked hits.
 *
 * @param {SearchDatabase} database the table these docs belong to (stamped onto each result)
 * @param {SearchDoc[]} docs the flattened documents to index
 * @param {string[]} fields the doc fields to index for matching
 * @param {Record<string, number>} boost per-field boost factors (higher ranks matches in that field higher)
 * @param {string} query the user's keyword query
 * @returns {SearchResult[]} ranked hits as { database, id, name }
 */
function runSearch(
    database: SearchDatabase,
    docs: SearchDoc[],
    fields: string[],
    boost: Record<string, number>,
    query: string
): SearchResult[] {
    if (docs.length === 0) {
        return []
    }

    if (query.length < 3) {
        // very short queries are not allowed
        throw new Error("Query must be at least 3 characters long")
    }

    const index = new MiniSearch<SearchDoc>({ fields, storeFields: ["display"], idField: "id" })
    index.addAll(docs)
    return index
        .search(query, { ...SEARCH_OPTIONS, boost })
        .slice(0, RESULT_CAP)
        .map((hit) => ({ database, id: hit.id as number, name: (hit as unknown as SearchDoc).display }))
}

const COMPOSER_FIELDS = ["name", "bio", "country", "role", "tags"]
const COMPOSER_BOOST: Record<string, number> = { name: 5, bio: 3, tags: 3, country: 1, role: 1 }

/**
 * Searches the composers table by keyword
 */
export function searchComposers(records: ComposerRecord[], query: string): SearchResult[] {
    const docs: SearchDoc[] = records.map((record) => ({
        id: record.id,
        display: record.name,
        name: str(record.name),
        bio: str(record.bio),
        // index both the resolved English country name and the raw alpha-2 code so a search for either
        // "France" or "FR" matches a record stored as the ISO code
        country: record.country ? `${countryCodeName(record.country)} ${record.country}` : "",
        role: str(record.role),
        tags: arr(record.tags)
    }))
    return runSearch("composers", docs, COMPOSER_FIELDS, COMPOSER_BOOST, query)
}

const CONTRIBUTOR_FIELDS = ["name", "bio", "major", "roles", "tags"]
const CONTRIBUTOR_BOOST: Record<string, number> = { name: 5, bio: 3, tags: 3, major: 1, roles: 1 }

/**
 * Searches the contributors table by keyword (excludes protected columns)
 */
export function searchContributors(records: ContributorRecord[], query: string): SearchResult[] {
    const docs: SearchDoc[] = records.map((record) => ({
        id: record.id,
        display: record.name,
        name: str(record.name),
        bio: str(record.bio),
        major: str(record.major),
        roles: arr(record.roles),
        tags: arr(record.tags)
    }))
    return runSearch("contributors", docs, CONTRIBUTOR_FIELDS, CONTRIBUTOR_BOOST, query)
}

const COMPOSITION_FIELDS = [
    "name",
    "composer",
    "type",
    "publish_location",
    "publish_name",
    "notes_pedagogical",
    "notes_historical",
    "notes_other",
    "tags"
]
const COMPOSITION_BOOST: Record<string, number> = {
    name: 5,
    composer: 5,
    notes_pedagogical: 3,
    notes_historical: 3,
    notes_other: 3,
    tags: 3,
    type: 1,
    publish_location: 1,
    publish_name: 1
}

/**
 * Searches the compositions table by keyword
 *
 * @param {CompositionRecord[]} records the composition records to search
 * @param {Map<number, string>} composer_names map of composer id -> composer name
 * @param {string} query the user's keyword query
 */
export function searchCompositions(
    records: CompositionRecord[],
    composer_names: Map<number, string>,
    query: string
): SearchResult[] {
    const docs: SearchDoc[] = records.map((record) => {
        const composer = composer_names.get(record.composer_id) ?? ""
        return {
            id: record.id,
            display: composer ? `${composer}: ${record.name}` : record.name,
            name: str(record.name),
            composer: str(composer),
            type: str(record.type),
            publish_location: str(record.publication_info?.location),
            publish_name: str(record.publication_info?.name),
            notes_pedagogical: str(record.notes_pedagogical),
            notes_historical: str(record.notes_historical),
            notes_other: str(record.notes_other),
            tags: arr(record.tags)
        }
    })
    return runSearch("compositions", docs, COMPOSITION_FIELDS, COMPOSITION_BOOST, query)
}
