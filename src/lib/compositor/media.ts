/**
 * lib/compositor/media.ts
 *
 * Media URL resolution for the compositor's `Image` (picked media) and `ContentImage` (entry-fed image
 * field). Two constraints make this non-obvious, and getting either wrong emits a broken `<img>` into a
 * live page:
 *
 * 1. **The file route is keyed by storage key, not media id.** EmDash serves a file from
 *    `/_emdash/api/media/file/{storageKey}` where the key is the `{ulid}{ext}` the upload pipeline
 *    produced. For local (R2) media EmDash also *strips* `src` when persisting an image field value —
 *    the key is carried at `meta.storageKey` (`emdash/src/media/normalize.ts`). The key, not the id, is
 *    the only durable handle on the file.
 *
 * 2. **The proxy route is unreachable for the public.** EmDash itself treats
 *    `/_emdash/api/media/file/` as public (`emdash/src/astro/middleware/auth.ts`), but our Cloudflare
 *    Access application gates *all* of `/_emdash`, so an anonymous visitor is redirected to the Access
 *    login page. A prerendered public page must therefore reference the **public media origin**
 *    (`EMDASH_MEDIA_PUBLIC_URL` — the R2 custom domain) and never the proxy. Inside the admin editor the
 *    proxy is the correct choice: that user is authenticated through Access, and the public origin is
 *    not exposed to the client bundle (it is not a `PUBLIC_`-prefixed var).
 *
 * This mirrors EmDash's own `resolvePublicMediaUrl` / `buildRenderMediaUrl` (`emdash/src/media/url.ts`).
 * We cannot call those directly: the build renders in Node against the HTTP API and has no
 * `Astro.locals.emdash.storage` binding to resolve against.
 *
 * A D1 entity's own `image` column (a plain string, not an EmDash media object — see `types.d.ts`) can
 * also carry a same-origin `/api/v1/files/{key}` reference into our own R2_FILES bucket. That route
 * requires an authenticated identity in production (`pages/api/v1/files/[id].ts`), so it has the exact
 * same public-vs-proxy split as EmDash media, against a separate public origin (`FILES_PUBLIC_URL`, the
 * R2 custom domain for R2_FILES). See `isUploadedFilePath`/`publicFileUrl` below.
 */
import { isRecord } from "./types"

/** EmDash's same-origin file route. Public to EmDash; gated by Cloudflare Access in front of it. */
export const INTERNAL_MEDIA_PREFIX = "/_emdash/api/media/file/"

/**
 * The `{ulid}{ext}` key shape the upload pipeline produces. Slashes, `?`, `#` and `%` are rejected so a
 * hostile value stored in a design doc (or a portable-text `asset.url`) cannot traverse or reroute on
 * the public CDN origin. Mirrors `SAFE_STORAGE_KEY` in `emdash/src/media/url.ts` — keep them in step.
 */
const SAFE_STORAGE_KEY = /^[A-Za-z0-9._-]+$/

/** Whether a storage key is safe to interpolate into a media URL. */
export function isSafeStorageKey(key: string): boolean {
    return key !== "" && SAFE_STORAGE_KEY.test(key)
}

/** Our own `/api/v1/files/{key}` proxy route (see `pages/api/v1/files/[id].ts`), R2_FILES-backed. */
const UPLOADED_FILE_PATTERN = /^\/api\/v\d+\/files\/([^/]+)$/

/**
 * Whether a D1 entity `image` string is a same-origin uploaded-file reference, and if so, its key.
 *
 * @param {string} value - the raw `image` column value
 * @returns {string | null} - the extracted, key-safe file key, or null if this isn't that shape
 */
export function isUploadedFilePath(value: string): string | null {
    const match = UPLOADED_FILE_PATTERN.exec(value)
    if (match === null) return null
    const key = decodeURIComponent(match[1])
    return isSafeStorageKey(key) ? key : null
}

/**
 * What an image value resolves to: a local EmDash storage key or an uploaded-file key (each resolved per
 * render target), or an already-public absolute URL (an external media provider, or a bundled `/files/`
 * asset — both passed through untouched). `null` when the value carries nothing usable, which every
 * caller renders as "no image".
 */
export type MediaSource =
    | { kind: "key"; storageKey: string }
    | { kind: "file"; key: string }
    | { kind: "url"; url: string }
    | null

/**
 * Reads the media source out of an EmDash `image` field value. The wire shape is
 * `{ id, src?, alt?, width?, height?, provider?, meta? }` (`emdash/src/schema/zod-generator.ts`); for
 * local media `src` is absent and the key lives at `meta.storageKey`.
 *
 * A plain non-empty string is a D1 entity's `image` column, not an EmDash media object (see
 * `src/lib/api/types.d.ts`'s `image: string | null` — "refers to a file in assets, or an external
 * URL"). A same-origin `/api/v1/files/{key}` path is our own R2_FILES upload proxy (see
 * `isUploadedFilePath`) and needs the same public/proxy split as EmDash's storage keys; a bundled
 * `/files/{name}` path or an absolute URL is already fully public, so it passes through untouched — same
 * trust boundary the entity `*Info.astro` components already apply (`src={record.image ?? undefined}`,
 * no scheme validation beyond the admin form's `type="url"`).
 *
 * Resolution order mirrors EmDash's `buildRenderMediaUrl`: the storage key wins; otherwise an internal
 * proxy URL is unwrapped back to its key; otherwise an absolute URL passes through. A bare media `id` is
 * **not** a usable handle — the file route 404s on it — so it resolves to `null` rather than a dead URL.
 *
 * @param {unknown} value - the raw field value from the entry's data record
 * @returns {MediaSource} - the resolved source, or null when nothing usable is present
 */
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

/**
 * The same-origin proxy URL for a storage key — correct **only** inside the admin, where the user is
 * authenticated through Cloudflare Access. Never emit this into a prerendered public page.
 *
 * @param {string} storageKey - a key that has already passed {@link isSafeStorageKey}
 * @returns {string} - the same-origin `/_emdash/api/media/file/{key}` URL
 */
export function proxyMediaUrl(storageKey: string): string {
    return `${INTERNAL_MEDIA_PREFIX}${storageKey}`
}

/**
 * The public URL for a storage key, served from the media origin (the R2 custom domain) so an anonymous
 * visitor can load it without passing Cloudflare Access. This is what a prerendered page must reference.
 *
 * Composition matches EmDash's `S3Storage.getPublicUrl` (`${publicUrl}/${key}`) so both sides agree.
 *
 * Throws when the origin is not configured: the alternative is silently emitting an Access-gated URL that
 * redirects to a login page for every visitor — a broken image nobody would notice until it shipped.
 *
 * @param {string} storageKey - a key that has already passed {@link isSafeStorageKey}
 * @param {string | undefined} publicBase - the media origin, from `EMDASH_MEDIA_PUBLIC_URL`
 * @returns {string} - the absolute public media URL
 * @throws {Error} when `publicBase` is missing or empty
 */
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

/**
 * The same-origin proxy URL for an uploaded-file key — correct **only** inside the admin, where the user
 * is authenticated through Cloudflare Access. Never emit this into a prerendered public page.
 *
 * @param {string} key - a key that has already passed {@link isSafeStorageKey}
 * @returns {string} - the same-origin `/api/v1/files/{key}` URL
 */
export function proxyFileUrl(key: string): string {
    return `/api/v1/files/${key}`
}

/**
 * The public URL for an uploaded-file key, served from the R2_FILES public origin so an anonymous
 * visitor can load it without passing Cloudflare Access. This is what a prerendered page must reference.
 *
 * Throws when the origin is not configured, for the same reason as {@link publicMediaUrl}: silently
 * falling back to the Access-gated proxy would ship a broken image to every anonymous visitor.
 *
 * @param {string} key - a key that has already passed {@link isSafeStorageKey}
 * @param {string | undefined} publicBase - the R2_FILES public origin, from `FILES_PUBLIC_URL`
 * @returns {string} - the absolute public file URL
 * @throws {Error} when `publicBase` is missing or empty
 */
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
