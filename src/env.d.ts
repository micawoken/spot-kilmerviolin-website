type Runtime = import("@astrojs/cloudflare").Runtime<Env>

declare namespace App {
    interface Locals extends Runtime {
        identity?: Identity
    }
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

interface ResponseInfo {
    code: number
    message: string
    documentation_url?: string
    source?: {
        pointer?: string
    }
}

interface GatewayItem {
    created_at?: string
    description?: string
    value?: string
}

interface GatewayList {
    id?: string
    count?: number
    created_at?: string
    description?: string
    items: GatewayItem[]
    name?: string
    type?: "SERIAL" | "URL" | "DOMAIN" | "EMAIL" | "IP" | "CATEGORY" | "LOCATION" | "DEVICE" | "AAGUID"
    updated_at?: string
}

interface CfResponseInfoGatewayList {
    errors: ResponseInfo[]
    messages: ResponseInfo[]
    success: boolean
    result?: GatewayList
}
