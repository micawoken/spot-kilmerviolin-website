/**
 * tests/tools/seed-entity-templates.test.ts
 *
 * Lints the exact seed design docs tools/seed-entity-templates.mjs writes, against the REAL
 * entityFields catalog, OUTLET_PROPS, and TOKEN_PROPS — so a future entity-fields.ts change (a
 * renamed/removed field, a new required kind) that would make a seeded doc dangling or unpublishable
 * fails a test instead of surfacing only when the owner tries to publish it.
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
 *
 * This license is also subject to additional terms as specified in the README.md.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, expect, it } from "vitest"

import { OUTLET_PROPS, TOKEN_PROPS } from "../../src/lib/compositor/catalog"
import { ENTITY_NOUNS, entityFields, type EntityNoun } from "../../src/lib/compositor/entity-fields"
import { hasBlockingError, lintDesign } from "../../src/lib/compositor/lint"
import type { TokenCatalog } from "../../src/lib/compositor/tokens"
import type { DesignDoc } from "../../src/lib/compositor/types"
// A plain-JS tool script (see its header for why); vitest handles the ESM import directly.
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { SEEDS } from "../../tools/seed-entity-templates.mjs"

// Mirrors setup-design-collections.mjs's SEED_THEME's token NAMES (not values — irrelevant to lint):
// "body"/"display" typography, "md" space. A seed doc using any other token name would fail this test,
// which is the point — it proves the doc lints clean against the theme it will actually be reviewed
// against, not an artificially permissive fixture.
const THEME: TokenCatalog = {
    schemaVersion: 1,
    colors: [],
    typography: [
        { name: "body", family: "sans-serif", size: "1rem", weight: "400", lineHeight: "1.5" },
        { name: "display", family: "serif", size: "2rem", weight: "700", lineHeight: "1.2" }
    ],
    space: [{ name: "md", value: "1rem" }],
    radius: [],
    shadows: [],
    borders: [],
    breakpoints: []
}

// A representative entry per noun, covering every field kind the seed docs bind — including a
// resolved reference/referenceList/uri, matching entity-records.ts's normalized shape.
const ENTRIES: Record<EntityNoun, Record<string, unknown>> = {
    composer: {
        name: "Bach",
        role: "composer",
        birth_year: 1685,
        death_year: 1750,
        country: "DE",
        bio: "Baroque composer.",
        image: "https://images.example.test/bach.jpg",
        tags: ["baroque"],
        entry_date: "2026-01-01",
        change_date: "2026-01-01"
    },
    contributor: {
        name: "Ada",
        class_year: 2027,
        major: "Music",
        bio: "Violinist.",
        public_email: "ada@example.test",
        image: null,
        tags: [],
        entry_date: "2026-01-01",
        change_date: "2026-01-01"
    },
    composition: {
        name: "Concerto",
        id: 10,
        type: "Chamber",
        part: "Violin",
        image: null,
        composer: { id: 1, name: "Bach", href: "/entity/composer/1" },
        author_secondary: [],
        contrib_primary_1: { id: 2, name: "Ada", href: "/entity/contributor/2" },
        contrib_primary_2: null,
        contrib_addl: [],
        phases: [1, 2],
        key: "G Major",
        range: "G3-E6",
        position_highest: "5th",
        rating_suzuki: 4,
        rating_nyssma: null,
        publish_name: "Example Press",
        publish_location: "New York",
        publish_year: 1990,
        publication_uri: { uriType: "https", uri: "https://example.test/score" },
        notes_historical: "Written in 1990.",
        notes_pedagogical: "Good for advanced students.",
        notes_other: "",
        tags: ["romantic"],
        entry_date: "2026-01-01",
        change_date: "2026-01-01"
    }
}

interface Seed {
    noun: EntityNoun
    title: string
    design: unknown
}

/** Looks up one noun's seed, throwing (not returning undefined) so callers need no further guard. */
function seedFor(noun: EntityNoun): Seed {
    const seed = (SEEDS as Seed[]).find((s) => s.noun === noun)
    if (!seed) throw new Error(`no seed found for noun "${noun}"`)
    return seed
}

describe("tools/seed-entity-templates.mjs — seed docs pass the real pairing lint", () => {
    it("seeds exactly the three entity nouns, one each", () => {
        expect((SEEDS as Seed[]).map((s) => s.noun).sort()).toEqual([...ENTITY_NOUNS].sort())
    })

    for (const noun of ENTITY_NOUNS) {
        it(`${noun}'s seed doc has no blocking lint error against a representative entry`, () => {
            const seed = seedFor(noun)

            const findings = lintDesign(
                seed.design as DesignDoc,
                THEME,
                TOKEN_PROPS,
                OUTLET_PROPS,
                { entry: ENTRIES[noun], schemaFields: [...entityFields(noun)] },
                true
            )

            const errors = findings.filter((f) => f.severity === "error")
            expect(errors, JSON.stringify(errors, null, 2)).toEqual([])
            expect(hasBlockingError(findings)).toBe(false)
        })

        it(`${noun}'s seed doc places every field entityFields(${noun}) declares, exactly once`, () => {
            const seed = seedFor(noun)
            const bound: string[] = []
            const walk = (nodes: unknown[]): void => {
                for (const node of nodes) {
                    if (typeof node !== "object" || node === null) continue
                    const { type, props } = node as { type?: string; props?: Record<string, unknown> }
                    if (!props) continue
                    if (
                        (type === "ContentText" || type === "ContentField" || type === "ContentImage" || type === "MediaText") &&
                        typeof props.field === "string"
                    ) {
                        bound.push(props.field)
                    }
                    for (const value of Object.values(props)) {
                        if (Array.isArray(value)) walk(value)
                    }
                }
            }
            walk((seed.design as DesignDoc).puck.content as unknown[])

            const expected = entityFields(noun).map((f) => f.slug)
            expect(bound.sort()).toEqual([...expected].sort())
        })
    }
})
