/**
 * lib/api/verinfo.ts
 * 
 * Returns information about the current worker build
 * 
 */

import { env } from 'cloudflare:workers';
import { authEnabled, dbWriteEnabled, detectEnvironment, richErrors } from './environment';

export default function verinfo(request: Request) {
    const data = env.CF_VERSION_METADATA
    return {
        timestamp: data.timestamp,
        build_id: data.id,
        tag: data.tag,
        settings: {
            selfenroll: env.API_USER_SELFENROLL,
            errordesc: richErrors(request)
        },
        environment: {
            name: detectEnvironment(request),
            authservice: authEnabled(request),
            db_writable: dbWriteEnabled(request),
            ttls: {
                cacheApi: {
                    default: env.CACHE_API_TTL,
                    long: env.CACHE_API_TTL_LONG,
                },
                kv: {
                    default: env.KV_CACHE_TTL,
                    long: null
                }
            }
        }
    }
}