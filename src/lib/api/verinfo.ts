/**
 * lib/api/verinfo.ts
 * 
 * Returns information about the current worker build
 * 
 */

import { env } from 'cloudflare:workers';

export default function verinfo() {
    const data = env.CF_VERSION_METADATA
    return {
        timestamp: data.timestamp,
        build_id: data.id,
        tag: data.tag,
        settings: {
            selfenroll: env.API_USER_SELFENROLL,
            errordesc: env.RICH_ERRORS
        },
        environment: {
            authservice: env.AUTH_ENABLED,
            db_writable: env.DB_ENABLE_WRITE,
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