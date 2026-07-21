/**
 * env.d.ts
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

type Runtime = import("@astrojs/cloudflare").Runtime<Env>

declare namespace App {
    interface Locals extends Runtime {
        identity?: Identity
        /**
         * Set by middleware/identity.ts when a /_emdash request authenticated with a non-browser service
         * credential (EmDash API token or Access service-token JWT). EmDash's own auth layer validates and
         * authorizes such credentials; middleware/emdash_access.ts then skips the cms_editor page gate.
         */
        emdashServiceAuth?: boolean
        /**
         * Set by middleware/identity.ts when a valid user-scoped API token (plan-prelaunch-features.md §2)
         * authenticated an /api/ request. `locals.identity` is also populated (the token's owning
         * contributor's live Identity) so downstream authorization is unchanged; this flag exists only so
         * /api/v1/tokens can refuse token-authenticated requests (D2 — a leaked token cannot mint successors
         * or revoke evidence).
         */
        tokenAuth?: boolean
        /**
         * Set by middleware/identity.ts when a valid build token (plan-prelaunch-features.md §2, D9)
         * authenticated an /api/ request. Unlike tokenAuth, no Identity is set — a build token has no
         * owning contributor. The middleware itself enforces the route whitelist (buildTokenRouteAllowed),
         * so by the time a handler observes this flag it is already known to be one of the three permitted
         * GET collection routes.
         */
        buildTokenAuth?: boolean
    }
}

// Build-time configuration for the CMS content fetch (src/lib/build/emdash-api.ts) and media publicUrl
// (astro.config.mjs). Read only during `astro build` (prerendering) — never bound as wrangler runtime
// secrets/vars. Merges with Vite's ImportMetaEnv. See .env.example.
interface ImportMetaEnv {
    readonly CONTENT_API_BASE?: string
    readonly CF_ACCESS_CLIENT_ID?: string
    readonly CF_ACCESS_CLIENT_SECRET?: string
    readonly EMDASH_API_TOKEN?: string
    readonly EMDASH_MEDIA_PUBLIC_URL?: string
    // Cloudflare Web Analytics beacon token (public, non-secret — it ships verbatim in every page's HTML).
    // Build-time-only like the rest of this interface: public pages are prerendered (see PublicHead.astro),
    // so this must come from the build environment, not a wrangler runtime var. See .env.example.
    readonly CF_WEB_ANALYTICS_TOKEN?: string
}

declare module "jose" {
    // jose from npmjs
    interface JWTPayload {
        aud?: string | string[]
        exp?: number
        iat?: number
        iss?: string
        jti?: string
        nbf?: number
        sub?: string
        [claim: string]: any // Allow additional claims
    }

    interface JWK {
        alg?: string
        crv?: string
        d?: string
        dp?: string
        e?: string
        ext?: boolean
        k?: string
        key_ops?: string[]
        kid?: string
        kty: string
        n?: string
        p?: string
        priv?: string
        pub?: string
        q?: string
        qi?: string
        use?: string
        x?: string
        x5c?: string[]
        x5t?: string
        x5u?: string
        y?: string
        [param: string]: any // Allow additional parameters
    }

    interface JSONWebKeySet {
        keys: JWK[]
    }

    interface ExportedJWKSCache {
        jwks: JSONWebKeySet
        uat: number
    }

    type JWKSCacheInput = ExportedJWKSCache | Record<string, never>

    interface JWTVerifyOptions {
        algorithms?: string[]
        audience?: string | string[]
        clockTolerance?: number
        crit?: string[]
        currentDate?: Date
        issuer?: string | string[]
        maxTokenAge?: number | string
        requiredClaims?: string[]
        subject?: string
        typ?: string
    }

    interface JWTVerifyResult {
        payload: JWTPayload
        protectedHeader: Record<string, any>
    }

    interface RemoteJWKSetOptions {
        cacheMaxAge?: number
        cooldownDuration?: number
        headers?: Record<string, string>
        timeoutDuration?: number
        customFetch?: typeof fetch
        jwksCache?: JWKSCacheInput
    }

    async function jwtVerify(
        jwt: string | Uint8Array,
        key: Uint8Array | CryptoKey | JWK | KeyObject,
        options?: JWTVerifyOptions
    ): Promise<JWTVerifyResult>

    async function createRemoteJWKSet(url: URL, options?: RemoteJWKSetOptions): Promise<CryptoKey>

    // don't need to define more functions than necessary
}

// The Pagefind browser runtime, generated post-build into dist/client/pagefind/pagefind.js by the "build"
// npm script (`pagefind --site dist/client`). It does not exist in the source tree — pages/search.astro
// loads it via a runtime `import("/pagefind/pagefind.js")` (a path, not a resolvable module specifier) and
// casts the result to this shape, rather than `declare module "/pagefind/pagefind.js"`: astro check's
// per-script-block virtual files did not resolve that ambient declaration against the matching dynamic
// import. Only the fields pages/search.astro actually reads are declared; Pagefind's real API is larger.
interface PagefindSearchFragment {
    url: string
    /** plain-text-with-<mark> HTML excerpt around the matched terms, safe to render via innerHTML */
    excerpt: string
    meta: { title?: string; [key: string]: string | undefined }
}

interface PagefindSearchResult {
    id: string
    data: () => Promise<PagefindSearchFragment>
}

interface PagefindSearchResults {
    results: PagefindSearchResult[]
}

interface PagefindSearchOptions {
    /** Restricts results to pages carrying a matching data-pagefind-filter (e.g. { scope: ["database"] }
     *  for pages tagged data-pagefind-filter="scope:database" — see layouts/PublicPage.astro). */
    filters?: Record<string, string[]>
}

interface PagefindApi {
    init: () => Promise<void>
    search: (query: string, options?: PagefindSearchOptions) => Promise<PagefindSearchResults>
}

interface ResponseInfo {
    code: number
    message: string
    documentation_url?: string
    source?: {
        pointer?: string
    }
}

// a Cloudflare Access policy rule that allows a single inline email; the enrollment allowlist is expressed as
// a set of these in the policy's `include` array (see lib/api/access_iam_mgmt.ts)
interface AccessEmailRule {
    email: { email: string }
}

// any include/exclude/require rule; only AccessEmailRule is inspected, other rule types are preserved opaquely
type AccessRule = AccessEmailRule | Record<string, unknown>

// a reusable Access policy as returned by GET and accepted (minus read-only keys) by PUT. Unknown editable
// fields are kept via the index signature so a read-modify-write round-trips without dropping settings.
interface AccessPolicy {
    id?: string
    name?: string
    decision?: string
    include: AccessRule[]
    exclude?: AccessRule[]
    require?: AccessRule[]
    session_duration?: string
    [key: string]: unknown
}

interface CfResponseInfoAccessPolicy {
    errors: ResponseInfo[]
    messages: ResponseInfo[]
    success: boolean
    result?: AccessPolicy
}

// Cloudflare GraphQL Analytics API response shape for the Web Analytics (RUM) summary query in
// lib/api/analytics.ts. Only the fields that query actually selects are declared — the real schema is
// much larger (see https://developers.cloudflare.com/analytics/graphql-api/).
interface CfGraphqlError {
    message: string
}

interface CfRumPageloadEventsGroup {
    count: number
    sum: { visits: number }
}

interface CfGraphqlAnalyticsResponse {
    data?: {
        viewer?: {
            accounts?: { rumPageloadEventsAdaptiveGroups?: CfRumPageloadEventsGroup[] }[]
        }
    }
    errors?: CfGraphqlError[]
}
