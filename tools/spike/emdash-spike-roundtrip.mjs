/**
 * tools/spike/emdash-spike-roundtrip.mjs — THROWAWAY (Phase 0 spike (b); deleted before Phase 1).
 *
 * Exercises the EmDash HTTP API surface the compositor depends on, against either a local dev server
 * (using the DEV-only /_emdash/api/auth/dev-bypass session) or the deployed worker (using the
 * Cloudflare Access service token from env — run with `node --env-file=.env`):
 *
 *   1. ensure the throwaway `design_spike` collection exists (schema API; needs schema:manage)
 *   2. create a draft content item with a json `design` field
 *   3. GET the item (expect `_rev`)
 *   4. PUT an edit with the current `_rev` (expect success + new `_rev`)
 *   5. PUT again with the STALE `_rev` (expect a version-conflict rejection)
 *   6. publish the item, then list revisions
 *
 *   node tools/spike/emdash-spike-roundtrip.mjs --base http://localhost:4321 --dev-bypass
 *   node --env-file=.env tools/spike/emdash-spike-roundtrip.mjs
 *
 * Prints one line per step; exits non-zero on the first unexpected response. Cleanup of the spike
 * collection is deliberately manual (tools/spike/emdash-spike-cleanup.mjs) so state can be inspected.
 */

const args = process.argv.slice(2)
function arg(name) {
    const i = args.indexOf(name)
    return i === -1 ? undefined : (args[i + 1] ?? true)
}

const base = (arg("--base") ?? process.env.CONTENT_API_BASE)?.replace(/\/+$/, "")
if (!base) {
    console.error("No --base and no CONTENT_API_BASE in env")
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

let cookie = ""

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
        /* non-JSON body (e.g. Access HTML challenge) */
    }
    if (expectOk && !response.ok) {
        console.error(`FAIL ${method} ${path} → ${response.status}`, JSON.stringify(json?.error ?? json)?.slice(0, 300))
        process.exit(1)
    }
    return { status: response.status, json }
}

const step = (msg) => console.log(`✔ ${msg}`)

// -- auth ------------------------------------------------------------------
if (useDevBypass) {
    await api("GET", "/_emdash/api/setup/dev-bypass")
    step("dev-bypass session established")
}

// -- 1. collection ---------------------------------------------------------
const collections = await api("GET", "/_emdash/api/schema/collections")
const existing = (collections.json?.data?.collections ?? collections.json?.data ?? []).find?.(
    (c) => c.slug === "design_spike"
)
if (existing) {
    step("design_spike collection already exists")
} else {
    await api("POST", "/_emdash/api/schema/collections", {
        slug: "design_spike",
        label: "Design Spike",
        supports: ["drafts", "revisions"],
        hasSeo: false
    })
    await api("POST", "/_emdash/api/schema/collections/design_spike/fields", {
        slug: "design",
        label: "Design",
        type: "json"
    })
    step("created design_spike collection with json field `design`")
}

// -- 2. create item --------------------------------------------------------
const slug = `spike-item-${Date.now()}`
const initialDesign = { schemaVersion: 1, puck: { root: { props: {} }, content: [] } }
const created = await api("POST", "/_emdash/api/content/design_spike", {
    slug,
    status: "draft",
    data: { design: initialDesign }
})
const itemId = created.json?.data?.item?.id
if (!itemId) {
    console.error("FAIL create: no item id in response", JSON.stringify(created.json)?.slice(0, 300))
    process.exit(1)
}
step(`created draft item ${itemId} (${slug})`)

// -- 3. GET with _rev ------------------------------------------------------
const got = await api("GET", `/_emdash/api/content/design_spike/${itemId}`)
const rev1 = got.json?.data?._rev
if (!rev1) {
    console.error("FAIL get: no _rev in response")
    process.exit(1)
}
step(`fetched item; _rev present`)

// -- 4. PUT with current _rev ----------------------------------------------
const edited = { ...initialDesign, puck: { root: { props: {} }, content: [{ type: "Paragraph", props: { id: "p1", text: "edited" } }] } }
const put1 = await api("PUT", `/_emdash/api/content/design_spike/${itemId}`, {
    data: { design: edited },
    status: "draft",
    _rev: rev1
})
const rev2 = put1.json?.data?._rev
step(`PUT with fresh _rev accepted (new _rev ${rev2 ? "issued" : "MISSING"})`)
if (!rev2) process.exit(1)

// -- 5. PUT with stale _rev --------------------------------------------------
const put2 = await api(
    "PUT",
    `/_emdash/api/content/design_spike/${itemId}`,
    { data: { design: initialDesign }, status: "draft", _rev: rev1 },
    false
)
if (put2.status >= 400 && put2.status < 500) {
    step(`PUT with stale _rev rejected as expected (${put2.status}: ${put2.json?.error?.message ?? "?"})`)
} else {
    console.error(`FAIL stale-_rev PUT was not rejected (status ${put2.status})`)
    process.exit(1)
}

// -- 6. publish + revisions ---------------------------------------------------
await api("POST", `/_emdash/api/content/design_spike/${itemId}/publish`)
const after = await api("GET", `/_emdash/api/content/design_spike/${itemId}`)
step(`published; status now "${after.json?.data?.item?.status}"`)
const revisions = await api("GET", `/_emdash/api/content/design_spike/${itemId}/revisions`)
const count = (revisions.json?.data?.revisions ?? revisions.json?.data ?? []).length
step(`revisions listed (${count})`)

console.log(`\nAll roundtrip checks passed against ${base}`)
