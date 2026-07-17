/**
 * tools/seed-entity-templates.mjs
 *
 * Seeds one draft design_template per D1-backed entity noun (composer, composition, contributor),
 * every field pre-placed (unified field-outlet rewrite — see entity-fields.ts for the field catalog
 * these mirror exactly). The owner reviews, adjusts, and marks/publishes each as its noun's default
 * through the normal /admin/designs editor — this script never sets `is_default: true` or publishes,
 * so it can never silently replace a live default template out from under the owner (mirrors
 * setup-design-collections.mjs's `seedTheme`, which seeds a draft for the same reason; contrast
 * `seedNoneSentinel`, which is safe to auto-publish because it renders nothing).
 *
 * Idempotent by slug ("{noun}-seed-default"): re-running skips a noun whose seed item already exists,
 * so it is safe to run again after a field-catalog change without duplicating templates — delete the
 * stale item by hand first if you want a regenerated one.
 *
 * Requires `design_template.collection`'s select field to already offer composer/composition/
 * contributor as options (setup-design-collections.mjs declares them, but EmDash's field-update API
 * cannot widen an already-created field's options — see that script's `ensureCollection` warning). If
 * the live field is still `[pages, posts]` only, add the three options by hand in the EmDash admin's
 * collection schema editor before running this.
 *
 * Auth mirrors setup-design-collections.mjs and src/lib/build/emdash-api.ts. Against a deployed worker:
 *   node --env-file=.env tools/seed-entity-templates.mjs
 * Against a local dev server, using the DEV-only auth bypass:
 *   node tools/seed-entity-templates.mjs --base http://localhost:4321 --dev-bypass
 *
 * Prints one line per step and exits non-zero on the first unexpected API response.
 */

import { fileURLToPath } from "node:url"

// --- Puck component builders (mirror catalog.tsx's defaultProps exactly, so a seeded doc opens in the
// editor identically to one authored by hand there) -------------------------------------------------

const heading = (text, level = "h2") => ({ type: "Heading", props: { text, level, typography: "display", align: "start" } })
const contentText = (field, level = "h1") => ({ type: "ContentText", props: { field, level, typography: "display", align: "start" } })
const contentField = (field) => ({ type: "ContentField", props: { field, label: "", showLabel: "yes", typography: "body" } })
const mediaText = (field, content) => ({ type: "MediaText", props: { field, aspect: "original", imagePosition: "start", content } })
const row = (content, gap = "md") => ({ type: "Row", props: { gap, content } })
const divider = () => ({ type: "Divider", props: { spaceAround: "md", color: "" } })
const columns = (cols, gap = "md") => ({
    type: "Columns",
    props: {
        count: cols.length,
        gap,
        col1: cols[0] ?? [],
        col2: cols[1] ?? [],
        col3: cols[2] ?? [],
        col4: cols[3] ?? []
    }
})
// paddingY: "md", not Section's own catalog default ("section") — that default name doesn't match any
// real theme's space tokens (setup-design-collections.mjs's seed theme has xs/sm/md/lg), which would
// fail the pairing lint as an unknown-token ERROR the moment this seed is published.
const section = (content) => ({ type: "Section", props: { background: "", paddingY: "md", content } })

/** Wraps a top-level component array in a version-1 design envelope (migrations.ts's emptyDesignDoc shape). */
function doc(content) {
    return { schemaVersion: 1, puck: { root: {}, content } }
}

// --- One seed layout per noun, every entity-fields.ts field placed exactly once ---------------------

const COMPOSER_DOC = doc([
    section([
        contentText("name", "h1"),
        mediaText("image", [contentField("role"), contentField("birth_year"), contentField("death_year"), contentField("country")]),
        contentField("bio"),
        contentField("tags"),
        divider(),
        row([contentField("entry_date"), contentField("change_date")])
    ])
])

const CONTRIBUTOR_DOC = doc([
    section([
        contentText("name", "h1"),
        mediaText("image", [contentField("class_year"), contentField("major"), contentField("public_email")]),
        contentField("bio"),
        contentField("tags"),
        divider(),
        row([contentField("entry_date"), contentField("change_date")])
    ])
])

const COMPOSITION_DOC = doc([
    section([
        contentText("name", "h1"),
        mediaText("image", [contentField("id"), contentField("type"), contentField("part")]),
        heading("Contributors"),
        columns([
            [contentField("composer"), contentField("author_secondary")],
            [contentField("contrib_primary_1"), contentField("contrib_primary_2"), contentField("contrib_addl")]
        ]),
        heading("Details"),
        columns([
            [contentField("key"), contentField("range"), contentField("position_highest")],
            [contentField("rating_suzuki"), contentField("rating_nyssma"), contentField("phases")],
            [contentField("publish_name"), contentField("publish_location"), contentField("publish_year")]
        ]),
        contentField("publication_uri"),
        divider(),
        heading("Notes"),
        columns([[contentField("notes_historical")], [contentField("notes_pedagogical")], [contentField("notes_other")]]),
        contentField("tags"),
        divider(),
        row([contentField("entry_date"), contentField("change_date")])
    ])
])

const SEEDS = [
    { noun: "composer", title: "Composer (seeded default)", design: COMPOSER_DOC },
    { noun: "composition", title: "Composition (seeded default)", design: COMPOSITION_DOC },
    { noun: "contributor", title: "Contributor (seeded default)", design: CONTRIBUTOR_DOC }
]

// Exported for tests/tools/seed-entity-templates.test.ts (real lintDesign coverage against these exact
// docs) — a pure, side-effect-free export; the CLI machinery below only runs when this file is
// executed directly (see the isMainModule guard), never on import.
export { SEEDS, COMPOSER_DOC, COMPOSITION_DOC, CONTRIBUTOR_DOC }

/** True only when this file is run directly (`node tools/seed-entity-templates.mjs …`), not imported. */
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url)

if (isMainModule) {
    const args = process.argv.slice(2)

    const arg = (name) => {
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

    /** Calls an EmDash API path and returns { status, json }; exits non-zero on an unexpected response. */
    const api = async (method, path, body, expectOk = true) => {
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

    /** Seeds one noun's draft template, skipping if its fixed slug already exists (idempotent). */
    const seedTemplate = async ({ noun, title, design }) => {
        const slug = `${noun}-seed-default`
        const list = await api("GET", "/_emdash/api/content/design_template?limit=100")
        const existing = (list.json?.data?.items ?? []).find((item) => item.slug === slug)
        if (existing) {
            ok(`design_template "${slug}" already exists — seed skipped`)
            return
        }

        await api("POST", "/_emdash/api/content/design_template", {
            slug,
            status: "draft",
            data: { title, collection: noun, is_default: false, design }
        })
        ok(`seeded draft design_template "${slug}"`)
    }

    const main = async () => {
        if (useDevBypass) {
            await api("GET", "/_emdash/api/setup/dev-bypass")
            ok("dev-bypass session established")
        }
        for (const seed of SEEDS) await seedTemplate(seed)
        console.log(
            `\nSeeded against ${base}. Each item is a DRAFT, not the noun's default: review it in ` +
                "/admin/designs, adjust the layout, then mark 'Default template for this collection' and " +
                "publish when ready — publishing is a deliberate owner action, not automated here."
        )
    }

    main().catch((error) => {
        console.error("Unexpected failure:", error)
        process.exit(1)
    })
}
