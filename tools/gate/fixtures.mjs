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
 * content out of the repo. The FIELD SCHEMAS, however, mirror the live ones (verified against
 * /_emdash/api/schema/collections/{pages,posts}/fields — `pages` on 2026-07-12, `posts` on 2026-07-14).
 * That fidelity is the point — the outlet↔field type gate (OUTLET_PROPS in catalog.tsx) is only
 * meaningful if the type strings here are the ones EmDash really emits.
 *
 * Every variant also serves ONE published post, routed at `/posts/first-post` (Phase C). It carries a
 * `featured_image`, the only `image` field either routed collection defines — so the templated variants
 * are the first and only place a ContentImage outlet, and therefore a media URL, reaches a real
 * `astro build`. Its value is served in EmDash's real wire shape (no `src`; the key at `meta.storageKey`),
 * because a fixture that invents a bare-id image is precisely what let the media bug ship.
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

/** The image field the posts template's ContentImage outlet binds. */
export const BOUND_IMAGE_FIELD = "featured_image"

/** Strings the templated POST must render through its outlets. */
export const POST_TITLE = "First Post"
export const POST_BODY_TEXT = "Post body pulled through the rich-text outlet."
export const POST_IMAGE_ALT = "A violin on a table"

/** The routed path of the templated post (Phase C: posts take the `/posts/` prefix, pivot §7.2). */
export const TEMPLATED_POST_SLUG = "posts/first-post"

/**
 * The media origin the gate builds against. Deliberately NOT the real one: the assertion is that the
 * emitted `<img>` points at whatever `EMDASH_MEDIA_PUBLIC_URL` names, so a fixed fake proves the build
 * read the variable rather than coincidentally matching prod.
 */
export const MEDIA_BASE = "https://media.gate.test"

/**
 * The storage key of the post's `featured_image`. It lives at `meta.storageKey` with **no `src`** —
 * EmDash strips `src` when persisting local (R2) media, and the media `id` is NOT a usable handle (the
 * file route 404s on it). This is the wire shape that made the hand-rolled `/_emdash/api/media/file/{id}`
 * URL wrong twice over; a fixture inventing a bare-id value is what let three tests assert the bug.
 */
export const MEDIA_STORAGE_KEY = "01KWYQ8FZ3N4P5R6S7T8V9W0XY.jpg"

const paths = {
    settings: "/_emdash/api/settings",
    menu: "/_emdash/api/menus/primary",
    footerMenu: "/_emdash/api/menus/footer",
    pages: "/_emdash/api/content/pages?status=published&limit=100",
    posts: "/_emdash/api/content/posts?status=published&limit=100",
    designPages: "/_emdash/api/content/design_page?status=published&limit=100",
    theme: "/_emdash/api/content/design_theme?status=published&limit=1",
    templates: "/_emdash/api/content/design_template?status=published&limit=100",
    pageFields: "/_emdash/api/schema/collections/pages/fields",
    postFields: "/_emdash/api/schema/collections/posts/fields"
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

/**
 * Mirrors the live `posts` schema (probed on prod 2026-07-14), plus the same `design` reference. Note
 * `featured_image` — the ONE `image` field either routed collection defines, and therefore the only field
 * a `ContentImage` outlet can bind anywhere on the site. That is why media reaches a real `astro build`
 * for the first time in Phase C, and why the media assertion lives on the post.
 */
const POST_FIELDS = [
    { slug: "title", label: "Title", type: "string", required: true },
    { slug: "featured_image", label: "Featured Image", type: "image", required: false },
    { slug: "content", label: "Content", type: "portableText", required: false },
    { slug: "excerpt", label: "Excerpt", type: "text", required: false },
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
        // A NUMBER, not a boolean — what EmDash actually serves. Boolean fields are INTEGER columns whose
        // 1/0 is never deserialized back (see cmsBoolean in lib/compositor/types.ts). `fixture()` overrides
        // this per variant; hand-authoring a JS boolean here is what let the `=== true` bug pass the gate.
        is_default: 0,
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
 * The posts template. Same three outlets as the article template plus a **ContentImage** bound to
 * `featured_image` — the only binding in the whole gate that renders a media URL, and the reason this
 * template exists. Its heading sequence (one h1 from the template, no heading in the post's body) is
 * deliberately legal, so a media failure cannot be mistaken for a heading-order finding.
 */
const POST_TEMPLATE_ITEM = {
    id: "tpl-post",
    slug: "post",
    status: "published",
    data: {
        title: "Post",
        collection: "posts",
        is_default: 0,
        design: {
            schemaVersion: 1,
            puck: {
                root: { props: {} },
                content: [
                    {
                        type: "Section",
                        props: {
                            id: "ps-1",
                            background: "",
                            paddingY: "md",
                            content: [
                                {
                                    type: "ContentText",
                                    props: {
                                        id: "pc-1",
                                        field: "title",
                                        level: "h1",
                                        typography: "display",
                                        align: "start"
                                    }
                                },
                                {
                                    type: "ContentImage",
                                    props: { id: "pc-2", field: BOUND_IMAGE_FIELD, aspect: "original" }
                                },
                                { type: "ContentRichText", props: { id: "pc-3", field: BOUND_RICHTEXT_FIELD } }
                            ]
                        }
                    }
                ]
            }
        }
    }
}

/**
 * The one published post. Its `featured_image` carries the storage key at `meta.storageKey` and no `src`,
 * exactly as EmDash serves local media — see MEDIA_STORAGE_KEY.
 */
function postItems({ pointer }) {
    return [
        {
            id: "pst-first",
            slug: "first-post",
            status: "published",
            data: {
                title: POST_TITLE,
                excerpt: "A short blurb.",
                content: [block("p1", "normal", POST_BODY_TEXT)],
                featured_image: {
                    id: "med-1",
                    alt: POST_IMAGE_ALT,
                    width: 1200,
                    height: 800,
                    meta: { storageKey: MEDIA_STORAGE_KEY }
                },
                ...(pointer ? { design: POST_TEMPLATE_ITEM.id } : {})
            }
        }
    ]
}

/**
 * The published pages. Only `content-test` ever carries a `design` pointer; `home` and `privacy-policy`
 * are the D3 control group whose output must not move when a template exists (an EmDash reference is
 * stored as the target item's bare id — see normalizeReference in emdash-api.ts).
 */
function pageItems({ pointer }) {
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
                ...(pointer ? { design: TEMPLATE_ITEM.id } : {})
            }
        }
    ]
}

/**
 * @param {object} options
 * @param {boolean} options.templated - publish the template
 * @param {boolean} [options.breakSchema] - drop the bound rich-text field from the served `pages` schema,
 *   the "renamed the field away" break the dangling-outlet-field rule exists to catch
 * @param {boolean} [options.byDefault] - reach the template through D4 rule 2 (it is the collection's
 *   `is_default`) instead of rule 1: NO page carries a `design` pointer, so every `pages` entry — not just
 *   `content-test` — legitimately renders through it. Serves `is_default` as EmDash does, the number 1.
 */
function fixture({ templated, breakSchema = false, byDefault = false }) {
    const fields = breakSchema ? PAGE_FIELDS.filter((field) => field.slug !== BOUND_RICHTEXT_FIELD) : PAGE_FIELDS
    const template = { ...TEMPLATE_ITEM, data: { ...TEMPLATE_ITEM.data, is_default: byDefault ? 1 : 0 } }
    // The post reaches its template by POINTER only. Leaving the posts template non-default keeps the
    // `defaulted` variant a clean single-variable test of the pages default (D4 rule 2).
    const pointed = templated && !byDefault

    return {
        [paths.settings]: ok({ title: "Diversifying the Violin Curriculum for Private Teaching", tagline: "Test" }),
        // Real EmDash wire shape (verified against prod): raw rows, not a resolved `url`. A "custom" item
        // carries its href in `customUrl`; fetchMenu reads exactly this shape.
        [paths.menu]: ok({
            items: [
                { label: "Home", type: "custom", customUrl: "/" },
                { label: "Privacy", type: "custom", customUrl: "/privacy-policy" }
            ]
        }),
        [paths.footerMenu]: ok({ items: [] }),
        [paths.pages]: ok({ items: pageItems({ pointer: pointed }) }),
        [paths.posts]: ok({ items: postItems({ pointer: pointed }) }),
        [paths.designPages]: ok({ items: [] }),
        [paths.theme]: ok({ items: [{ id: "thm-1", slug: "default", status: "published", data: { tokens: THEME_TOKENS } }] }),
        // Absent until the setup script runs — the state `allowMissing` exists for, and prod's state today.
        [paths.templates]: templated
            ? ok({ items: [template, POST_TEMPLATE_ITEM] })
            : missing("Collection not found: design_template"),
        [paths.pageFields]: ok({ items: fields }),
        [paths.postFields]: ok({ items: POST_FIELDS })
    }
}

export const FIXTURES = {
    baseline: fixture({ templated: false }),
    templated: fixture({ templated: true }),
    defaulted: fixture({ templated: true, byDefault: true }),
    broken: fixture({ templated: true, breakSchema: true })
}
