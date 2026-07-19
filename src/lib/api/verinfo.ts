/**
 * lib/api/verinfo.ts
 *
 * Returns information about the current worker build
 *
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

import { env } from "cloudflare:workers"
import { authEnabled, dbWriteEnabled, detectEnvironment, richErrors } from "./environment"

export default function verinfo(request: Request) {
    const data = env.CF_VERSION_METADATA
    return {
        timestamp: data.timestamp,
        build_id: data.id,
        tag: data.tag,
        settings: {
            selfenroll: env.API_USER_SELFENROLL,
            errordesc: richErrors(request),
            // minimum wait (seconds) after this build before another rebuild may be triggered; the client
            // uses it together with the build timestamp above to block early rebuild requests
            rebuild_cooldown_sec: Number(env.REBUILD_COOLDOWN_SEC)
        },
        environment: {
            name: detectEnvironment(request),
            authservice: authEnabled(request),
            db_writable: dbWriteEnabled(request),
            ttls: {
                cacheApi: {
                    default: env.CACHE_API_TTL,
                    long: env.CACHE_API_TTL_LONG
                },
                kv: {
                    default: env.KV_CACHE_TTL,
                    long: null
                },
                // per-isolate identity-record cache TTL; sourced in milliseconds (see authorize.ts)
                identity_ms: Number(env.IDENTITY_CACHE_TTL_MS)
            },
            // operational caps surfaced for visibility (see r2.ts, search.ts)
            limits: {
                max_upload_bytes: Number(env.MAX_UPLOAD_BYTES),
                search_result_cap: Number(env.SEARCH_RESULT_CAP)
            },
            // image optimization pipeline parameters (see images.ts)
            images: {
                max_width: Number(env.MAX_IMAGE_WIDTH),
                format: env.TARGET_IMAGE_FORMAT,
                quality: Number(env.TARGET_IMAGE_QUALITY)
            }
        }
    }
}
