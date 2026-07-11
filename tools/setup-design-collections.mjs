/**
 * tools/setup-design-collections.mjs
 *
 * Idempotent setup of the visual compositor's EmDash collections (impl §4.1) and the seed
 * design_theme item (impl §4.3). Standalone one-off op — NEVER part of the build; safe to run
 * repeatedly.
 *
 * Creates, only when missing, two collections that support drafts + revisions:
 *   design_theme  — one json field `tokens` (required); seeded with a starter token catalog when
 *                   the collection is empty, as a draft to review + publish in the theme UI.
 *   design_page   — string `title` (required), text `description`, json `design` (required).
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
    }
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

/** Creates a field via the schema API (impl §4.1 shapes). `validation` is omittable, so we don't send it. */
async function createField(collectionSlug, field) {
    await api("POST", `/_emdash/api/schema/collections/${collectionSlug}/fields`, {
        slug: field.slug,
        label: field.label,
        type: field.type,
        required: Boolean(field.required)
    })
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

async function main() {
    if (useDevBypass) {
        await api("GET", "/_emdash/api/setup/dev-bypass")
        ok("dev-bypass session established")
    }
    for (const spec of COLLECTIONS) await ensureCollection(spec)
    await seedTheme()
    console.log(`\nSetup complete against ${base}`)
}

main().catch((error) => {
    console.error("Unexpected failure:", error)
    process.exit(1)
})
