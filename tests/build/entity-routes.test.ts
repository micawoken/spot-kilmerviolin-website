/**
 * tests/build/entity-routes.test.ts
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

import { describe, expect, it } from "vitest"

import { TEMPLATE_NONE_SLUG, type BuildEntityTemplate } from "../../src/lib/build/design-api"
import { resolveEntityTemplates } from "../../src/lib/build/entity-routes"
import { emptyDesignDoc } from "../../src/lib/compositor/migrations"

function template(overrides: Partial<BuildEntityTemplate> & Pick<BuildEntityTemplate, "collection">): BuildEntityTemplate {
    return {
        id: `${overrides.collection}-tpl`,
        slug: `${overrides.collection}-detail`,
        title: "Detail",
        isDefault: false,
        doc: emptyDesignDoc(),
        ...overrides
    }
}

describe("resolveEntityTemplates — no templates published yet", () => {
    it("resolves every noun to null, in ENTITY_NOUNS order", () => {
        expect(resolveEntityTemplates([])).toEqual([
            { noun: "composer", template: null },
            { noun: "composition", template: null },
            { noun: "contributor", template: null }
        ])
    })
})

describe("resolveEntityTemplates — one default per noun", () => {
    it("resolves each noun to its published default, leaving un-templated nouns null", () => {
        const composerDefault = template({ collection: "composer", isDefault: true })
        const compositionDefault = template({ collection: "composition", isDefault: true })

        const result = resolveEntityTemplates([composerDefault, compositionDefault])

        expect(result).toEqual([
            { noun: "composer", template: composerDefault },
            { noun: "composition", template: compositionDefault },
            { noun: "contributor", template: null }
        ])
    })

    it("ignores a published template that is not marked is_default", () => {
        const notDefault = template({ collection: "composer", isDefault: false })

        expect(resolveEntityTemplates([notDefault])).toEqual([
            { noun: "composer", template: null },
            { noun: "composition", template: null },
            { noun: "contributor", template: null }
        ])
    })
})

describe("resolveEntityTemplates — the None sentinel", () => {
    it("resolves to null, same as having no default at all — an explicit opt-out of public pages", () => {
        const none = template({ collection: "contributor", isDefault: true, slug: TEMPLATE_NONE_SLUG })

        expect(resolveEntityTemplates([none])).toEqual([
            { noun: "composer", template: null },
            { noun: "composition", template: null },
            { noun: "contributor", template: null }
        ])
    })
})

describe("resolveEntityTemplates — an ambiguous default", () => {
    it("throws when two published templates both default the same noun", () => {
        const first = template({ id: "a", slug: "a", collection: "composer", isDefault: true })
        const second = template({ id: "b", slug: "b", collection: "composer", isDefault: true })

        expect(() => resolveEntityTemplates([first, second])).toThrow(/composer.*a, b|composer.*defaulted by 2/s)
    })

    it("does not throw when two different nouns each have their own default", () => {
        const composer = template({ collection: "composer", isDefault: true })
        const contributor = template({ collection: "contributor", isDefault: true })

        expect(() => resolveEntityTemplates([composer, contributor])).not.toThrow()
    })
})
