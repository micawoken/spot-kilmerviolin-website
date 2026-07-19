/**
 * lib/api/access_iam_mgmt.ts
 *
 * Provides functions relating to granting and revoking access via Cloudflare Access. Enrollment is managed by
 * editing the inline `email` include rules of a reusable Access policy directly (read-modify-write on
 * /accounts/{id}/access/policies/{policy_id}), rather than through a referenced reusable email list. This needs
 * only an "Access: Policies Edit" API token (see DEPLOY.md), and inline emails work on plans where referenced
 * email lists do not. Non-email rules on the policy are preserved untouched.
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
import { isFallbackEmail } from "./fallback"

const cf_api_base = "https://api.cloudflare.com/client/v4"
// reusable Access policy endpoint; the policy's inline `email` include rules are the enrollment allowlist
const cf_access_policy_endpoint = "/accounts/{account_id}/access/policies/{policy_id}"

// fields the API returns but rejects on write; stripped before every PUT so a read-modify-write round-trips cleanly
const POLICY_READONLY_KEYS = ["id", "created_at", "updated_at", "reusable", "app_count"] as const

// narrows an include/exclude/require rule to the inline-email shape { email: { email: "..." } }; every other
// rule type (groups, IdPs, service tokens, email_list, everyone, ...) fails this guard and is preserved untouched
function isEmailRule(rule: AccessRule): rule is AccessEmailRule {
    const value = (rule as AccessEmailRule)?.email?.email
    return typeof value === "string"
}

function _fetch(endpoint: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", body?: any): Promise<Response> {
    // Implementation for fetching from Cloudflare API
    return fetch(
        cf_api_base +
            endpoint.replace("{account_id}", env.CF_ACCOUNT_ID).replace("{policy_id}", env.CF_ACCESS_POLICY_ID),
        {
            method: method,
            headers: {
                Authorization: `Bearer ${env.CF_ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: body ? JSON.stringify(body) : undefined
        }
    )
}

// reads as text first: error responses (e.g. from the Cloudflare edge) are not always JSON
async function _parse_policy(response: Response): Promise<AccessPolicy> {
    const response_text = await response.text()
    if (!response.ok) {
        throw new Error(`Cloudflare API error: ${response.status} ${response.statusText} - ${response_text}`)
    }
    const response_json: CfResponseInfoAccessPolicy = JSON.parse(response_text)
    if (!response_json.success || !response_json.result) {
        throw new Error(`Cloudflare API error: ${JSON.stringify(response_json.errors)}`)
    }
    return response_json.result
}

// GET the current reusable policy, including its full include/exclude/require rule set
async function get_policy(): Promise<AccessPolicy> {
    const response = await _fetch(cf_access_policy_endpoint, "GET")
    return _parse_policy(response)
}

// PUT is a full replacement (there is no per-rule append/remove), so the caller mutates the policy read by
// get_policy() and writes the whole object back. Read-only fields are stripped; all other fields — decision,
// name, session settings, and any non-email include/exclude/require rules — round-trip unchanged so we only
// ever alter the inline email allowlist. NOTE: this is a read-modify-write with no compare-and-swap on the
// Access API, so concurrent mutations can race; callers here are effectively serialized (single-admin site).
async function put_policy(policy: AccessPolicy): Promise<void> {
    const body: Record<string, unknown> = { ...policy }
    for (const key of POLICY_READONLY_KEYS) {
        delete body[key]
    }
    const response = await _fetch(cf_access_policy_endpoint, "PUT", body)
    await _parse_policy(response)
}

/**
 * Verifies that the configured Cloudflare API token is valid; useful for diagnosing auth failures
 *
 * @returns {Promise<boolean>} - whether the token passed verification
 */
export async function test(): Promise<boolean> {
    const test_endpoint = "/user/tokens/verify"
    try {
        const response = await _fetch(test_endpoint, "GET")
        if (!response.ok) {
            console.error(`Cloudflare API token verification failed: ${response.status} ${response.statusText}`)
            return false
        }
        const data: { result: object; success: boolean; errors: any[]; messages: object[] } = await response.json()
        if (data?.success) {
            return true
        }
        return false
    } catch (error) {
        console.error(`Cloudflare API token verification error: ${error}`)
        return false
    }
}

/**
 * List the emails allowed by the Cloudflare Access policy
 *
 * @returns {Promise<string[]>} - a list of user emails (lowercased) currently allowed by the policy's inline
 *   email include rules. Non-email include rules (groups, IdPs, service tokens, etc.) are not user enrollments
 *   and are omitted.
 */
export async function list_users(): Promise<string[]> {
    const policy = await get_policy()
    return (policy.include || []).filter(isEmailRule).map((rule) => rule.email.email.toLowerCase())
}

/**
 * Add a user to the Cloudflare Access policy, if they are not already present
 *
 * @param {string} email - the email address of the user to add
 * @returns {Promise<void>}
 */
export async function add_user(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase()
    // fallback identity emails are reserved placeholders for contributors who cannot sign in
    // (see lib/api/fallback.ts); refuse to enroll one so it can never become an authenticable account
    if (isFallbackEmail(normalized)) {
        throw new Error("Refusing to enroll a reserved fallback identity email in Access")
    }
    const policy = await get_policy()
    const include = policy.include || []
    if (include.some((rule) => isEmailRule(rule) && rule.email.email.toLowerCase() === normalized)) {
        return
    }
    policy.include = [...include, { email: { email: normalized } }]
    await put_policy(policy)
    return
}

/**
 * Remove a user from the Cloudflare Access policy, if they are present
 *
 * @param {string} email - the email address of the user to remove
 * @returns {Promise<void>}
 */
export async function remove_user(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase()
    const policy = await get_policy()
    const include = policy.include || []
    // drop only the inline email rules matching this address (case-insensitive); every other rule is preserved
    const filtered = include.filter((rule) => !(isEmailRule(rule) && rule.email.email.toLowerCase() === normalized))
    if (filtered.length === include.length) {
        return
    }
    policy.include = filtered
    await put_policy(policy)
    return
}
