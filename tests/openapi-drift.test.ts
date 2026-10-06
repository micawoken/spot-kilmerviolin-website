/**
 * tests/openapi-drift.test.ts
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
import spec from "../openapi.json"

/**
 * Guards against the OpenAPI spec (uploaded to Cloudflare API Shield) drifting from the route files: every
 * exported handler must be an operation in openapi.json and vice versa
 */
const apiRoutes = import.meta.glob("../src/pages/api/v1/**/*.ts", {
    query: "?raw",
    import: "default",
    eager: true
}) as Record<string, string>

const submitRoutes = import.meta.glob("../src/pages/submit/*.ts", {
    query: "?raw",
    import: "default",
    eager: true
}) as Record<string, string>

const METHOD_EXPORT = /^export const (GET|POST|PUT|PATCH|DELETE)\b/gm

/**
 * Deliberate exceptions: handlers present in code but intentionally absent from the spec
 */
const ALLOWLIST = new Set<string>([
    // documented "not implemented" stub (src/pages/api/v1/identity.ts); PATCH covers identity changes
    "PUT /api/v1/identity"
])

/** Turns a glob key like "../src/pages/api/v1/works/[id].ts" into "/api/v1/works/{id}". */
function deriveRoute(globKey: string): string {
    return globKey
        .replace(/^.*\/pages/, "")
        .replace(/\.ts$/, "")
        .replace(/\/index$/, "")
        .replace(/\[(\w+)\]/g, "{$1}")
}

const codeOperations = new Set<string>()
for (const [key, source] of Object.entries({ ...apiRoutes, ...submitRoutes })) {
    const route = deriveRoute(key)
    for (const match of source.matchAll(METHOD_EXPORT)) {
        codeOperations.add(`${match[1]} ${route}`)
    }
}

const specOperations = new Set<string>()
for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of Object.keys(item)) {
        specOperations.add(`${method.toUpperCase()} ${path}`)
    }
}

describe("openapi.json matches the route files", () => {
    it("finds the route handlers to check", () => {
        expect(codeOperations.size).toBeGreaterThan(0)
    })

    it.each([...codeOperations].filter((operation) => !ALLOWLIST.has(operation)))(
        "%s is documented in openapi.json",
        (operation) => {
            expect(
                specOperations.has(operation),
                `${operation} is exported by a route file but missing from openapi.json. Add it to the spec ` +
                    `or, if it is deliberately excluded, to this test's ALLOWLIST with a comment.`
            ).toBe(true)
        }
    )

    it.each([...specOperations])("%s in openapi.json still exists in code", (operation) => {
        expect(
            codeOperations.has(operation),
            `${operation} is in openapi.json but no route file exports it. Remove it from the spec.`
        ).toBe(true)
    })

    it("the allowlist contains only handlers that still exist", () => {
        for (const operation of ALLOWLIST) {
            expect(codeOperations, `${operation} is allowlisted but no route exports it`).toContain(operation)
        }
    })
})

describe("openapi.json is internally consistent", () => {
    const text = JSON.stringify(spec)

    it("resolves every $ref", () => {
        const refs = [...text.matchAll(/"\$ref":"#\/([^"]+)"/g)].map((match) => match[1])
        expect(refs.length).toBeGreaterThan(0)
        for (const target of refs) {
            let node: unknown = spec
            for (const segment of target.split("/")) {
                node = (node as Record<string, unknown> | undefined)?.[segment]
            }
            expect(node, `$ref #/${target} does not resolve`).toBeDefined()
        }
    })

    it.each(Object.entries(spec.paths))("%s declares each of its path parameters", (path, item) => {
        const names = [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1])
        for (const [method, operation] of Object.entries(item)) {
            const declared = (
                (operation as { parameters?: { $ref?: string; name?: string; in?: string }[] }).parameters ?? []
            ).map((param) => {
                if (param.$ref !== undefined) {
                    const resolved = (spec.components.parameters as Record<string, { name: string; in: string }>)[
                        param.$ref.split("/").pop()!
                    ]
                    return `${resolved.in}:${resolved.name}`
                }
                return `${param.in}:${param.name}`
            })
            for (const name of names) {
                expect(declared, `${method.toUpperCase()} ${path} lacks path parameter ${name}`).toContain(
                    `path:${name}`
                )
            }
        }
    })
})
