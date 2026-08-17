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
        // service authorization
        emdashServiceAuth?: boolean
        tokenAuth?: boolean
        // build tokens
        buildTokenAuth?: boolean
    }
}

// Build-time configuration for the CMS content fetch (src/lib/build/emdash-api.ts) and media publicUrl
// (astro.config.mjs)
interface ImportMetaEnv {
    readonly CONTENT_API_BASE?: string
    readonly CF_ACCESS_CLIENT_ID?: string
    readonly CF_ACCESS_CLIENT_SECRET?: string
    readonly EMDASH_API_TOKEN?: string
    readonly BUILD_API_TOKEN?: string
    readonly EMDASH_MEDIA_PUBLIC_URL?: string
    readonly FILES_PUBLIC_URL?: string
    readonly CF_WEB_ANALYTICS_TOKEN?: string
    readonly SITE_DEFAULT_OG_IMAGE?: string
    readonly SITE_ALLOW_INDEXING?: string
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
// npm script (`pagefind --site dist/client`). It does not exist in the source tree - pages/search.astro
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

// Value counts per filter key (e.g. { type: { page: 4, post: 2, work: 116 } }) - from either the
// standalone `filters()` call (whole index) or a search result's own `filters` (narrowed to that
// result set), used by pages/search.astro to populate its content-type checkboxes with live counts.
interface PagefindFilterCounts {
    [filterKey: string]: Record<string, number>
}

interface PagefindSearchResults {
    results: PagefindSearchResult[]
    filters: PagefindFilterCounts
}

interface PagefindSearchOptions {
    /** Restricts results to pages carrying a matching data-pagefind-filter (e.g. { scope: ["database"] }
     *  for pages tagged data-pagefind-filter="scope:database" - see layouts/PublicPage.astro). */
    filters?: Record<string, string[]>
}

interface PagefindApi {
    init: () => Promise<void>
    search: (query: string, options?: PagefindSearchOptions) => Promise<PagefindSearchResults>
    /** Every filter key/value pair currently in the index, with unfiltered result counts. */
    filters: () => Promise<PagefindFilterCounts>
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

// a reusable Access policy as returned by GET and accepted (minus read-only keys) by PUT
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
// lib/api/analytics.ts. Only the fields that query actually selects are declared - the real schema is
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
