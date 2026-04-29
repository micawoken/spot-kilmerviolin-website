type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}

declare module "jose" { // jose from npmjs
  interface JWTPayload {
    aud?: string | string[];
    exp?: number;
    iat?: number;
    iss?: string;
    jti?: string;
    nbf?: number;
    sub?: string;
    [claim: string]: any; // Allow additional claims
  }

  interface JWK {
    alg?: string;
    crv?: string;
    d?: string;
    dp?: string;
    e?: string;
    ext?: boolean;
    k?: string;
    key_ops?: string[];
    kid?: string;
    kty: string;
    n?: string;
    p?: string;
    priv?: string;
    pub?: string;
    q?: string;
    qi?: string;
    use?: string;
    x?: string;
    x5c?: string[];
    x5t?: string;
    x5u?: string;
    y?: string;
     [param: string]: any; // Allow additional parameters
  }

  interface JSONWebKeySet {
    keys: JWK[];
  }

  interface ExportedJWKSCache {
    jwks: JSONWebKeySet;
    uat: number
  }

  type JWKSCacheInput = ExportedJWKSCache | Record<string, never>

  interface JWTVerifyOptions {
    algorithms?: string[];
    audience?: string | string[];
    clockTolerance?: number;
    crit?: string[];
    currentDate?: Date;
    issuer?: string | string[];
    maxTokenAge?: number | string;
    requiredClaims?: string[];
    subject?: string;
    typ?: string;
  }

  interface JWTVerifyResult {
    payload: JWTPayload;
    protectedHeader: Record<string, any>;
  }

  interface RemoteJWKSetOptions {
    cacheMaxAge?: number;
    cooldownDuration? : number;
    headers?: Record<string, string>;
    timeoutDuration?: number;
    customFetch?: typeof fetch;
    jwksCacheInput
  }

  function jwtVerify(jwt: string | Uint8Array, key: Uint8Array | CryptoKey | JWK | KeyObject, options?: JWTVerifyOptions): Promise<JWTVerifyResult>;

  function createRemoteJWKSet(url: URL, options?: RemoteJWKSetOptions): Promise<CryptoKey>

  // don't need to define more functions than necessary

}