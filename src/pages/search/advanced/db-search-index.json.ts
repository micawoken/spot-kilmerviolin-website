/**
 * pages/search/advanced/db-search-index.json.ts
 *
 * Stores the database objects and fields used for advanced search
 * (not ideal, but trying to reduce worker invocations)
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

import type { APIRoute } from "astro"

import { normalizeKeyForSearch } from "../../../lib/api/common"
import { fetchComposers, fetchCompositions, fetchContributors } from "../../../lib/build/d1-api"
import { fetchPublishedEntityTemplates } from "../../../lib/build/design-api"
import { disambiguatedCompositionNames } from "../../../lib/build/entity-records"
import { resolveEntityTemplates } from "../../../lib/build/entity-routes"
import { fetchEntitySlugIndex } from "../../../lib/build/entity-slug"
import { entityHref } from "../../../lib/compositor/composition-fields"
import type { EntityNoun } from "../../../lib/compositor/entity-fields"
import type { FacetEntry } from "../../../lib/search/facets"

export const prerender = true

export const GET: APIRoute = async () => {
    const [composers, contributors, compositions, entityTemplates, slugIndex] = await Promise.all([
        fetchComposers(),
        fetchContributors(),
        fetchCompositions(),
        fetchPublishedEntityTemplates(),
        fetchEntitySlugIndex()
    ])

    const resolutions = resolveEntityTemplates(entityTemplates)
    const recordCounts: Record<EntityNoun, number> = {
        composer: composers?.length ?? 0,
        composition: compositions?.length ?? 0,
        contributor: contributors?.length ?? 0
    }
    const availableNouns = new Set(
        resolutions.filter(({ noun, template }) => template !== null && recordCounts[noun] > 0).map(({ noun }) => noun)
    )

    const composerNames = new Map<number, string>()
    for (const record of composers ?? []) composerNames.set(record.id, record.name)

    const entries: FacetEntry[] = []

    if (availableNouns.has("composer")) {
        for (const record of composers ?? []) {
            const slug = slugIndex.composer.get(record.id) ?? String(record.id)
            const entry: FacetEntry = { url: entityHref("composer", slug), noun: "composer", name: record.name }
            if (record.country) entry.country = record.country
            if (record.role) entry.role = record.role
            if (typeof record.birth_year === "number") entry.birthYear = record.birth_year
            // -1 is the "living composer" sentinel (format.ts's formatDeathYear) - not a real death year
            // to filter on
            if (typeof record.death_year === "number" && record.death_year !== -1) entry.deathYear = record.death_year
            if (record.tags.length > 0) entry.tags = record.tags.join(", ")
            entries.push(entry)
        }
    }

    if (availableNouns.has("composition")) {
        // Same-titled, same-composer works are otherwise indistinguishable in results (only name +
        // composer are shown)
        const compositionNames = disambiguatedCompositionNames(compositions)
        for (const record of compositions ?? []) {
            const slug = slugIndex.composition.get(record.id) ?? String(record.id)
            const entry: FacetEntry = {
                url: entityHref("composition", slug),
                noun: "composition",
                name: compositionNames.get(record.id) ?? record.name
            }
            const composerName = composerNames.get(record.composer_id)
            if (composerName) {
                entry.composer = composerName
                entry.composerId = record.composer_id
            }
            const secondaryAuthorNames = record.author_secondary
                .map((id) => composerNames.get(id))
                .filter((name): name is string => Boolean(name))
            if (secondaryAuthorNames.length > 0) entry.secondaryAuthors = secondaryAuthorNames.join(", ")
            if (record.part) entry.part = record.part
            if (record.key) entry.keyRef = normalizeKeyForSearch(record.key)
            if (record.type) entry.type = record.type
            if (typeof record.publication_info.year === "number") entry.year = record.publication_info.year
            if (record.publication_info.name) entry.publisher = record.publication_info.name
            if (typeof record.rating.suzuki === "number") entry.suzuki = record.rating.suzuki
            if (typeof record.rating.nyssma === "number") entry.nyssma = record.rating.nyssma
            if (record.tags.length > 0) entry.tags = record.tags.join(", ")
            entries.push(entry)
        }
    }

    if (availableNouns.has("contributor")) {
        for (const record of contributors ?? []) {
            const slug = slugIndex.contributor.get(record.id) ?? String(record.id)
            const entry: FacetEntry = {
                url: entityHref("contributor", slug),
                noun: "contributor",
                name: record.name
            }
            if (typeof record.class_year === "number") entry.classYear = record.class_year
            if (record.tags.length > 0) entry.tags = record.tags.join(", ")
            entries.push(entry)
        }
    }

    // Composer-then-name for works (groups a composer's works together), plain name order otherwise
    entries.sort((a, b) => (a.composer ?? "").localeCompare(b.composer ?? "") || a.name.localeCompare(b.name))

    return new Response(JSON.stringify(entries), {
        headers: { "Content-Type": "application/json" }
    })
}
