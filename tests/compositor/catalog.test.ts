/**
 * tests/compositor/catalog.test.ts
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

import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import {
    buildConfig,
    OUTLET_PROPS,
    RICH_TEXT_PROPS,
    TOKEN_PROPS,
    TOKEN_USAGE_NOTES,
    tokenKindUsers
} from "../../src/lib/compositor/catalog"
import { lintDesign } from "../../src/lib/compositor/lint"
import type { CollectionField } from "../../src/lib/build/design-api"
import type { TokenCatalog } from "../../src/lib/compositor/tokens"
import type { DesignDoc, PuckData } from "../../src/lib/compositor/types"

const theme: TokenCatalog = {
    schemaVersion: 1,
    colors: [
        { name: "page-bg", value: "#fff" },
        { name: "accent", value: "#2337ff" }
    ],
    typography: [{ name: "display", family: "serif", size: "2rem", weight: "700", lineHeight: "1.2" }],
    space: [
        { name: "sm", value: "1rem" },
        { name: "md", value: "2rem" }
    ],
    radius: [{ name: "md", value: "0.5rem" }],
    shadows: [{ name: "md", value: "0 1px 3px rgba(0,0,0,0.12)" }],
    borders: [{ name: "default", width: "1px", style: "solid", colorRef: "accent" }],
    breakpoints: [{ name: "md", minWidth: "768px" }]
}

/** The frozen catalog v1 component set (§4.5). A change here is a deliberate version bump. */
const CATALOG_V1 = ["Section", "Columns", "Heading", "RichText", "Image", "Button", "Spacer", "Divider"]

/** The Phase B content outlets (pivot §4) — registered in every target alongside catalog v1. */
const OUTLETS = ["ContentText", "ContentRichText", "ContentImage"]

/** The hybrid template model's dedicated entity block (impl plan Step 4). */
const ENTITY_BLOCKS = ["CompositionDetail"]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function field(config: any, component: string, prop: string): any {
    return config.components[component].fields[prop]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(config: any, component: string, props: Record<string, unknown>): string {
    return renderToStaticMarkup(config.components[component].render(props))
}

describe("buildConfig — component set", () => {
    it("exposes exactly catalog v1 plus the content outlets and entity blocks in both targets", () => {
        const expected = [...CATALOG_V1, ...OUTLETS, ...ENTITY_BLOCKS].sort()
        expect(Object.keys(buildConfig(theme, "editor").components).sort()).toEqual(expected)
        expect(Object.keys(buildConfig(theme, "build").components).sort()).toEqual(expected)
    })
})

describe("buildConfig — token-select options track the live theme", () => {
    const config = buildConfig(theme, "editor")
    it("populates a token select from the theme's tokens", () => {
        expect(field(config, "Heading", "typography").options).toEqual([{ label: "display", value: "display" }])
        expect(field(config, "Spacer", "size").options).toEqual([
            { label: "sm", value: "sm" },
            { label: "md", value: "md" }
        ])
    })
    it("prepends a None option to optional token selects", () => {
        expect(field(config, "Section", "background").options[0]).toEqual({ label: "None", value: "" })
        expect(field(config, "Divider", "color").options[0]).toEqual({ label: "None", value: "" })
    })
})

describe("buildConfig — editor vs build richtext field", () => {
    it("uses a native richtext field in the editor target", () => {
        expect(field(buildConfig(theme, "editor"), "RichText", "body").type).toBe("richtext")
    })
    it("uses a passthrough (non-richtext) field in the build target so a stored PT array is not blanked", () => {
        // Puck's useRichtextProps normalizes a PT array to an empty ProseMirror doc; the build path must
        // keep `body` out of that interception so the render receives the raw array (see catalog header).
        expect(field(buildConfig(theme, "build"), "RichText", "body").type).not.toBe("richtext")
    })
    it("attaches the media custom field only in the editor target", () => {
        expect(field(buildConfig(theme, "editor"), "Image", "media").type).toBe("custom")
        expect(field(buildConfig(theme, "build"), "Image", "media").type).not.toBe("custom")
    })
})

describe("RICH_TEXT_PROPS", () => {
    it("registers exactly RichText.body (drives convert.ts walks; contributor rule 5)", () => {
        expect(RICH_TEXT_PROPS).toEqual({ RichText: ["body"] })
    })
})

describe("OUTLET_PROPS", () => {
    it("registers every outlet with its accepted schema field types (contributor rule)", () => {
        expect(OUTLET_PROPS).toEqual({
            ContentText: ["string", "text"],
            ContentRichText: ["portableText"],
            ContentImage: ["image"]
        })
    })
})

describe("TOKEN_PROPS", () => {
    it("registers every token-select field and the kind it draws from (contributor rule)", () => {
        // Pinned deliberately: a new token-select field added to a component's `fields` without a
        // matching entry here breaks this test — exactly the gap the lint pass otherwise misses
        // silently (see the "CompositionDetail's headingTypography" test below).
        expect(TOKEN_PROPS).toEqual({
            Section: { background: "colors", paddingY: "space" },
            Columns: { gap: "space" },
            Heading: { typography: "typography" },
            ContentText: { typography: "typography" },
            Spacer: { size: "space" },
            Divider: { spaceAround: "space", color: "colors" },
            Button: { variant: "buttonVariants" },
            CompositionDetail: { headingTypography: "typography" }
        })
    })

    it("catches a dangling CompositionDetail.headingTypography — the lint hole a missed registration would leave", () => {
        const doc: DesignDoc = {
            schemaVersion: 1,
            puck: {
                root: { props: {} },
                content: [{ type: "CompositionDetail", props: { headingTypography: "no-such-token" } }]
            } as unknown as PuckData
        }
        const findings = lintDesign(doc, theme, TOKEN_PROPS, OUTLET_PROPS, undefined, true)
        expect(findings.some((f) => f.rule === "unknown-token")).toBe(true)
    })
})

describe("tokenKindUsers", () => {
    it("derives every Component.field pair for a kind from TOKEN_PROPS, in registry order", () => {
        // Pinned against TOKEN_PROPS' current shape (see the describe block above) — a change to which
        // components draw from "typography" should be visible here too, since the theme editor's
        // typography preview surfaces this list to the author.
        expect(tokenKindUsers("typography")).toEqual(["Heading.typography", "ContentText.typography", "CompositionDetail.headingTypography"])
        expect(tokenKindUsers("buttonVariants")).toEqual(["Button.variant"])
    })

    it("returns [] for a kind no component's fields draw from directly", () => {
        expect(tokenKindUsers("breakpoints")).toEqual([])
    })
})

describe("TOKEN_USAGE_NOTES", () => {
    it("covers exactly the kinds whose binding isn't fully explained by TOKEN_PROPS alone", () => {
        // colors/typography/buttonVariants are deliberately omitted (TOKEN_PROPS already answers "which
        // component" for those); space/radius/borders/shadows each have an indirection or "consumed by
        // nothing" fact TOKEN_PROPS can't express, which is the whole reason this map is hand-written.
        expect(Object.keys(TOKEN_USAGE_NOTES).sort()).toEqual(["borders", "radius", "shadows", "space"])
    })
})

describe("buildConfig — outlet field pickers (editor context)", () => {
    const fields: CollectionField[] = [
        { slug: "title", label: "Title", type: "string" },
        { slug: "body", label: "Body", type: "portableText" },
        { slug: "cover", label: "Cover", type: "image" },
        { slug: "published", label: "Published", type: "boolean" }
    ]
    const config = buildConfig(theme, "editor", { entry: null, fields })

    it("offers only fields whose type the outlet accepts, after the unbound option", () => {
        expect(field(config, "ContentText", "field").options).toEqual([
            { label: "— choose a field —", value: "" },
            { label: "Title", value: "title" }
        ])
        expect(field(config, "ContentRichText", "field").options).toEqual([
            { label: "— choose a field —", value: "" },
            { label: "Body", value: "body" }
        ])
        expect(field(config, "ContentImage", "field").options).toEqual([
            { label: "— choose a field —", value: "" },
            { label: "Cover", value: "cover" }
        ])
    })

    it("offers only the unbound option when the config has no schema context", () => {
        expect(field(buildConfig(theme, "editor"), "ContentText", "field").options).toEqual([
            { label: "— choose a field —", value: "" }
        ])
    })
})

describe("buildConfig — Button drives theme-authored variants through --cmp-button-* locals", () => {
    const config = buildConfig(theme, "build")

    it("its variant field is a token select over buttonVariants", () => {
        // Empty here because this theme declares none — the point is it is a token select, not a fixed enum.
        expect(field(config, "Button", "variant").type).toBe("select")
        expect(field(config, "Button", "variant").options).toEqual([])
    })

    it("renders .cmp-button carrying the --cmp-button-* vars, and no modifier class", () => {
        const html = render(config, "Button", { label: "Go", href: "/x", variant: "primary" })
        expect(html).toContain('class="cmp-button"')
        expect(html).not.toContain("cmp-button--")
        expect(html).toContain("--cmp-button-bg:var(--dtk-btn-primary-bg)")
        expect(html).toContain("--cmp-button-text:var(--dtk-btn-primary-text)")
        expect(html).toContain("--cmp-button-radius:var(--dtk-btn-primary-radius)")
        expect(html).toContain("--cmp-button-border-color:var(--dtk-btn-primary-border-color)")
        expect(html).toContain(">Go</a>")
    })

    it("still renders an unknown variant name (unset vars, no throw)", () => {
        const html = render(config, "Button", { label: "Go", href: "/x", variant: "does-not-exist" })
        expect(html).toContain('class="cmp-button"')
        expect(html).toContain("--cmp-button-bg:var(--dtk-btn-does-not-exist-bg)")
    })
})

describe("buildConfig — outlet renders resolve through the entry context (D7)", () => {
    const MEDIA_ORIGIN = "https://store.example.test"

    const entry = {
        title: "  ",
        headline: "From the entry",
        body: [{ _type: "block", style: "normal", children: [{ _type: "span", text: "hello" }] }],
        // The LOCAL-media wire shape EmDash actually serves: `src` stripped on persist, key at
        // `meta.storageKey` (emdash/src/media/normalize.ts). An earlier fixture here invented a bare
        // `id` and the assertions pinned the resulting 404-and-Access-gated URL as correct behavior.
        cover: { id: "med_1", alt: "A violin", width: 800, height: 600, provider: "local", meta: { storageKey: "med_1.jpg" } },
        // An external provider's value: already a public absolute URL, passed through untouched.
        coverWithSrc: { id: "med_2", src: "https://cdn.example/violin.jpg", alt: "" },
        // An id and nothing else — no usable handle at all (the file route is keyed by storage key).
        coverIdOnly: { id: "med_3", alt: "Orphan" },
        // A D1 entity's `image` column: a plain string, not an EmDash media object.
        entityCover: "https://images.example.test/composer.jpg"
    }

    it("renders nothing at build with no entry context (design_page path, D3)", () => {
        const config = buildConfig(theme, "build")
        expect(render(config, "ContentText", { field: "headline", level: "h2", typography: "display", align: "start" })).toBe("")
        expect(render(config, "ContentRichText", { field: "body" })).toBe("")
        expect(render(config, "ContentImage", { field: "cover", aspect: "original" })).toBe("")
    })

    it("renders a placeholder in the editor when no value resolves", () => {
        const config = buildConfig(theme, "editor")
        expect(render(config, "ContentText", { field: "", level: "h2", typography: "display", align: "start" })).toContain(
            "cmp-outlet-placeholder"
        )
        expect(render(config, "ContentText", { field: "", level: "h2", typography: "display", align: "start" })).toContain(
            "not bound"
        )
    })

    it("ContentText renders the entry value through the shared Heading markup", () => {
        const config = buildConfig(theme, "build", { entry })
        const html = render(config, "ContentText", { field: "headline", level: "h3", typography: "display", align: "center" })
        expect(html).toContain("<h3")
        expect(html).toContain("cmp-heading")
        expect(html).toContain("From the entry")
    })

    it("ContentText treats a whitespace-only value as empty", () => {
        const config = buildConfig(theme, "build", { entry })
        expect(render(config, "ContentText", { field: "title", level: "h2", typography: "display", align: "start" })).toBe("")
    })

    it("ContentRichText renders the entry's PT array via the parity renderer", () => {
        const config = buildConfig(theme, "build", { entry })
        const html = render(config, "ContentRichText", { field: "body" })
        expect(html).toContain("cmp-richtext")
        expect(html).toContain("hello")
    })

    it("ContentImage resolves local media through the PUBLIC origin, never the Access-gated proxy", () => {
        const config = buildConfig(theme, "build", { entry, mediaBaseUrl: MEDIA_ORIGIN })
        const html = render(config, "ContentImage", { field: "cover", aspect: "landscape" })
        expect(html).toContain(`src="${MEDIA_ORIGIN}/med_1.jpg"`)
        expect(html).toContain('alt="A violin"')
        expect(html).toContain('data-aspect="landscape"')
        expect(html).toContain('width="800"')
        // A prerendered page is served to anonymous visitors; /_emdash 302s them to an Access login.
        expect(html).not.toContain("/_emdash")
    })

    it("ContentImage passes an external provider's absolute URL through untouched", () => {
        const config = buildConfig(theme, "build", { entry, mediaBaseUrl: MEDIA_ORIGIN })
        const html = render(config, "ContentImage", { field: "coverWithSrc", aspect: "original" })
        expect(html).toContain('src="https://cdn.example/violin.jpg"')
    })

    it("ContentImage renders nothing for a value carrying only a media id (no usable handle)", () => {
        const config = buildConfig(theme, "build", { entry, mediaBaseUrl: MEDIA_ORIGIN })
        expect(render(config, "ContentImage", { field: "coverIdOnly", aspect: "original" })).toBe("")
    })

    it("ContentImage passes a D1 entity's raw string image through, with empty alt (no alt field exists)", () => {
        const config = buildConfig(theme, "build", { entry, mediaBaseUrl: MEDIA_ORIGIN })
        const html = render(config, "ContentImage", { field: "entityCover", aspect: "original" })
        expect(html).toContain('src="https://images.example.test/composer.jpg"')
        expect(html).toContain('alt=""')
    })

    it("Heading and ContentText produce identical markup for the same inputs (twin contract)", () => {
        const config = buildConfig(theme, "build", { entry })
        const viaHeading = render(config, "Heading", { text: "From the entry", level: "h2", typography: "display", align: "start" })
        const viaOutlet = render(config, "ContentText", { field: "headline", level: "h2", typography: "display", align: "start" })
        expect(viaOutlet).toBe(viaHeading)
    })
})

describe("buildConfig — CompositionDetail (hybrid core, pivot Step 4)", () => {
    const composition: Record<string, unknown> = {
        id: 42,
        name: "Concerto in D",
        type: "Concerto",
        part: "Violin",
        image: "https://images.example.test/concerto.jpg",
        composer_id: 5,
        author_secondary: [6],
        contrib_primary_1: 10,
        contrib_primary_2: 11,
        contrib_addl: [12, 13],
        phases: [1, 2],
        key: "D major",
        range: "G3-E6",
        position_highest: "5th",
        rating: { suzuki: 8, nyssma: 4 },
        publication_info: { name: "Example Press", location: "New York", year: 1990, uri_type: "https", uri: "https://example.test/score" },
        notes_historical: "Written in 1990.",
        notes_pedagogical: "Good for advanced students.",
        notes_other: "N/A",
        tags: ["romantic", "advanced"]
    }

    const names = {
        composer_name: "Jane Composer",
        author_secondary_names: ["Second Author"],
        contrib_primary_1_name: "Primary Editor",
        contrib_primary_2_name: "Co Editor",
        contrib_addl_names: ["Addl One", "Addl Two"]
    }

    const props = { headingTypography: "display" }

    it("renders nothing at build and a placeholder in the editor with no entry", () => {
        expect(render(buildConfig(theme, "build"), "CompositionDetail", props)).toBe("")
        expect(render(buildConfig(theme, "editor"), "CompositionDetail", props)).toContain("cmp-outlet-placeholder")
    })

    it("renders nothing for an entry with no `name` — not a composition (defensive, not a crash)", () => {
        const config = buildConfig(theme, "build", { entry: { title: "not a composition" } })
        expect(render(config, "CompositionDetail", props)).toBe("")
    })

    it("renders the name, id, type, and part", () => {
        const config = buildConfig(theme, "build", { entry: composition, entryNames: names })
        const html = render(config, "CompositionDetail", props)
        expect(html).toContain("Concerto in D")
        expect(html).toContain("ID #42")
        expect(html).toContain("Concerto")
        expect(html).toContain("Violin")
    })

    it("links composer and contributor references to the public /entity/{noun}/{id} route with resolved names", () => {
        const config = buildConfig(theme, "build", { entry: composition, entryNames: names })
        const html = render(config, "CompositionDetail", props)
        expect(html).toContain('href="/entity/composer/5"')
        expect(html).toContain("Jane Composer")
        expect(html).toContain('href="/entity/composer/6"')
        expect(html).toContain("Second Author")
        expect(html).toContain('href="/entity/contributor/10"')
        expect(html).toContain("Primary Editor")
        expect(html).toContain('href="/entity/contributor/11"')
        expect(html).toContain("Co Editor")
        expect(html).toContain('href="/entity/contributor/12"')
        expect(html).toContain("Addl One")
        expect(html).toContain('href="/entity/contributor/13"')
        expect(html).toContain("Addl Two")
    })

    it("falls back to a bare-id label (still linked) when a reference name is unresolved", () => {
        const config = buildConfig(theme, "build", {
            entry: composition,
            entryNames: { ...names, contrib_primary_1_name: "" }
        })
        const html = render(config, "CompositionDetail", props)
        expect(html).toContain('href="/entity/contributor/10">10<')
    })

    it("renders an unset optional reference (contrib_primary_2) as the placeholder, unlinked", () => {
        const config = buildConfig(theme, "build", {
            entry: { ...composition, contrib_primary_2: null },
            entryNames: names
        })
        const html = render(config, "CompositionDetail", props)
        expect(html).not.toContain("/entity/contributor/11")
        expect(html).toContain("no additional primary contributor specified")
    })

    it("renders the publication URI as an https link via the shared renderPublicationUri", () => {
        const config = buildConfig(theme, "build", { entry: composition, entryNames: names })
        const html = render(config, "CompositionDetail", props)
        expect(html).toContain('href="https://example.test/score"')
    })

    it("renders ratings, key/range/position, notes, and tags", () => {
        const config = buildConfig(theme, "build", { entry: composition, entryNames: names })
        const html = render(config, "CompositionDetail", props)
        expect(html).toContain("D major")
        expect(html).toContain("G3-E6")
        expect(html).toContain("5th")
        expect(html).toContain("Written in 1990.")
        expect(html).toContain("Good for advanced students.")
        expect(html).toContain("romantic, advanced")
    })

    it("renders the composition's own image via mediaSource, with empty alt (no alt field exists)", () => {
        const config = buildConfig(theme, "build", { entry: composition, entryNames: names, mediaBaseUrl: "https://store.example.test" })
        const html = render(config, "CompositionDetail", props)
        expect(html).toContain('src="https://images.example.test/concerto.jpg"')
        expect(html).toContain('alt=""')
    })

    it("omits the image block entirely when the composition has no image", () => {
        const config = buildConfig(theme, "build", { entry: { ...composition, image: null }, entryNames: names })
        const html = render(config, "CompositionDetail", props)
        expect(html).not.toContain("cmp-composition-detail__image")
    })

    it("renders placeholders throughout when entryNames is absent (no crash on missing names)", () => {
        const config = buildConfig(theme, "build", { entry: composition })
        const html = render(config, "CompositionDetail", props)
        // Composer-name refs show the placeholder as the link label when the name is unresolved
        // (mirrors renderComposerNameLink); contributor refs fall back to the bare id instead.
        expect(html).toContain('href="/entity/composer/5">(error in composer name)<')
        expect(html).toContain('href="/entity/contributor/10">10<')
    })
})
