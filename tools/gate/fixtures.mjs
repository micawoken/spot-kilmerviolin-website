/**
 * tools/gate/fixtures.mjs
 *
 * The frozen CMS content the Phase B gate builds against, as three variants that differ in exactly one
 * dimension each. Derived from one shared body of content rather than three hand-copied files, so a
 * variant cannot silently drift away from the others and quietly weaken the comparison.
 *
 *   baseline   design_template 404s and no entry names a template — today's prod state exactly.
 *   templated  one published template, bound to the ONE entry "content-test".
 *   broken     the same, but the served `pages` schema no longer has the field the template's rich-text
 *              outlet binds — i.e. "someone renamed the field away" (pivot Phase B gate 5).
 *
 * The content is synthetic, not recorded from prod: it keeps the gate deterministic and keeps prod's
 * content out of the repo. The `pages` FIELD SCHEMA, however, mirrors the live one (verified against
 * /_emdash/api/schema/collections/pages/fields on 2026-07-12: title/string, content/portableText,
 * description/string, plus the `design` reference the setup script adds). That fidelity is the point —
 * the outlet↔field type gate (OUTLET_PROPS in catalog.tsx) is only meaningful if the type strings here
 * are the ones EmDash really emits.
 *
 * `pages` has no `image` field, so no ContentImage outlet appears here; binding one would mean inventing
 * a schema field prod does not have, and the fixture would then be asserting against a fiction.
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

/** The entry the template is attached to; the only page whose output may legitimately change. */
export const TEMPLATED_SLUG = "content-test"

/** The template's identifier slug — the build's pairing-lint error must name it. */
export const TEMPLATE_SLUG = "article"

/** Strings the templated page must render THROUGH THE OUTLETS (not from the untemplated path). */
export const TEMPLATED_TITLE = "Content Test"
export const TEMPLATED_BODY_TEXT = "Body copy pulled through the rich-text outlet."

/** The rich-text field the template binds — and the one the "broken" variant removes from the schema. */
export const BOUND_RICHTEXT_FIELD = "content"

const paths = {
    settings: "/_emdash/api/settings",
    menu: "/_emdash/api/menus/primary",
    pages: "/_emdash/api/content/pages?status=published&limit=100",
    designPages: "/_emdash/api/content/design_page?status=published&limit=100",
    theme: "/_emdash/api/content/design_theme?status=published&limit=1",
    templates: "/_emdash/api/content/design_template?status=published&limit=100",
    pageFields: "/_emdash/api/schema/collections/pages/fields"
}

/** EmDash wraps every success in `{ data: … }` (emdashGet unwraps it). */
const ok = (data) => ({ status: 200, body: JSON.stringify({ data }) })
const missing = (message) => ({ status: 404, body: JSON.stringify({ error: { code: "NOT_FOUND", message } }) })

const block = (key, style, text, marks = []) => ({
    _type: "block",
    _key: key,
    style,
    markDefs: [],
    children: [{ _type: "span", _key: `${key}s`, text, marks }]
})

/** Mirrors the live `pages` schema; `design` is the reference field setup-design-collections.mjs adds. */
const PAGE_FIELDS = [
    { slug: "title", label: "Title", type: "string", required: true },
    { slug: "content", label: "Content", type: "portableText", required: false },
    { slug: "description", label: "Description", type: "string", required: true },
    { slug: "design", label: "Design", type: "reference", required: false }
]

/** The seed catalog from tools/setup-design-collections.mjs — a published theme, so --dtk-* is emitted. */
const THEME_TOKENS = {
    schemaVersion: 1,
    colors: [
        { name: "page-bg", value: "light-dark(#ffffff, #1a1a1a)" },
        { name: "text", value: "light-dark(#222222, #e6e6e6)" },
        { name: "accent", value: "light-dark(#2337ff, #ff9e5e)" }
    ],
    typography: [
        { name: "body", family: "system-ui, sans-serif", size: "1rem", weight: "400", lineHeight: "1.5" },
        {
            name: "display",
            family: "system-ui, sans-serif",
            size: "2.5rem",
            weight: "700",
            lineHeight: "1.2",
            letterSpacing: "-0.02em"
        }
    ],
    space: [
        { name: "xs", value: "0.5rem" },
        { name: "sm", value: "1rem" },
        { name: "md", value: "2rem" },
        { name: "lg", value: "4rem" }
    ],
    radius: [{ name: "md", value: "0.5rem" }],
    shadows: [{ name: "md", value: "0 1px 3px rgba(0, 0, 0, 0.12)" }],
    borders: [{ name: "default", width: "1px", style: "solid", colorRef: "text" }],
    breakpoints: [
        { name: "sm", minWidth: "640px" },
        { name: "md", minWidth: "768px" },
        { name: "lg", minWidth: "1024px" }
    ]
}

/**
 * The template: an H1 text outlet bound to `title`, then a rich-text outlet bound to `content`. The
 * heading order (template h1, then the entry's h2 inside the body) is deliberately legal — the gate is
 * meant to fail on the BROKEN pairing, not on an unrelated heading-order finding.
 */
const TEMPLATE_ITEM = {
    id: "tpl-article",
    slug: TEMPLATE_SLUG,
    status: "published",
    data: {
        title: "Article",
        collection: "pages",
        is_default: false,
        design: {
            schemaVersion: 1,
            puck: {
                root: { props: {} },
                content: [
                    {
                        type: "Section",
                        props: {
                            id: "s-1",
                            background: "",
                            paddingY: "md",
                            content: [
                                {
                                    type: "ContentText",
                                    props: {
                                        id: "c-1",
                                        field: "title",
                                        level: "h1",
                                        typography: "display",
                                        align: "start"
                                    }
                                },
                                { type: "ContentRichText", props: { id: "c-2", field: BOUND_RICHTEXT_FIELD } }
                            ]
                        }
                    }
                ]
            }
        }
    }
}

/**
 * The published pages. Only `content-test` ever carries a `design` pointer; `home` and `privacy-policy`
 * are the D3 control group whose output must not move when a template exists (an EmDash reference is
 * stored as the target item's bare id — see normalizeReference in emdash-api.ts).
 */
function pageItems({ templated }) {
    return [
        {
            id: "pg-home",
            slug: "home",
            status: "published",
            data: {
                title: "Home",
                description: "The home page",
                content: [block("a1", "normal", "Test homepage.")]
            }
        },
        {
            id: "pg-privacy",
            slug: "privacy-policy",
            status: "published",
            data: {
                title: "Privacy Policy",
                description: "How data is handled",
                content: [block("b1", "normal", "This is a test privacy policy.")]
            }
        },
        {
            id: "pg-content-test",
            slug: TEMPLATED_SLUG,
            status: "published",
            data: {
                title: TEMPLATED_TITLE,
                description: "A test page",
                content: [block("c1", "h2", "A subheading"), block("c2", "normal", TEMPLATED_BODY_TEXT)],
                ...(templated ? { design: TEMPLATE_ITEM.id } : {})
            }
        }
    ]
}

/**
 * @param {object} options
 * @param {boolean} options.templated - publish the template and point `content-test` at it
 * @param {boolean} [options.breakSchema] - drop the bound rich-text field from the served `pages` schema,
 *   the "renamed the field away" break the dangling-outlet-field rule exists to catch
 */
function fixture({ templated, breakSchema = false }) {
    const fields = breakSchema ? PAGE_FIELDS.filter((field) => field.slug !== BOUND_RICHTEXT_FIELD) : PAGE_FIELDS

    return {
        [paths.settings]: ok({ title: "Diversifying the Violin Curriculum for Private Teaching", tagline: "Test" }),
        [paths.menu]: ok({
            items: [
                { label: "Home", url: "/" },
                { label: "Privacy", url: "/privacy-policy" }
            ]
        }),
        [paths.pages]: ok({ items: pageItems({ templated }) }),
        [paths.designPages]: ok({ items: [] }),
        [paths.theme]: ok({ items: [{ id: "thm-1", slug: "default", status: "published", data: { tokens: THEME_TOKENS } }] }),
        // Absent until the setup script runs — the state `allowMissing` exists for, and prod's state today.
        [paths.templates]: templated
            ? ok({ items: [TEMPLATE_ITEM] })
            : missing("Collection not found: design_template"),
        [paths.pageFields]: ok({ items: fields })
    }
}

export const FIXTURES = {
    baseline: fixture({ templated: false }),
    templated: fixture({ templated: true }),
    broken: fixture({ templated: true, breakSchema: true })
}
