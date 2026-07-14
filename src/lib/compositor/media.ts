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

/**
 * What an image value resolves to: a local storage key (resolved per render target) or an already-public
 * absolute URL (an external media provider — passed through untouched, as EmDash does). `null` when the
 * value carries nothing usable, which every caller renders as "no image".
 */
export type MediaSource = { kind: "key"; storageKey: string } | { kind: "url"; url: string } | null

/**
 * Reads the media source out of an EmDash `image` field value. The wire shape is
 * `{ id, src?, alt?, width?, height?, provider?, meta? }` (`emdash/src/schema/zod-generator.ts`); for
 * local media `src` is absent and the key lives at `meta.storageKey`.
 *
 * Resolution order mirrors EmDash's `buildRenderMediaUrl`: the storage key wins; otherwise an internal
 * proxy URL is unwrapped back to its key; otherwise an absolute URL passes through. A bare media `id` is
 * **not** a usable handle — the file route 404s on it — so it resolves to `null` rather than a dead URL.
 *
 * @param {unknown} value - the raw field value from the entry's data record
 * @returns {MediaSource} - the resolved source, or null when nothing usable is present
 */
export function mediaSource(value: unknown): MediaSource {
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
