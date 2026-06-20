/**
 * lib/api/verinfo.ts
 *
 * Returns information about the current worker build
 *
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
 *
 * This license is also subject to additional terms as specified in the README.md.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
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
                }
            }
        }
    }
}
