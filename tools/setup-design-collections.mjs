/**
 * tools/setup-design-collections.mjs
 *
 * Idempotent setup of the visual compositor's EmDash collections (impl §4.1) and the seed
 * design_theme item (impl §4.3). Standalone one-off op — NEVER part of the build; safe to run
 * repeatedly.
 *
 * Creates, only when missing, three collections that support drafts + revisions:
 *   design_theme    — one json field `tokens` (required); seeded with a starter token catalog when
 *                     the collection is empty, as a draft to review + publish in the theme UI.
 *   design_page     — string `title` (required), text `description`, json `design` (required).
 *   design_template — string `title` (required), select `collection` (pages/posts, required),
 *                     boolean `is_default`, json `design` (required); the content-routing pivot's
 *                     layout-that-content-flows-through (pivot §3). Seeded with the published
 *                     "None (plain article)" sentinel item (reserved slug "none"), the explicit
 *                     opt-out from a collection's default template (pivot §7.4).
 *
 * Also adds the `design` reference field (→ design_template) to the EXISTING `pages` and `posts`
 * collections — the per-entry template pointer (pivot D4). Neither is created here (`pages` is
 * authored in the EmDash admin; `posts` is an EmDash seed collection), so the absence of either is a
 * warning, never a create.
 *
 * Existing collections and fields are never deleted or mutated: a live field whose type/required
 * diverges from the spec prints a warning and is left untouched (so a hand-edited schema is
 * surfaced, not silently "fixed").
 *
 * Auth mirrors src/lib/build/emdash-api.ts. Against a deployed worker (owner runs this — note the
 * prod service token is read-only, so schema writes need a credential carrying schema:manage):
 *   node --env-file=.env tools/setup-design-collections.mjs
 * Against a local dev server, using the DEV-only auth bypass:
 *   node tools/setup-design-collections.mjs --base http://localhost:4321 --dev-bypass
 *
 * Prints one line per step and exits non-zero on the first unexpected API response.
 */

const args = process.argv.slice(2)

function arg(name) {
    const i = args.indexOf(name)
    return i === -1 ? undefined : (args[i + 1] ?? true)
}

const base = (arg("--base") ?? process.env.CONTENT_API_BASE)?.replace(/\/+$/, "")
if (!base) {
    console.error("No --base flag and no CONTENT_API_BASE in env — nothing to target.")
    process.exit(1)
}
const useDevBypass = args.includes("--dev-bypass")

const headers = { "Content-Type": "application/json", "X-EmDash-Request": "1" }
if (!useDevBypass) {
    if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
        headers["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID
        headers["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET
    }
    if (process.env.EMDASH_API_TOKEN) headers["Authorization"] = `Bearer ${process.env.EMDASH_API_TOKEN}`
}

// The dev-bypass session cookie (local only); carried on subsequent requests once established.
let cookie = ""

/**
 * Calls an EmDash API path and returns { status, json }. On an unexpected non-2xx response (when
 * expectOk) it logs the error envelope and exits non-zero — this script must never continue past a
 * failed schema write.
 */
async function api(method, path, body, expectOk = true) {
    const response = await fetch(`${base}${path}`, {
        method,
        headers: cookie ? { ...headers, Cookie: cookie } : headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    })
    const setCookie = response.headers.getSetCookie?.() ?? []
    if (setCookie.length > 0) cookie = setCookie.map((c) => c.split(";")[0]).join("; ")
    let json = null
    try {
        json = await response.json()
    } catch {
        /* non-JSON body (e.g. a Cloudflare Access HTML challenge) */
    }
    if (expectOk && !response.ok) {
        const detail = JSON.stringify(json?.error ?? json)?.slice(0, 400)
        console.error(`FAIL ${method} ${path} → ${response.status} ${response.statusText}  ${detail}`)
        process.exit(1)
    }
    return { status: response.status, json }
}

const ok = (msg) => console.log(`OK   ${msg}`)
const warn = (msg) => console.warn(`WARN ${msg}`)

/**
 * Desired collections and fields (impl §4.1). `create` is the collection-create body; `fields` are
 * ordered field-create bodies. Kept declarative so the ensure logic below is a plain diff.
 */
const COLLECTIONS = [
    {
        slug: "design_theme",
        create: {
            slug: "design_theme",
            label: "Design Theme",
            labelSingular: "Design Theme",
            supports: ["drafts", "revisions"],
            hasSeo: false
        },
        fields: [{ slug: "tokens", label: "Tokens", type: "json", required: true }]
    },
    {
        slug: "design_page",
        create: {
            slug: "design_page",
            label: "Designed Pages",
            labelSingular: "Designed Page",
            supports: ["drafts", "revisions"],
            hasSeo: false
        },
        fields: [
            { slug: "title", label: "Title", type: "string", required: true },
            { slug: "description", label: "Description", type: "text", required: false },
            { slug: "design", label: "Design", type: "json", required: true }
        ]
    },
    {
        slug: "design_template",
        create: {
            slug: "design_template",
            label: "Design Templates",
            labelSingular: "Design Template",
            supports: ["drafts", "revisions"],
            hasSeo: false
        },
        fields: [
            { slug: "title", label: "Title", type: "string", required: true },
            // Which collection's entries this template renders; drives outlet field pickers and lint.
            // Select choices ride in `validation.options` (emdash FieldValidation.options).
            {
                slug: "collection",
                label: "Renders entries of",
                type: "select",
                required: true,
                validation: { options: ["pages", "posts"] }
            },
            // Field slugs must match /^[a-z][a-z0-9_]*$/ (emdash api/schemas/common.ts) — no camelCase.
            { slug: "is_default", label: "Default template for its collection", type: "boolean", required: false },
            { slug: "design", label: "Design", type: "json", required: true }
        ]
    }
]

/**
 * Reference fields added to collections that exist already (created in the EmDash admin, not here).
 * The entry-level template pointer (pivot D4): a `reference` stores the target item's id, and the
 * target collection rides in widget `options.collection` (emdash FieldWidgetOptions.collection).
 *
 * Both routed collections get the identical field — `posts` (pivot D8/Phase C) is not a special case,
 * which is the point: routing a collection through a template costs one reference field and nothing else.
 */
const DESIGN_REFERENCE_FIELD = {
    slug: "design",
    label: "Design",
    type: "reference",
    required: false,
    options: { collection: "design_template" }
}

const FIELD_ADDITIONS = [
    { collection: "pages", field: DESIGN_REFERENCE_FIELD },
    { collection: "posts", field: DESIGN_REFERENCE_FIELD }
]

/**
 * Seed token catalog for design_theme (impl §4.3). A minimal set derived from the site chrome
 * palette in src/styles/global.css — colors as light-dark() pairs so design pages track the site's
 * light/dark scheme. Written as a draft; the theme UI is where it gets reviewed and published.
 */
const SEED_THEME = {
    schemaVersion: 1,
    colors: [
        { name: "page-bg", value: "light-dark(#ffffff, #1a1a1a)" },
        { name: "text", value: "light-dark(#222222, #e6e6e6)" },
        { name: "accent", value: "light-dark(#2337ff, #ff9e5e)" }
    ],
    typography: [
        {
            name: "body",
            family: "system-ui, -apple-system, Helvetica, Arial, sans-serif",
            size: "1rem",
            weight: "400",
            lineHeight: "1.5"
        },
        {
            name: "display",
            family: "system-ui, -apple-system, Helvetica, Arial, sans-serif",
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

/** Creates a field via the schema API (impl §4.1 shapes). `validation`/`options` are sent only when specified. */
async function createField(collectionSlug, field) {
    const body = {
        slug: field.slug,
        label: field.label,
        type: field.type,
        required: Boolean(field.required)
    }
    if (field.validation) body.validation = field.validation
    if (field.options) body.options = field.options
    await api("POST", `/_emdash/api/schema/collections/${collectionSlug}/fields`, body)
    ok(`  field ${collectionSlug}.${field.slug} (${field.type}${field.required ? ", required" : ""}) created`)
}

/** Ensures one collection and its fields exist, creating only what is missing and warning on drift. */
async function ensureCollection(spec) {
    const list = await api("GET", "/_emdash/api/schema/collections")
    const existing = (list.json?.data?.items ?? []).find((c) => c.slug === spec.slug)

    if (!existing) {
        await api("POST", "/_emdash/api/schema/collections", spec.create)
        ok(`collection ${spec.slug} created`)
        for (const field of spec.fields) await createField(spec.slug, field)
        return
    }

    ok(`collection ${spec.slug} already exists`)
    const fieldList = await api("GET", `/_emdash/api/schema/collections/${spec.slug}/fields`)
    const liveFields = fieldList.json?.data?.items ?? []
    for (const field of spec.fields) {
        const live = liveFields.find((f) => f.slug === field.slug)
        if (!live) {
            await createField(spec.slug, field)
            continue
        }
        const wantRequired = Boolean(field.required)
        if (live.type !== field.type || Boolean(live.required) !== wantRequired) {
            warn(
                `  field ${spec.slug}.${field.slug} diverges from spec ` +
                    `(live type=${live.type} required=${Boolean(live.required)}; ` +
                    `spec type=${field.type} required=${wantRequired}) — left untouched`
            )
        } else {
            ok(`  field ${spec.slug}.${field.slug} matches spec`)
        }
    }
}

/**
 * Adds one field to a collection this script does not own. The collection missing entirely is a
 * warning, not a create — `pages` is authored in the EmDash admin, and creating a bare shell of it
 * here would mask a misconfigured target.
 */
async function ensureFieldAddition({ collection, field }) {
    const list = await api("GET", "/_emdash/api/schema/collections")
    const exists = (list.json?.data?.items ?? []).some((c) => c.slug === collection)
    if (!exists) {
        warn(`collection ${collection} does not exist — field ${collection}.${field.slug} NOT added`)
        return
    }
    const fieldList = await api("GET", `/_emdash/api/schema/collections/${collection}/fields`)
    const live = (fieldList.json?.data?.items ?? []).find((f) => f.slug === field.slug)
    if (!live) {
        await createField(collection, field)
        return
    }
    if (live.type !== field.type) {
        warn(`  field ${collection}.${field.slug} diverges from spec (live type=${live.type}; spec type=${field.type}) — left untouched`)
    } else {
        ok(`  field ${collection}.${field.slug} matches spec`)
    }
}

/**
 * Seeds the reserved "None (plain article)" sentinel template (pivot §3, §7.4) and publishes it —
 * resolution only reads published templates, and an unpublished opt-out would silently do nothing.
 * Its (required) `collection` value is irrelevant: the sentinel is exempt from the collection-
 * mismatch check and serves every routed collection.
 */
async function seedNoneSentinel() {
    const list = await api("GET", "/_emdash/api/content/design_template?limit=100")
    const existing = (list.json?.data?.items ?? []).find((item) => item.slug === "none")
    if (existing) {
        ok('design_template sentinel "none" already exists — seed skipped')
        return
    }
    const created = await api("POST", "/_emdash/api/content/design_template", {
        slug: "none",
        status: "draft",
        data: {
            title: "None (plain article)",
            collection: "pages",
            is_default: false,
            // The empty design envelope (migrations.ts emptyDesignDoc; kept in sync by hand — this
            // script is plain Node and cannot import the TS module).
            design: { schemaVersion: 1, puck: { root: {}, content: [] } }
        }
    })
    const id = created.json?.data?.item?.id
    if (!id) {
        console.error('FAIL the created "none" sentinel returned no id; cannot publish it')
        process.exit(1)
    }
    await api("POST", `/_emdash/api/content/design_template/${id}/publish`)
    ok('seeded and published design_template sentinel "none"')
}

/** Seeds the design_theme item (slug "default") as a draft, only when the collection has no items. */
async function seedTheme() {
    const list = await api("GET", "/_emdash/api/content/design_theme?limit=1")
    const count = list.json?.data?.items?.length ?? 0
    if (count > 0) {
        ok("design_theme already has an item — seed skipped")
        return
    }
    await api("POST", "/_emdash/api/content/design_theme", {
        slug: "default",
        status: "draft",
        data: { tokens: SEED_THEME }
    })
    ok('seeded design_theme draft item "default"')
    console.log("\nReminder: review and publish the seeded theme in the Design → Theme UI before designing pages.")
}

/**
 * EmDash rejects any collection or field slug outside this pattern (api/schemas/common.ts `slugPattern`).
 * Notably it forbids camelCase, and it rejects each field as the script POSTs it — so an illegal slug
 * authored below would otherwise be found only *after* earlier writes had already landed, leaving a
 * half-created collection on the server. Checked up front so the run is all-or-nothing.
 */
const SLUG_PATTERN = /^[a-z][a-z0-9_]*$/

function assertSlugsAreLegal() {
    const illegal = []
    for (const spec of COLLECTIONS) {
        if (!SLUG_PATTERN.test(spec.slug)) illegal.push(`collection "${spec.slug}"`)
        for (const field of spec.fields) {
            if (!SLUG_PATTERN.test(field.slug)) illegal.push(`field ${spec.slug}.${field.slug}`)
        }
    }
    for (const addition of FIELD_ADDITIONS) {
        if (!SLUG_PATTERN.test(addition.field.slug)) {
            illegal.push(`field ${addition.collection}.${addition.field.slug}`)
        }
    }
    if (illegal.length > 0) {
        console.error(
            `FAIL these slugs do not match ${SLUG_PATTERN} and EmDash would reject them:\n` +
                illegal.map((entry) => `  ${entry}`).join("\n") +
                "\nNothing was written. Fix the slugs above and re-run."
        )
        process.exit(1)
    }
}

async function main() {
    assertSlugsAreLegal()
    if (useDevBypass) {
        await api("GET", "/_emdash/api/setup/dev-bypass")
        ok("dev-bypass session established")
    }
    for (const spec of COLLECTIONS) await ensureCollection(spec)
    for (const addition of FIELD_ADDITIONS) await ensureFieldAddition(addition)
    await seedNoneSentinel()
    await seedTheme()
    console.log(`\nSetup complete against ${base}`)
}

main().catch((error) => {
    console.error("Unexpected failure:", error)
    process.exit(1)
})
