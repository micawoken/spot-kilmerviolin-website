/**
 * tests/compositor/media.test.ts
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

import { Render } from "@puckeditor/core/rsc"
import type { Data } from "@puckeditor/core"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, it, expect } from "vitest"

import { buildConfig } from "../../src/lib/compositor/catalog"
import {
    INTERNAL_MEDIA_PREFIX,
    isSafeStorageKey,
    isUploadedFilePath,
    mediaSource,
    proxyFileUrl,
    proxyMediaUrl,
    publicFileUrl,
    publicMediaUrl
} from "../../src/lib/compositor/media"
import { EMPTY_TOKEN_CATALOG } from "../../src/lib/compositor/tokens"

const MEDIA_ORIGIN = "https://store.example.test"
const FILES_ORIGIN = "https://db-img.example.test"
const KEY = "01KWYPRX1NYFRDWNGENG5KHYEC.jpg"

/**
 * The image field value EmDash actually serves for LOCAL (R2) media. Verified against prod and against
 * `emdash/src/media/normalize.ts`: `src` is STRIPPED on persist and the key is carried at
 * `meta.storageKey`. Hand-authoring a `src` here would re-create the very bug this module fixes — a
 * fixture can only confirm our own assumptions, so this one mirrors the wire shape exactly.
 */
const localImageValue = {
    id: "01KWYPRXDWBJVEJHR9RDK6WJRQ",
    alt: "A violin scroll",
    width: 1920,
    height: 1200,
    provider: "local",
    meta: { storageKey: KEY }
}

describe("mediaSource", () => {
    it("reads the storage key from meta.storageKey (the local-media wire shape)", () => {
        expect(mediaSource(localImageValue)).toEqual({ kind: "key", storageKey: KEY })
    })

    it("returns null for a bare media id — the file route is keyed by storage key and 404s on an id", () => {
        // The precise defect this module exists to prevent: `/_emdash/api/media/file/{id}` returns 404
        // (verified on prod). Resolving an id to a URL would emit a guaranteed-broken <img>.
        expect(mediaSource({ id: "01KWYPRXDWBJVEJHR9RDK6WJRQ", alt: "x" })).toBeNull()
    })

    it("unwraps an internal proxy URL back to its storage key", () => {
        expect(mediaSource({ id: "x", src: `${INTERNAL_MEDIA_PREFIX}${KEY}` })).toEqual({
            kind: "key",
            storageKey: KEY
        })
    })

    it("passes an absolute external URL through untouched", () => {
        const url = "https://images.example.test/abc.jpg"
        expect(mediaSource({ id: "x", src: url })).toEqual({ kind: "url", url })
    })

    it("rejects a key that could traverse or reroute on the public CDN origin", () => {
        // Slashes, `?`, `#` and `%` are the reroute vectors guarded in emdash's own SAFE_STORAGE_KEY.
        for (const hostile of ["../../etc/passwd", "a/b.jpg", "k.jpg?x=1", "k.jpg#f", "%2e%2e/k.jpg"]) {
            expect(mediaSource({ id: "x", meta: { storageKey: hostile } })).toBeNull()
            expect(isSafeStorageKey(hostile)).toBe(false)
        }
    })

    it("returns null for a non-string non-record or an empty value", () => {
        expect(mediaSource(undefined)).toBeNull()
        expect(mediaSource({})).toBeNull()
        expect(mediaSource("")).toBeNull()
    })

    it("passes a plain string through as a URL — a D1 entity's `image` column, not an EmDash media object", () => {
        expect(mediaSource("https://images.example.test/abc.jpg")).toEqual({
            kind: "url",
            url: "https://images.example.test/abc.jpg"
        })
        // A bundled asset (/files/<name>) is already public — no rewriting needed.
        expect(mediaSource("/files/some-bundled-image.jpg")).toEqual({
            kind: "url",
            url: "/files/some-bundled-image.jpg"
        })
    })

    it("resolves an /api/v1/files/{key} string to a 'file' source — our own R2_FILES upload proxy, not an already-public URL", () => {
        // The exact defect r2-public-image-401-bug logged: this path 401s for anonymous visitors in
        // production, so it must be resolved (and rewritten) the same way EmDash storage keys are.
        expect(mediaSource("/api/v1/files/01KWYPRXDWBJVEJHR9RDK6WJRQ.jpg")).toEqual({
            kind: "file",
            key: "01KWYPRXDWBJVEJHR9RDK6WJRQ.jpg"
        })
    })
})

describe("isUploadedFilePath", () => {
    it("extracts the key from an /api/v#/files/{key} path", () => {
        expect(isUploadedFilePath("/api/v1/files/abc.jpg")).toBe("abc.jpg")
        expect(isUploadedFilePath("/api/v2/files/abc.jpg")).toBe("abc.jpg")
    })

    it("returns null for a bundled asset path, an absolute URL, or a hostile key", () => {
        expect(isUploadedFilePath("/files/abc.jpg")).toBeNull()
        expect(isUploadedFilePath("https://images.example.test/abc.jpg")).toBeNull()
        expect(isUploadedFilePath("/api/v1/files/../../etc/passwd")).toBeNull()
        expect(isUploadedFilePath("/api/v1/files/a/b.jpg")).toBeNull()
    })
})

describe("publicMediaUrl", () => {
    it("composes ${origin}/${key}, matching emdash's S3Storage.getPublicUrl", () => {
        expect(publicMediaUrl(KEY, MEDIA_ORIGIN)).toBe(`${MEDIA_ORIGIN}/${KEY}`)
    })

    it("tolerates a trailing slash on the configured origin", () => {
        expect(publicMediaUrl(KEY, `${MEDIA_ORIGIN}/`)).toBe(`${MEDIA_ORIGIN}/${KEY}`)
    })

    it("THROWS when the media origin is unset rather than emitting an Access-gated URL", () => {
        // Silently falling back to the proxy would redirect every anonymous visitor to a Cloudflare
        // Access login page. Failing the build is the only safe outcome; this test pins that.
        expect(() => publicMediaUrl(KEY, undefined)).toThrow(/EMDASH_MEDIA_PUBLIC_URL/)
    })
})

describe("proxyMediaUrl", () => {
    it("builds the same-origin file route (correct in the admin, where Access is satisfied)", () => {
        expect(proxyMediaUrl(KEY)).toBe(`${INTERNAL_MEDIA_PREFIX}${KEY}`)
    })
})

describe("publicFileUrl", () => {
    it("composes ${origin}/${key}", () => {
        expect(publicFileUrl(KEY, FILES_ORIGIN)).toBe(`${FILES_ORIGIN}/${KEY}`)
    })

    it("tolerates a trailing slash on the configured origin", () => {
        expect(publicFileUrl(KEY, `${FILES_ORIGIN}/`)).toBe(`${FILES_ORIGIN}/${KEY}`)
    })

    it("THROWS when FILES_PUBLIC_URL is unset rather than emitting an Access-gated URL", () => {
        expect(() => publicFileUrl(KEY, undefined)).toThrow(/FILES_PUBLIC_URL/)
    })
})

describe("proxyFileUrl", () => {
    it("builds the same-origin /api/v1/files/{key} route (correct in the admin)", () => {
        expect(proxyFileUrl(KEY)).toBe(`/api/v1/files/${KEY}`)
    })
})

// --- The invariant that actually protects a live page -----------------------------------------------

/** A template whose single outlet binds an entry's image field. */
const doc: Data = {
    root: { props: {} },
    content: [{ type: "ContentImage", props: { id: "ci-1", field: "featured_image", aspect: "original" } }]
} as unknown as Data

describe("ContentImage on the build target", () => {
    it("emits the PUBLIC media origin and never the Access-gated /_emdash proxy", () => {
        const config = buildConfig(EMPTY_TOKEN_CATALOG, "build", {
            entry: { featured_image: localImageValue },
            mediaBaseUrl: MEDIA_ORIGIN
        })
        const html = renderToStaticMarkup(<Render config={config} data={doc} />)

        expect(html).toContain(`src="${MEDIA_ORIGIN}/${KEY}"`)
        expect(html).toContain('alt="A violin scroll"')
        // The whole point: a prerendered page must carry no /_emdash URL — it 302s to an Access login.
        expect(html).not.toContain("/_emdash")
    })

    it("fails the build when a design renders media but the media origin is unconfigured", () => {
        const config = buildConfig(EMPTY_TOKEN_CATALOG, "build", { entry: { featured_image: localImageValue } })
        expect(() => renderToStaticMarkup(<Render config={config} data={doc} />)).toThrow(
            /EMDASH_MEDIA_PUBLIC_URL/
        )
    })

    it("renders nothing (not a dead URL) when the entry's image is absent", () => {
        const config = buildConfig(EMPTY_TOKEN_CATALOG, "build", { entry: {}, mediaBaseUrl: MEDIA_ORIGIN })
        const html = renderToStaticMarkup(<Render config={config} data={doc} />)
        expect(html).not.toContain("<img")
    })

    // r2-public-image-401-bug: a D1 entity's `image` field pointing at our own R2_FILES upload
    // (/api/v1/files/{key}) must resolve through FILES_PUBLIC_URL on the build target, exactly like
    // EmDash media does through mediaBaseUrl — never the Access-gated proxy path itself.
    it("emits the FILES_PUBLIC_URL origin (not the Access-gated /api/v1/files proxy) for an uploaded-file image", () => {
        const config = buildConfig(EMPTY_TOKEN_CATALOG, "build", {
            entry: { featured_image: "/api/v1/files/01KWYPRXDWBJVEJHR9RDK6WJRQ.jpg" },
            filesBaseUrl: FILES_ORIGIN
        })
        const html = renderToStaticMarkup(<Render config={config} data={doc} />)

        expect(html).toContain(`src="${FILES_ORIGIN}/01KWYPRXDWBJVEJHR9RDK6WJRQ.jpg"`)
        expect(html).not.toContain('src="/api/v1/files/')
    })

    it("fails the build when a design renders an uploaded-file image but FILES_PUBLIC_URL is unconfigured", () => {
        const config = buildConfig(EMPTY_TOKEN_CATALOG, "build", {
            entry: { featured_image: "/api/v1/files/01KWYPRXDWBJVEJHR9RDK6WJRQ.jpg" }
        })
        expect(() => renderToStaticMarkup(<Render config={config} data={doc} />)).toThrow(/FILES_PUBLIC_URL/)
    })
})
