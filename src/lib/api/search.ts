/**
 * lib/api/search.ts
 *
 * Keyword search over the three entity tables using MiniSearch
 *
 * Search prioritizes specific columns (such as name, composer name, tags, bio, and notes)
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

import MiniSearch from "minisearch"
import { env } from "cloudflare:workers"
import { compositionNameCollisionKey, disambiguatedCompositionName } from "./db_composition"
import { countryCodeName } from "../../scripts/format"

/** the tables the search endpoint accepts */
export const VALID_DATABASES: SearchDatabase[] = ["composers", "compositions", "contributors"]

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
 * Upper bound on a query string. SEARCH_RESULT_CAP bounds the RESPONSE, not the work: an unbounded query
 * is tokenized and matched against every indexed term, with fuzzy matching on. 256 characters is far
 * beyond any real keyword search.
 */
export const MAX_QUERY_LENGTH = 256

/** The minimum query length; shorter queries match too much to be useful. */
const MIN_QUERY_LENGTH = 3

/**
 * Per-isolate index cache. Building the index is O(rows x indexed fields) and it was rebuilt on EVERY
 * request - for a search covering all three tables, three full index builds per call, on an endpoint any
 * active contributor may hit. The corpus changes only when the underlying table does, so the index is
 * keyed on a cheap version stamp and rebuilt only then.
 *
 * Scoped to the isolate, like the JWKS singleton in authenticate.ts: a stale entry is impossible (the
 * version changes with the data) and an evicted isolate simply rebuilds.
 */
const indexCache = new Map<SearchDatabase, { version: string; index: MiniSearch<SearchDoc> }>()

/**
 * A cheap identity for a table's current contents: row count plus the newest change_date. An edit bumps
 * change_date, an insert or delete changes the count - so any mutation the search should see changes
 * this, without hashing the records themselves (which would cost as much as rebuilding the index).
 *
 * @param {Array<{ change_date?: number | null }>} records the table's records
 * @returns {string} the version stamp
 */
export function recordsVersion(records: Array<{ change_date?: number | null }>): string {
    let newest = 0
    for (const record of records) {
        const changed = record.change_date ?? 0
        if (changed > newest) newest = changed
    }
    return `${records.length}:${newest}`
}

/**
 * A version stamp for a resolved-name lookup map. FNV-1a over the entries - O(total characters), which is
 * negligible beside tokenizing the corpus, and unlike a size check it changes when a name is edited.
 *
 * @param {Map<number, string>} map the lookup map
 * @returns {string} the version stamp
 */
function mapVersion(map: Map<number, string>): string {
    let hash = 0x811c9dc5
    for (const [key, value] of map) {
        const entry = `${key}:${value};`
        for (let i = 0; i < entry.length; i++) {
            hash ^= entry.charCodeAt(i)
            hash = Math.imul(hash, 0x01000193)
        }
    }
    return `${map.size}:${(hash >>> 0).toString(16)}`
}

/**
 * Runs a query against a table's MiniSearch index, building the index only when the data has changed.
 *
 * @param {SearchDatabase} database the table being searched (stamped onto each result)
 * @param {string} version the corpus version stamp (see {@link recordsVersion})
 * @param {() => SearchDoc[]} buildDocs produces the flattened documents; not called on a cache hit
 * @param {string[]} fields the doc fields to index for matching
 * @param {Record<string, number>} boost per-field boost factors (higher ranks matches in that field higher)
 * @param {string} query the user's keyword query
 * @returns {SearchResult[]} ranked hits as { database, id, name }
 * @throws {Error} when the query is outside the permitted length range
 */
function runSearch(
    database: SearchDatabase,
    version: string,
    buildDocs: () => SearchDoc[],
    fields: string[],
    boost: Record<string, number>,
    query: string
): SearchResult[] {
    if (query.length < MIN_QUERY_LENGTH) {
        // very short queries are not allowed
        throw new Error(`Query must be at least ${MIN_QUERY_LENGTH} characters long`)
    }
    if (query.length > MAX_QUERY_LENGTH) {
        throw new Error(`Query must be at most ${MAX_QUERY_LENGTH} characters long`)
    }

    const cached = indexCache.get(database)
    let index: MiniSearch<SearchDoc>
    if (cached && cached.version === version) {
        index = cached.index
    } else {
        const docs = buildDocs()
        if (docs.length === 0) {
            return []
        }
        index = new MiniSearch<SearchDoc>({ fields, storeFields: ["display"], idField: "id" })
        index.addAll(docs)
        indexCache.set(database, { version, index })
    }
    // maximum hits returned per table, to bound the response size (SEARCH_RESULT_CAP wrangler var)
    return index
        .search(query, { ...SEARCH_OPTIONS, boost })
        .slice(0, Number(env.SEARCH_RESULT_CAP))
        .map((hit) => ({ database, id: hit.id as number, name: (hit as unknown as SearchDoc).display }))
}

const COMPOSER_FIELDS = ["name", "bio", "country", "role", "tags"]
const COMPOSER_BOOST: Record<string, number> = { name: 5, bio: 3, tags: 3, country: 1, role: 1 }

/**
 * Searches the composers table by keyword
 */
export function searchComposers(records: ComposerRecord[], query: string): SearchResult[] {
    const buildDocs = (): SearchDoc[] =>
        records.map((record) => ({
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
    return runSearch("composers", recordsVersion(records), buildDocs, COMPOSER_FIELDS, COMPOSER_BOOST, query)
}

const CONTRIBUTOR_FIELDS = ["name", "bio", "major", "roles", "tags"]
const CONTRIBUTOR_BOOST: Record<string, number> = { name: 5, bio: 3, tags: 3, major: 1, roles: 1 }

/**
 * Searches the contributors table by keyword (excludes protected columns)
 */
export function searchContributors(records: ContributorRecord[], query: string): SearchResult[] {
    const buildDocs = (): SearchDoc[] =>
        records.map((record) => ({
            id: record.id,
            display: record.name,
            name: str(record.name),
            bio: str(record.bio),
            major: str(record.major),
            roles: arr(record.roles),
            tags: arr(record.tags)
        }))
    return runSearch("contributors", recordsVersion(records), buildDocs, CONTRIBUTOR_FIELDS, CONTRIBUTOR_BOOST, query)
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
    // Same-titled, same-composer works are otherwise indistinguishable among hits (composer + name is all
    // that's shown) - see disambiguatedCompositionName's header (db_composition.ts). Only the displayed
    // `display` string is disambiguated; the indexed `name` field stays raw so matching is unaffected.
    const collisionCounts = new Map<string, number>()
    for (const record of records) {
        const key = compositionNameCollisionKey(record.composer_id, record.name)
        collisionCounts.set(key, (collisionCounts.get(key) ?? 0) + 1)
    }
    const buildDocs = (): SearchDoc[] =>
        records.map((record) => {
            const composer = composer_names.get(record.composer_id) ?? ""
            const has_collision =
                (collisionCounts.get(compositionNameCollisionKey(record.composer_id, record.name)) ?? 0) > 1
            const display_name = disambiguatedCompositionName(record.name, record.part, has_collision)
            return {
                id: record.id,
                display: composer ? `${composer}: ${display_name}` : display_name,
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
    // Composer names are indexed and shown in the display string, so this index depends on the composer
    // map as well as on the compositions. A rename changes neither the composition rows nor the map size,
    // so the map has to contribute to the version directly or the cache would serve the old name.
    const version = `${recordsVersion(records)}|${mapVersion(composer_names)}`
    return runSearch("compositions", version, buildDocs, COMPOSITION_FIELDS, COMPOSITION_BOOST, query)
}
