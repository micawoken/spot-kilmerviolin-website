/**
 * lib/api/cms_access_sync.ts
 *
 * Pushes a contributor's CMS-editor authorization state to the external Pages CMS instance so that its
 * `collaborator` table tracks this worker's authorization decisions automatically. It is the content-CMS
 * counterpart to github_repo_mgmt.ts: a thin module over a single secret-gated endpoint on the Pages CMS
 * deployment that adds (authorized) or removes (revoked) a collaborator keyed by the contributor's
 * identity email.
 *
 * Authorization mirrors the in-app rule: a contributor is a CMS editor when they are an administrator, or
 * they hold a role granting the `cms_editor` permission (the `siteeditor` role) AND are active. The push
 * is best-effort and fire-and-forget at the call site (see usermgmt.ts syncCmsAccessForUser); a periodic
 * reconcile on the Pages CMS side repairs any drift from a missed push. See docs/dev/pages-cms.md.
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
import { permissionsFromRoles } from "./authorize.ts"

/**
 * Whether the CMS-access sync is configured for this runtime. Both the destination URL and the shared
 * secret must be present; when either is absent the sync no-ops cleanly (local/test runtimes, or before
 * the Pages CMS endpoint is provisioned) so contributor mutations are never coupled to an unconfigured
 * integration.
 *
 * @returns true when env.PAGES_CMS_SYNC_URL and env.PAGES_CMS_SYNC_SECRET are both set
 */
export function cmsSyncConfigured(): boolean {
    return Boolean(env.PAGES_CMS_SYNC_URL) && Boolean(env.PAGES_CMS_SYNC_SECRET)
}

/**
 * Computes whether a contributor should have CMS-editor access, mirroring the in-app permission rule.
 * Admins are authorized automatically; non-admins must be active and hold a role granting `cms_editor`.
 * Gating on the aggregated `cms_editor` permission (rather than hardcoding the `siteeditor` role) keeps
 * this correct if another role is ever granted the permission.
 *
 * @param record - a contributor's authorization-relevant fields (roles as a list, admin/active as booleans)
 * @returns whether the contributor should be a CMS editor
 */
export function isCmsAuthorized(record: { roles: string[]; admin: boolean; active: boolean }): boolean {
    if (record.admin) {
        return true
    }
    return record.active && permissionsFromRoles(record.roles).cms_editor
}

/**
 * Pushes a contributor's CMS-editor authorization to the Pages CMS sync endpoint: a POST adds the
 * collaborator (authorized), a DELETE removes it (revoked). The shared secret lives only in the
 * Authorization header and is never logged. Throws on a non-2xx response so the caller can log it; callers
 * invoke this fire-and-forget (via ctx.waitUntil) so a CMS outage never fails the worker request — the
 * Pages CMS reconcile cron is the backstop.
 *
 * No-ops when the sync is not configured (see {@link cmsSyncConfigured}).
 *
 * @param email - the contributor's identity email (the key shared with the Pages CMS collaborator table)
 * @param authorized - true to grant CMS access, false to revoke it
 */
export async function pushCmsAccess(email: string, authorized: boolean): Promise<void> {
    if (!cmsSyncConfigured()) {
        return
    }
    const normalized = email.trim().toLowerCase()
    const response = await fetch(String(env.PAGES_CMS_SYNC_URL), {
        method: authorized ? "POST" : "DELETE",
        headers: {
            Authorization: `Bearer ${env.PAGES_CMS_SYNC_SECRET}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ email: normalized })
    })
    if (!response.ok) {
        const text = await response.text().catch(() => "")
        throw new Error(
            `Pages CMS access sync failed (${authorized ? "POST" : "DELETE"} ${normalized}): ` +
                `${response.status} ${response.statusText} - ${text}`
        )
    }
}
