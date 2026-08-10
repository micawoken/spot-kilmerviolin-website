/**
 * tests/compositor/catalog.test.ts
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

import { describe, it, expect } from "vitest"
import { createElement, type CSSProperties } from "react"
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

/** The frozen catalog v1 component set (§4.5), plus `Row` — the flow invariant's explicit horizontal
 * container (unified field-outlet rewrite) — `PagefindSearch`/`Breadcrumbs`, and `RelatedEntries`, the
 * three components added since. A change here is a deliberate version bump. */
const CATALOG_V1 = [
    "Section",
    "Columns",
    "Row",
    "Heading",
    "RichText",
    "Image",
    "Button",
    "Spacer",
    "Divider",
    "PagefindSearch",
    "Breadcrumbs",
    "RelatedEntries"
]

/** The content outlets (pivot §4), including the unified field-outlet rewrite's `ContentField` (any
 * non-image entity field) and `MediaText` (the collapsing media+text primitive) — registered in every
 * target alongside catalog v1. */
const OUTLETS = ["ContentText", "ContentRichText", "ContentImage", "ContentField", "MediaText"]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function field(config: any, component: string, prop: string): any {
    return config.components[component].fields[prop]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function render(config: any, component: string, props: Record<string, unknown>): string {
    return renderToStaticMarkup(config.components[component].render(props))
}

describe("buildConfig — component set", () => {
    it("exposes exactly catalog v1 plus the content outlets in both targets", () => {
        const expected = [...CATALOG_V1, ...OUTLETS].sort()
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
            ContentImage: ["image"],
            ContentField: [
                "string",
                "text",
                "number",
                "date",
                "reference",
                "referenceList",
                "referenceListWithRole",
                "list",
                "uri",
                "yearOrLiving",
                "countryCode",
                "email",
                "titleCase",
                "citations"
            ],
            MediaText: ["image"]
        })
    })
})

describe("TOKEN_PROPS", () => {
    it("registers every token-select field and the kind it draws from (contributor rule)", () => {
        // Pinned deliberately: a new token-select field added to a component's `fields` without a
        // matching entry here breaks this test — exactly the gap the lint pass otherwise misses
        // silently (see the "dangling ContentField.typography" test below).
        expect(TOKEN_PROPS).toEqual({
            Section: { background: "colors", paddingY: "space", radius: "radius", border: "borders", shadow: "shadows" },
            Columns: { columnGap: "space", rowGap: "space" },
            Row: { columnGap: "space", rowGap: "space" },
            Heading: { typography: "typography" },
            ContentText: { typography: "typography" },
            ContentField: { typography: "typography" },
            Spacer: { size: "space" },
            Divider: { spaceAround: "space", color: "colors" },
            Button: { variant: "buttonVariants", shadow: "shadows" },
            Image: { radius: "radius", border: "borders", shadow: "shadows" },
            ContentImage: { radius: "radius", border: "borders", shadow: "shadows" },
            MediaText: { radius: "radius", border: "borders", shadow: "shadows" }
        })
    })

    it("catches a dangling ContentField.typography — the lint hole a missed registration would leave", () => {
        const doc: DesignDoc = {
            schemaVersion: 1,
            puck: {
                root: { props: {} },
                content: [{ type: "ContentField", props: { field: "name", typography: "no-such-token" } }]
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
        expect(tokenKindUsers("typography")).toEqual(["Heading.typography", "ContentText.typography", "ContentField.typography"])
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
        // nothing" fact TOKEN_PROPS can't express, and breakpoints has no TOKEN_PROPS entry at all (it
        // drives a generated @media rule, not a component field) — this map is hand-written for exactly
        // these five kinds.
        expect(Object.keys(TOKEN_USAGE_NOTES).sort()).toEqual(["borders", "breakpoints", "radius", "shadows", "space"])
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

    describe("target", () => {
        // Absent `target` is what every Button stored before the field existed carries (trap A), so these
        // pin the automatic rule specifically against a stored design, not just against an explicit "".
        it("opens an internal href in the same tab", () => {
            const html = render(config, "Button", { label: "Go", href: "/database", variant: "primary" })
            expect(html).not.toContain("target=")
            expect(html).not.toContain("rel=")
        })

        it("opens an external href in a new tab, with rel", () => {
            const html = render(config, "Button", { label: "Go", href: "https://imslp.org", variant: "primary" })
            expect(html).toContain('target="_blank"')
            expect(html).toContain('rel="noopener noreferrer"')
        })

        it('forces a new tab for an internal href when target is "_blank"', () => {
            const html = render(config, "Button", { label: "Go", href: "/database", target: "_blank", variant: "primary" })
            expect(html).toContain('target="_blank"')
            expect(html).toContain('rel="noopener noreferrer"')
        })

        it('forces the same tab for an external href when target is "_self"', () => {
            const html = render(config, "Button", {
                label: "Go",
                href: "https://imslp.org",
                target: "_self",
                variant: "primary"
            })
            expect(html).not.toContain("target=")
        })

        // A rejected scheme renders as "#", so it must be judged as the fragment it becomes — never as the
        // external URL it was written as, which would hand a blocked link a new tab.
        it("keeps an unsafe href in the same tab once sanitized to #", () => {
            const html = render(config, "Button", { label: "Go", href: "javascript:alert(1)", variant: "primary" })
            expect(html).toContain('href="#"')
            expect(html).not.toContain("target=")
        })
    })
})

describe("buildConfig — PagefindSearch renders a plain GET form to /search", () => {
    const config = buildConfig(theme, "build")

    it("defaults to whole-site scope (no hidden scope input)", () => {
        const html = render(config, "PagefindSearch", { scope: "site" })
        expect(html).toContain('action="/search"')
        expect(html).toContain('method="get"')
        expect(html).not.toContain('name="scope"')
        expect(html).toContain('name="q"')
    })

    it("emits a hidden database-scope input when scoped to the database", () => {
        const html = render(config, "PagefindSearch", { scope: "database" })
        expect(html).toContain('type="hidden" name="scope" value="database"')
    })

    it("defaults to no advanced link and /search when advancedLink/display/showToggle are absent (pre-existing stored designs)", () => {
        // Simulates a design saved before `advancedLink` (or its `display`/`showToggle` predecessors) existed.
        const html = render(config, "PagefindSearch", { scope: "site" })
        expect(html).not.toContain("search-advanced-link")
        expect(html).toContain('action="/search"')
    })

    it("renders no advanced link when advancedLink is explicitly \"none\"", () => {
        const html = render(config, "PagefindSearch", { scope: "site", advancedLink: "none" })
        expect(html).not.toContain("search-advanced-link")
        expect(html).toContain('action="/search"')
    })

    it("renders a link to /search/advanced when advancedLink is \"advanced\", without changing the form's own target", () => {
        const html = render(config, "PagefindSearch", { scope: "site", advancedLink: "advanced" })
        expect(html).toContain('action="/search"')
        expect(html).toContain('class="search-advanced-link"')
        expect(html).toContain('href="/search/advanced"')
    })

    it("renders a link to /search when advancedLink is \"search\"", () => {
        const html = render(config, "PagefindSearch", { scope: "site", advancedLink: "search" })
        expect(html).toContain('class="search-advanced-link"')
        expect(html).toContain('href="/search"')
        expect(html).not.toContain('href="/search/advanced"')
    })

    it("maps a pre-existing showToggle=\"yes\" design onto advancedLink=\"advanced\" (back-compat)", () => {
        const html = render(config, "PagefindSearch", { scope: "site", display: "simple", showToggle: "yes" })
        expect(html).toContain('action="/search"')
        expect(html).toContain('href="/search/advanced"')
    })

    it("maps a pre-existing display=\"advanced\" design onto advancedLink=\"advanced\" (back-compat)", () => {
        const html = render(config, "PagefindSearch", { scope: "site", display: "advanced", showToggle: "no" })
        expect(html).toContain('action="/search"')
        expect(html).toContain('href="/search/advanced"')
    })
})

describe("buildConfig — Breadcrumbs auto-derives its trail from route context", () => {
    it("shows an illustrative preview in the editor with no route context attached", () => {
        const html = render(buildConfig(theme, "editor"), "Breadcrumbs", {})
        expect(html).toContain(">Home</a>")
        expect(html).toContain("Example page")
    })

    it("renders Home, each ancestor, and the current page title at build", () => {
        const config = buildConfig(theme, "build", {
            breadcrumbs: [{ label: "Composers", href: "/entity/composer/" }],
            pageTitle: "Bach"
        })
        const html = render(config, "Breadcrumbs", {})
        expect(html).toContain('<a href="/">Home</a>')
        expect(html).toContain('<a href="/entity/composer/">Composers</a>')
        expect(html).toContain('aria-current="page">Bach<')
    })

    it("renders a null-href ancestor as plain text, not a link", () => {
        const config = buildConfig(theme, "build", { breadcrumbs: [{ label: "Posts", href: null }], pageTitle: "My post" })
        const html = render(config, "Breadcrumbs", {})
        expect(html).toContain("<span>Posts</span>")
        expect(html).not.toContain('href="null"')
    })

    it("falls back to Home alone when no breadcrumb context resolves at build", () => {
        const config = buildConfig(theme, "build")
        const html = render(config, "Breadcrumbs", {})
        expect(html).toContain('<a href="/">Home</a>')
        expect(html).not.toContain("aria-current")
    })
})

describe("buildConfig — RelatedEntries reads related works from route context", () => {
    it("shows an illustrative preview in the editor with no route context attached", () => {
        const html = render(buildConfig(theme, "editor"), "RelatedEntries", { heading: "Related Works", limit: 6 })
        expect(html).toContain("Example Work")
        expect(html).toContain("Example Composer")
    })

    it("renders a tile per related work, with the work name and composer subtitle, at build", () => {
        const config = buildConfig(theme, "build", {
            relatedEntries: [
                { id: 1, name: "Sonata No. 1", href: "/entity/work/1", composer: "J.S. Bach" },
                { id: 2, name: "Sonata No. 2", href: "/entity/work/2", composer: "J.S. Bach" }
            ]
        })
        const html = render(config, "RelatedEntries", { heading: "Related Works", limit: 6 })
        expect(html).toContain("<h2")
        expect(html).toContain("Related Works")
        expect(html).toContain('<a class="cmp-related__tile" href="/entity/work/1">')
        expect(html).toContain("Sonata No. 1")
        expect(html).toContain("J.S. Bach")
        expect(html).toContain("Sonata No. 2")
    })

    it("caps the tiles rendered at the authored limit", () => {
        const config = buildConfig(theme, "build", {
            relatedEntries: [
                { id: 1, name: "Work A", href: "/entity/work/1", composer: "" },
                { id: 2, name: "Work B", href: "/entity/work/2", composer: "" },
                { id: 3, name: "Work C", href: "/entity/work/3", composer: "" }
            ]
        })
        const html = render(config, "RelatedEntries", { heading: "", limit: 2 })
        expect(html).toContain("Work A")
        expect(html).toContain("Work B")
        expect(html).not.toContain("Work C")
    })

    it("renders a work with no resolved page as plain text, not a link", () => {
        const config = buildConfig(theme, "build", {
            relatedEntries: [{ id: 1, name: "Unlinked Work", href: null, composer: "" }]
        })
        const html = render(config, "RelatedEntries", { heading: "", limit: 6 })
        expect(html).toContain('<span class="cmp-related__tile">')
        expect(html).not.toContain('href="null"')
    })

    it("omits the heading element when heading is blank", () => {
        const config = buildConfig(theme, "build", {
            relatedEntries: [{ id: 1, name: "A Work", href: "/entity/work/1", composer: "" }]
        })
        const html = render(config, "RelatedEntries", { heading: "", limit: 6 })
        expect(html).not.toContain("<h2")
    })

    it("renders nothing when the routed record has no related works", () => {
        const config = buildConfig(theme, "build", { relatedEntries: [] })
        const html = render(config, "RelatedEntries", { heading: "Related Works", limit: 6 })
        expect(html).toBe("")
    })

    it("renders nothing at build with no route context at all (e.g. a pages/posts template)", () => {
        const config = buildConfig(theme, "build")
        const html = render(config, "RelatedEntries", { heading: "Related Works", limit: 6 })
        expect(html).toBe("")
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
        entityCover: "https://images.example.test/composer.jpg",
        // A D1 entity's `image` column pointing at a bundled (src/files) asset.
        bundledCover: "/files/composer-portrait.webp"
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

    it("ContentImage resolves a bundled image's alt text from the build-time sidecar index", () => {
        const bundledFileAlt = { "composer-portrait.webp": "Portrait of the composer" }
        const config = buildConfig(theme, "build", { entry, mediaBaseUrl: MEDIA_ORIGIN, bundledFileAlt })
        const html = render(config, "ContentImage", { field: "bundledCover", aspect: "original" })
        expect(html).toContain('src="/files/composer-portrait.webp"')
        expect(html).toContain('alt="Portrait of the composer"')
    })

    it("ContentImage renders empty alt for a bundled image absent from the sidecar index", () => {
        const config = buildConfig(theme, "build", { entry, mediaBaseUrl: MEDIA_ORIGIN, bundledFileAlt: {} })
        const html = render(config, "ContentImage", { field: "bundledCover", aspect: "original" })
        expect(html).toContain('alt=""')
    })

    it("Heading and ContentText produce identical markup for the same inputs (twin contract)", () => {
        const config = buildConfig(theme, "build", { entry })
        const viaHeading = render(config, "Heading", { text: "From the entry", level: "h2", typography: "display", align: "start" })
        const viaOutlet = render(config, "ContentText", { field: "headline", level: "h2", typography: "display", align: "start" })
        expect(viaOutlet).toBe(viaHeading)
    })

    it("Image/ContentImage carry the size preset as a data-size attribute", () => {
        const config = buildConfig(theme, "build", { entry, mediaBaseUrl: MEDIA_ORIGIN })
        const viaImage = render(config, "Image", {
            media: { mediaId: "med_1", storageKey: "med_1.jpg", alt: "", width: 0, height: 0 },
            alt: "A violin",
            aspect: "original",
            size: "large"
        })
        expect(viaImage).toContain('data-size="large"')

        const viaContentImage = render(config, "ContentImage", { field: "cover", aspect: "original", size: "small" })
        expect(viaContentImage).toContain('data-size="small"')
    })

    it("Image/ContentImage/MediaText emit a sizes attribute matching the size preset's CSS max-width cap", () => {
        const config = buildConfig(theme, "build", { entry, mediaBaseUrl: MEDIA_ORIGIN })
        const cases: Array<["small" | "medium" | "large" | "full", string]> = [
            ["small", "192px"],
            ["medium", "384px"],
            ["large", "640px"],
            ["full", "100vw"]
        ]
        for (const [size, hint] of cases) {
            const html = render(config, "Image", {
                media: { mediaId: "med_1", storageKey: "med_1.jpg", alt: "", width: 0, height: 0 },
                alt: "A violin",
                aspect: "original",
                size
            })
            expect(html).toContain(`sizes="${hint}"`)
        }
    })
})

describe("buildConfig — ContentField (unified field-outlet rewrite)", () => {
    const fields: CollectionField[] = [
        { slug: "name", label: "Name", type: "string" },
        { slug: "bio", label: "Bio", type: "text" },
        { slug: "birth_year", label: "Birth Year", type: "number" },
        { slug: "entry_date", label: "Added", type: "date" },
        { slug: "composer", label: "Composer", type: "reference" },
        { slug: "contrib_addl", label: "Additional Contributors", type: "referenceList" },
        { slug: "author_secondary", label: "Secondary Authors", type: "referenceListWithRole" },
        { slug: "tags", label: "Tags", type: "list" },
        { slug: "publication_uri", label: "Publication Link", type: "uri" },
        { slug: "death_year", label: "Death Year", type: "yearOrLiving" },
        { slug: "country", label: "Country", type: "countryCode" },
        { slug: "citations", label: "Citations", type: "citations" }
    ]

    // Shapes exactly as entity-records.ts's normalizer produces them (references pre-resolved, no
    // separate names structure) — the reference-fold linchpin this outlet is built to consume directly.
    const entry: Record<string, unknown> = {
        name: "Ada",
        bio: "",
        birth_year: 1990,
        entry_date: 1768435200000, // 2026-01-15T00:00:00Z
        composer: { id: 5, name: "Jane Composer", href: "/entity/composer/5" },
        contrib_addl: [
            { id: 10, name: "Primary Editor", href: "/entity/contributor/10" },
            { id: 11, name: "", href: null } // unresolvable — renders as an empty entry, per ReferenceLink
        ],
        author_secondary: [
            // role stored mixed-case, to prove the render lower-cases it rather than passing it through.
            { id: 20, name: "Fanny Author", href: "/entity/composer/20", role: "Arranger" },
            { id: 21, name: "No Role Author", href: "/entity/composer/21" } // role omitted — no parenthetical
        ],
        tags: ["romantic", "advanced"],
        publication_uri: { uriType: "https", uri: "https://example.test/score" },
        death_year: -1,
        country: "DE",
        citations: { IMSLP: "https://imslp.org/wiki/Category:Bach,_Johann_Sebastian" }
    }
    const base = {
        label: "",
        showLabel: "yes" as const,
        typography: "display",
        onEmpty: "doNothing" as const,
        emptyValue: "(none)"
    }

    it("uses the bound field's catalog label by default", () => {
        const config = buildConfig(theme, "build", { entry, fields })
        const html = render(config, "ContentField", { ...base, field: "name" })
        expect(html).toContain("Name")
        expect(html).toContain("Ada")
    })

    it("an explicit label override wins over the catalog label", () => {
        const config = buildConfig(theme, "build", { entry, fields })
        const html = render(config, "ContentField", { ...base, field: "name", label: "Full Name" })
        expect(html).toContain("Full Name")
        expect(html).not.toContain(">Name<")
    })

    it("hides the label when showLabel is no", () => {
        const config = buildConfig(theme, "build", { entry, fields })
        const html = render(config, "ContentField", { ...base, field: "name", showLabel: "no" })
        expect(html).not.toContain("cmp-field__label")
        expect(html).toContain("Ada")
    })

    it("renders a number field", () => {
        const config = buildConfig(theme, "build", { entry, fields })
        expect(render(config, "ContentField", { ...base, field: "birth_year" })).toContain("1990")
    })

    it("formats a date field with a fixed, deterministic format", () => {
        const config = buildConfig(theme, "build", { entry, fields })
        expect(render(config, "ContentField", { ...base, field: "entry_date" })).toContain("January 15, 2026")
    })

    it("links a resolved reference to its public page", () => {
        const config = buildConfig(theme, "build", { entry, fields })
        const html = render(config, "ContentField", { ...base, field: "composer" })
        expect(html).toContain('href="/entity/composer/5"')
        expect(html).toContain("Jane Composer")
    })

    it("renders a referenceList, linking a resolved item and rendering an unresolved one as empty", () => {
        const config = buildConfig(theme, "build", { entry, fields })
        const html = render(config, "ContentField", { ...base, field: "contrib_addl" })
        expect(html).toContain('href="/entity/contributor/10"')
        expect(html).toContain("Primary Editor")
    })

    it("renders a referenceListWithRole, appending the lower-cased role in parentheses when present", () => {
        const config = buildConfig(theme, "build", { entry, fields })
        const html = render(config, "ContentField", { ...base, field: "author_secondary" })
        expect(html).toContain('href="/entity/composer/20"')
        expect(html).toContain("Fanny Author")
        expect(html).toContain("(arranger)")
        expect(html).toContain("No Role Author")
    })

    it("joins a list field with commas", () => {
        const config = buildConfig(theme, "build", { entry, fields })
        expect(render(config, "ContentField", { ...base, field: "tags" })).toContain("romantic, advanced")
    })

    it("renders the publication-uri composite as an https link via the shared renderPublicationUri", () => {
        const config = buildConfig(theme, "build", { entry, fields })
        const html = render(config, "ContentField", { ...base, field: "publication_uri" })
        expect(html).toContain('href="https://example.test/score"')
    })

    it("renders a citations map as a hyperlink with the source name as display text", () => {
        const config = buildConfig(theme, "build", { entry, fields })
        const html = render(config, "ContentField", { ...base, field: "citations" })
        expect(html).toContain('href="https://imslp.org/wiki/Category:Bach,_Johann_Sebastian"')
        expect(html).toContain(">IMSLP<")
    })

    it("owner decision: an empty/null value renders an EMPTY value (row still present), never a placeholder string", () => {
        const config = buildConfig(theme, "build", { entry, fields })
        const html = render(config, "ContentField", { ...base, field: "bio" })
        expect(html).toContain("cmp-field__value")
        expect(html).toContain("Bio") // the label still renders — only the value is empty
        expect(html).not.toMatch(/not supplied|\(no /)
    })

    it("converts a living composer's death_year (-1) to Present", () => {
        const config = buildConfig(theme, "build", { entry, fields })
        expect(render(config, "ContentField", { ...base, field: "death_year" })).toContain("Present")
    })

    it("renders a non-living death_year as the year itself", () => {
        const config = buildConfig(theme, "build", { entry: { ...entry, death_year: 1750 }, fields })
        expect(render(config, "ContentField", { ...base, field: "death_year" })).toContain("1750")
    })

    it("converts a country code to its display name", () => {
        const config = buildConfig(theme, "build", { entry, fields })
        const html = render(config, "ContentField", { ...base, field: "country" })
        expect(html).toContain("Germany")
        expect(html).not.toContain(">DE<")
    })

    describe("onEmpty (empty-value display control)", () => {
        it("doNothing (default): label still shows, value is blank", () => {
            const config = buildConfig(theme, "build", { entry, fields })
            const html = render(config, "ContentField", { ...base, field: "bio", onEmpty: "doNothing" })
            expect(html).toContain("cmp-field__label")
            expect(html).toContain("Bio")
        })

        it("placeholder: substitutes emptyValue for the blank value, label still shows", () => {
            const config = buildConfig(theme, "build", { entry, fields })
            const html = render(config, "ContentField", {
                ...base,
                field: "bio",
                onEmpty: "placeholder",
                emptyValue: "(none)"
            })
            expect(html).toContain("cmp-field__label")
            expect(html).toContain("(none)")
        })

        it("hideLabel: label is suppressed, value stays blank", () => {
            const config = buildConfig(theme, "build", { entry, fields })
            const html = render(config, "ContentField", { ...base, field: "bio", onEmpty: "hideLabel" })
            expect(html).not.toContain("cmp-field__label")
            expect(html).toContain("cmp-field__value")
        })

        it("does not apply the empty-value behavior when the field is NOT empty", () => {
            const config = buildConfig(theme, "build", { entry, fields })
            const html = render(config, "ContentField", { ...base, field: "name", onEmpty: "hideLabel" })
            expect(html).toContain("cmp-field__label")
            expect(html).toContain("Ada")
        })
    })

    it("renders a placeholder in the editor, and nothing at build, when no field is bound", () => {
        expect(render(buildConfig(theme, "editor", { entry, fields }), "ContentField", { ...base, field: "" })).toContain(
            "cmp-outlet-placeholder"
        )
        expect(render(buildConfig(theme, "build", { entry, fields }), "ContentField", { ...base, field: "" })).toBe("")
    })

    it("falls back to shape-based inference when no catalog fields are supplied (e.g. pages/posts)", () => {
        const config = buildConfig(theme, "build", { entry: { plain: "hello" } })
        const html = render(config, "ContentField", { ...base, field: "plain", label: "My Label" })
        expect(html).toContain("hello")
        expect(html).toContain("My Label")
    })

    describe("valuePlacement", () => {
        // The editor control itself is pinned, not just the render: an earlier pass shipped the prop,
        // the defaultProps entry and the render branch WITHOUT this `fields` entry, leaving a placement
        // no author could ever select. Asserting the render alone would not have caught that.
        it("exposes a Value placement select in the editor, offering inline/auto/below", () => {
            const config = buildConfig(theme, "editor", { entry, fields })
            const placement = field(config, "ContentField", "valuePlacement")
            expect(placement.type).toBe("select")
            expect(placement.label).toBe("Value placement")
            expect(placement.options.map((option: { value: string }) => option.value)).toEqual(["inline", "auto", "below"])
        })

        it("stays inline by default, so designs stored before the prop existed are unaffected", () => {
            const config = buildConfig(theme, "build", { entry, fields })
            // `base` deliberately omits valuePlacement — the shape of an older stored design.
            const html = render(config, "ContentField", { ...base, field: "bio" })
            expect(html).toContain('class="cmp-field"')
        })

        it('renders no modifier for "inline"', () => {
            const config = buildConfig(theme, "build", { entry, fields })
            const html = render(config, "ContentField", { ...base, field: "bio", valuePlacement: "inline" })
            expect(html).toContain('class="cmp-field"')
        })

        it('renders the always-stacked modifier for "below"', () => {
            const config = buildConfig(theme, "build", { entry, fields })
            const html = render(config, "ContentField", { ...base, field: "bio", valuePlacement: "below" })
            expect(html).toContain('class="cmp-field cmp-field--below"')
        })

        it('renders the container-query modifier for "auto"', () => {
            const config = buildConfig(theme, "build", { entry, fields })
            const html = render(config, "ContentField", { ...base, field: "bio", valuePlacement: "auto" })
            expect(html).toContain('class="cmp-field cmp-field--auto"')
        })

        it("falls back to inline for a stale stored value rather than emitting a dangling class", () => {
            const config = buildConfig(theme, "build", { entry, fields })
            const html = render(config, "ContentField", { ...base, field: "bio", valuePlacement: "sideways" })
            expect(html).toContain('class="cmp-field"')
            expect(html).not.toContain("cmp-field--")
        })

    })
})

describe("buildConfig — MediaText (collapsing media+text primitive, concern #3)", () => {
    const fields: CollectionField[] = [{ slug: "portrait", label: "Portrait", type: "image" }]
    const props = { aspect: "original" as const, imagePosition: "start" as const, content: () => null }

    it("renders the media side when the bound field resolves to a usable source", () => {
        const config = buildConfig(theme, "build", {
            entry: { portrait: "https://images.example.test/ada.jpg" },
            fields,
            mediaBaseUrl: "https://store.example.test"
        })
        const html = render(config, "MediaText", { ...props, field: "portrait" })
        expect(html).toContain("cmp-media-text__media")
        expect(html).toContain('src="https://images.example.test/ada.jpg"')
    })

    it("collapses to content-only — no dead column — when the field has no usable image", () => {
        const config = buildConfig(theme, "build", { entry: { portrait: null }, fields })
        const html = render(config, "MediaText", { ...props, field: "portrait" })
        expect(html).not.toContain("cmp-media-text__media")
        expect(html).toContain("cmp-media-text__content")
    })

    it("carries the size preset as data-size on the media column", () => {
        const config = buildConfig(theme, "build", {
            entry: { portrait: "https://images.example.test/ada.jpg" },
            fields,
            mediaBaseUrl: "https://store.example.test"
        })
        const html = render(config, "MediaText", { ...props, field: "portrait", size: "large" })
        expect(html).toContain('data-size="large"')
    })
})

describe("buildConfig — Row (explicit horizontal container, flow invariant)", () => {
    it("styles the slot's own wrapper as the flex row carrying independent column/row gap tokens", () => {
        // Mirrors Puck's real SlotRender contract: the slot component renders the className/style it's
        // given on the element it wraps its items in — there is no separate outer div for Row to style
        // instead, so this stub must apply the props the way Puck does for the assertion to mean anything.
        const Content = ({ className, style }: { className?: string; style?: CSSProperties }) =>
            createElement("div", { className, style })
        const config = buildConfig(theme, "build")
        const html = render(config, "Row", { columnGap: "md", rowGap: "sm", content: Content })
        expect(html).toContain("cmp-row")
        expect(html).toContain("--cmp-row-column-gap:var(--dtk-space-md)")
        expect(html).toContain("--cmp-row-row-gap:var(--dtk-space-sm)")
    })
})

describe("buildConfig — root wraps every render in .cmp-root (flow invariant's top-level anchor)", () => {
    it("wraps children in .cmp-root regardless of target", () => {
        for (const target of ["build", "editor"] as const) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const config = buildConfig(theme, target) as any
            const html = renderToStaticMarkup(config.root.render({ children: "hello" }))
            expect(html).toContain('class="cmp-root"')
            expect(html).toContain("hello")
        }
    })
})
