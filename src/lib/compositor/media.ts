/**
 * lib/compositor/media.ts
 *
 * Media URL resolution for the compositor's `Image` (picked media) and `ContentImage` (entry-fed image
 * field). Two constraints here, either one wrong emits a broken `<img>` into a live page:
 *
 * 1. **File route is keyed by storage key, not media id.** EmDash serves a file from
 *    `/_emdash/api/media/file/{storageKey}` — the `{ulid}{ext}` key the upload pipeline produced.
 *    For local (R2) media, EmDash also *strips* `src` on persist; the key lives at `meta.storageKey`.
 *    Key, not id, is the only durable handle on the file.
 *
 * 2. **Proxy route is unreachable for the public.** EmDash treats `/_emdash/api/media/file/` as
 *    public, but our Cloudflare Access application gates *all* of `/_emdash` — an anonymous visitor
 *    gets redirected to the Access login page. A prerendered public page must reference the
 *    **public media origin** (`EMDASH_MEDIA_PUBLIC_URL`, the R2 custom domain), never the proxy.
 *    Inside the admin editor the proxy is correct: that user is Access-authenticated, and the
 *    public origin isn't exposed to the client bundle (not a `PUBLIC_`-prefixed var).
 *
 * Mirrors EmDash's own `resolvePublicMediaUrl`/`buildRenderMediaUrl` — can't call those directly, the
 * build renders in Node against the HTTP API with no `Astro.locals.emdash.storage` binding.
 *
 * A D1 entity's `image` column (plain string, not an EmDash media object) can also carry a
 * same-origin `/api/v1/files/{key}` reference into our own R2_FILES bucket — same public-vs-proxy
 * split as EmDash media, against a separate public origin (`FILES_PUBLIC_URL`). See
 * `isUploadedFilePath`/`publicFileUrl` below.
 */
import { isRecord } from "./types"

/** EmDash's same-origin file route. Public to EmDash; gated by Cloudflare Access in front of it. */
export const INTERNAL_MEDIA_PREFIX = "/_emdash/api/media/file/"

/** The `{ulid}{ext}` key shape the upload pipeline produces. Slashes, `?`, `#`, `%` rejected so a
 * hostile stored value can't traverse or reroute on the public CDN origin. Mirrors EmDash's own
 * `SAFE_STORAGE_KEY` — keep in step. */
const SAFE_STORAGE_KEY = /^[A-Za-z0-9._-]+$/

/** Whether a storage key is safe to interpolate into a media URL. */
export function isSafeStorageKey(key: string): boolean {
    return key !== "" && SAFE_STORAGE_KEY.test(key)
}

/** Our own `/api/v1/files/{key}` proxy route (see `pages/api/v1/files/[id].ts`), R2_FILES-backed. */
const UPLOADED_FILE_PATTERN = /^\/api\/v\d+\/files\/([^/]+)$/

/** Whether a D1 entity `image` string is a same-origin uploaded-file reference, and if so, its key. */
export function isUploadedFilePath(value: string): string | null {
    const match = UPLOADED_FILE_PATTERN.exec(value)
    if (match === null) return null
    const key = decodeURIComponent(match[1])
    return isSafeStorageKey(key) ? key : null
}

/** What an image value resolves to: a local EmDash storage key or uploaded-file key (each resolved
 * per render target), or an already-public absolute URL (external provider or bundled `/files/`
 * asset, passed through untouched). `null` when nothing usable — every caller renders "no image". */
export type MediaSource =
    | { kind: "key"; storageKey: string }
    | { kind: "file"; key: string }
    | { kind: "url"; url: string }
    | null

/** Reads the media source out of a raw field value. EmDash media object wire shape is `{id, src?,
 * alt?, width?, height?, provider?, meta?}`; for local media `src` is absent, key lives at
 * `meta.storageKey`.
 *
 * A plain non-empty string is a D1 entity's `image` column, not an EmDash media object. A
 * same-origin `/api/v1/files/{key}` path is our own R2_FILES upload proxy (`isUploadedFilePath`),
 * same public/proxy split as EmDash storage keys; a bundled `/files/{name}` path or absolute URL is
 * already public, passes through untouched — same trust boundary the entity `*Info.astro` components
 * already apply.
 *
 * Resolution order mirrors EmDash's `buildRenderMediaUrl`: storage key wins, else unwrap an internal
 * proxy URL back to its key, else pass through an absolute URL. A bare media `id` is **not** a usable
 * handle — the file route 404s on it — resolves to `null` rather than a dead URL. */
export function mediaSource(value: unknown): MediaSource {
    if (typeof value === "string") {
        if (value === "") return null
        const uploadedFileKey = isUploadedFilePath(value)
        if (uploadedFileKey !== null) return { kind: "file", key: uploadedFileKey }
        return { kind: "url", url: value }
    }
    if (!isRecord(value)) return null

    const meta = isRecord(value.meta) ? value.meta : undefined
    if (typeof meta?.storageKey === "string" && isSafeStorageKey(meta.storageKey)) {
        return { kind: "key", storageKey: meta.storageKey }
    }

    // `src` is EmDash's field-value key; `url` is the media-library row's. Accept either.
    for (const candidate of [value.src, value.url]) {
        if (typeof candidate !== "string" || candidate === "") continue
        if (candidate.startsWith(INTERNAL_MEDIA_PREFIX)) {
            const key = candidate.slice(INTERNAL_MEDIA_PREFIX.length)
            if (isSafeStorageKey(key)) return { kind: "key", storageKey: key }
            continue
        }
        if (candidate.startsWith("https://") || candidate.startsWith("http://")) {
            return { kind: "url", url: candidate }
        }
    }

    return null
}

/** Same-origin proxy URL for a storage key — correct **only** inside the admin (Access-authenticated).
 * Never emit into a prerendered public page. */
export function proxyMediaUrl(storageKey: string): string {
    return `${INTERNAL_MEDIA_PREFIX}${storageKey}`
}

/** Public URL for a storage key, from the media origin (R2 custom domain) — what a prerendered page
 * must reference. Matches EmDash's `S3Storage.getPublicUrl` (`${publicUrl}/${key}`).
 *
 * Throws when the origin isn't configured: the alternative is silently emitting an Access-gated URL
 * that redirects to a login page for every visitor — a broken image nobody notices until it ships. */
export function publicMediaUrl(storageKey: string, publicBase: string | undefined): string {
    if (!publicBase) {
        throw new Error(
            "[build] a design renders media but EMDASH_MEDIA_PUBLIC_URL is not set, so the only URL " +
                "available is the Cloudflare Access-gated /_emdash media proxy — which redirects every " +
                "anonymous visitor to a login page. Set EMDASH_MEDIA_PUBLIC_URL to the media bucket's " +
                "public origin (see .env.example) and rebuild."
        )
    }
    return `${publicBase.replace(/\/+$/, "")}/${storageKey}`
}

/** Same-origin proxy URL for an uploaded-file key — correct **only** inside the admin. Never emit
 * into a prerendered public page. */
export function proxyFileUrl(key: string): string {
    return `/api/v1/files/${key}`
}

/** Public URL for an uploaded-file key, from the R2_FILES public origin — what a prerendered page
 * must reference. Throws when unconfigured, same reason as {@link publicMediaUrl}. */
export function publicFileUrl(key: string, publicBase: string | undefined): string {
    if (!publicBase) {
        throw new Error(
            "[build] a design renders an uploaded (/api/v1/files/) image but FILES_PUBLIC_URL is not " +
                "set, so the only URL available is the Cloudflare Access-gated /api/v1/files proxy — " +
                "which redirects every anonymous visitor to a login page. Set FILES_PUBLIC_URL to the " +
                "R2_FILES bucket's public origin (see .env.example) and rebuild."
        )
    }
    return `${publicBase.replace(/\/+$/, "")}/${key}`
}

/** Resolves a raw image field value (a D1 entity's `image` column, or an EmDash media object like
 * `featured_image`) to a public URL suitable for `og:image`/`twitter:image` metadata — same source
 * detection as `ContentImage` (`mediaSource`) and the same public-vs-proxy split as
 * {@link publicMediaUrl}/{@link publicFileUrl} (this is only ever called at build time, for a
 * prerendered public page, so the proxy target is never correct here). Returns `undefined` when the
 * value carries no usable image, so a caller can fall through to a page- or site-level default instead
 * of emitting a broken tag. */
export function resolvePublicImageUrl(
    value: unknown,
    mediaBaseUrl: string | undefined,
    filesBaseUrl: string | undefined
): string | undefined {
    const source = mediaSource(value)
    if (!source) return undefined
    switch (source.kind) {
        case "key":
            return publicMediaUrl(source.storageKey, mediaBaseUrl)
        case "file":
            return publicFileUrl(source.key, filesBaseUrl)
        case "url":
            return source.url
    }
}
