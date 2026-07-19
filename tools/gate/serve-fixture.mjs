/**
 * tools/gate/serve-fixture.mjs
 *
 * Serves a frozen set of EmDash responses over HTTP so `astro build` can run against a deterministic
 * CMS instead of a live one. A shell `CONTENT_API_BASE` overrides `.env`, so pointing the build at this
 * server is enough to isolate it from prod.
 *
 * Two reasons this exists rather than building against the real API:
 *  - Determinism. A phase gate that compares two builds is only meaningful if the content underneath
 *    them cannot move between the runs.
 *  - Reachability. The CMS host publishes AAAA records, and workerd (which executes the prerender step)
 *    does not fall back to IPv4 — so on a machine with no IPv6 route every CMS read stalls until the
 *    75s abort. A loopback fixture never resolves an AAAA record.
 *
 * A path the build requests that is NOT in the fixture is recorded as UNRECORDED and answered with a
 * 404. That guard is load-bearing: the build's readers fail soft on some 404s, so an unrecorded path
 * would silently drop content out of `dist/` and a gate comparing that `dist/` would happily pass. The
 * caller MUST treat a non-empty unrecorded set as a gate failure.
 *
 * As a module:  const server = await startFixtureServer(fixture); … server.unrecorded; await server.close()
 * As a CLI:     node tools/gate/serve-fixture.mjs <name|file> [port]   (port 0 = ephemeral)
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

import { createServer } from "node:http"
import { fileURLToPath } from "node:url"

/**
 * Starts a fixture server on 127.0.0.1.
 *
 * @param {Record<string, { status: number, body: string }>} fixture - responses keyed by request path
 * @param {number} [port] - 0 (the default) binds an ephemeral port, so concurrent or stray runs cannot
 *   collide on a fixed one
 * @returns {Promise<{ port: number, base: string, unrecorded: Set<string>, close: () => Promise<void> }>}
 */
export async function startFixtureServer(fixture, port = 0) {
    const unrecorded = new Set()

    const server = createServer((request, response) => {
        const recorded = fixture[request.url]
        if (!recorded) {
            unrecorded.add(request.url)
            console.error(`  UNRECORDED ${request.url}`)
            response.writeHead(404, { "Content-Type": "application/json" })
            response.end(JSON.stringify({ error: { message: "not in fixture" } }))
            return
        }
        response.writeHead(recorded.status, { "Content-Type": "application/json" })
        response.end(recorded.body)
    })

    // Node closes an idle keep-alive connection after 5s by default. workerd pools connections across a
    // build, so that close can land exactly as it reuses one — which it reports as an opaque "internal
    // error" on EVERY read, and the build then dies with a CmsReadError that looks nothing like the
    // failure under test. Outlast any plausible build instead; nothing here is long-lived enough to care.
    server.keepAliveTimeout = 120_000
    server.headersTimeout = 125_000

    await new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(port, "127.0.0.1", resolve)
    })

    const bound = server.address().port
    return {
        port: bound,
        base: `http://127.0.0.1:${bound}`,
        unrecorded,
        close: () => new Promise((resolve) => server.close(resolve))
    }
}

// CLI mode: run it in one terminal, then build against it in another (e.g. to run `npm run check`
// against a fixture, which the gate runner does not do for you).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const name = process.argv[2]
    if (!name) {
        console.error("usage: node tools/gate/serve-fixture.mjs <baseline|templated|broken> [port]")
        process.exit(1)
    }
    const { FIXTURES } = await import("./fixtures.mjs")
    const fixture = FIXTURES[name]
    if (!fixture) {
        console.error(`unknown fixture "${name}" — expected one of ${Object.keys(FIXTURES).join(", ")}`)
        process.exit(1)
    }
    const server = await startFixtureServer(fixture, Number(process.argv[3] ?? 0))
    console.log(`fixture server on ${server.base}`)
    console.log(`build against it with:  CONTENT_API_BASE=${server.base} npx astro build`)
    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => {
            console.log(`UNRECORDED_COUNT=${server.unrecorded.size}`)
            process.exit(server.unrecorded.size === 0 ? 0 : 1)
        })
    }
}
