/**
 * tests/search-pagination.test.ts
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
 */

import { describe, it, expect } from "vitest"

import { dedupeByUrl, normalizeUrl } from "../src/lib/search/pagination"

describe("dedupeByUrl", () => {
    it("keeps the first occurrence of a repeated URL and drops the rest", () => {
        const items = [
            { url: "/entity/composer/1", excerpt: "first chunk" },
            { url: "/entity/composer/2", excerpt: "unrelated" },
            { url: "/entity/composer/1", excerpt: "second chunk of the same page, ranked lower" }
        ]
        expect(dedupeByUrl(items)).toEqual([
            { url: "/entity/composer/1", excerpt: "first chunk" },
            { url: "/entity/composer/2", excerpt: "unrelated" }
        ])
    })

    it("preserves input order and returns everything when there are no duplicates", () => {
        const items = [{ url: "/a" }, { url: "/b" }, { url: "/c" }]
        expect(dedupeByUrl(items)).toEqual(items)
    })

    it("returns an empty array for empty input", () => {
        expect(dedupeByUrl([])).toEqual([])
    })
})

describe("normalizeUrl", () => {
    it("strips a single trailing slash", () => {
        expect(normalizeUrl("/entity/composer/1/")).toBe("/entity/composer/1")
    })

    it("leaves a URL with no trailing slash unchanged", () => {
        expect(normalizeUrl("/entity/composer/1")).toBe("/entity/composer/1")
    })

    it("leaves the bare root slash unchanged", () => {
        expect(normalizeUrl("/")).toBe("/")
    })
})
