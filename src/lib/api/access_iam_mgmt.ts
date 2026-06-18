/**
 * lib/api/access_iam_mgmt.ts
 * 
 * Provides functions relating to granting and revoking access via Cloudflare Access
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

import { env } from 'cloudflare:workers';
import { isFallbackEmail } from './fallback';

const cf_api_base = "https://api.cloudflare.com/client/v4"
const cf_gateway_list_endpoint = "/accounts/{account_id}/gateway/lists/{list_id}"


function _fetch(endpoint: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", body?: any): Promise<Response> {
    // Implementation for fetching from Cloudflare API
    return fetch(cf_api_base + endpoint.replace("{account_id}", env.CF_ACCOUNT_ID).replace("{list_id}", env.CF_ACCESS_LIST_ID), {
        method: method,
        headers: {
            "Authorization": `Bearer ${env.CF_ACCESS_TOKEN}`,
            "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
    })
}

async function _parse(response: Response): Promise<GatewayItem[]> {
    // read as text first: error responses (e.g. from the Cloudflare edge) are not always JSON
    const response_text = await response.text();
    if (!response.ok) {
        throw new Error(`Cloudflare API error: ${response.status} ${response.statusText} - ${response_text}`);
    }
    const response_json: CfResponseInfoGatewayList = JSON.parse(response_text);
    if (response_json.success) {
        return response_json.result?.items || [];
    } else {
        throw new Error(`Cloudflare API error: ${JSON.stringify(response_json.errors)}`);
    }
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
            console.error(`Cloudflare API token verification failed: ${response.status} ${response.statusText}`);
            return false;
        }
        const data: {result: object, success: boolean, errors: any[], messages: object[]} = await response.json();
        if (data?.success) {
            return true;
        }
        return false
    } catch (error) {
        console.error(`Cloudflare API token verification error: ${error}`);
        return false;
    }
}

async function cf_gateway_list(method: "GET" | "PATCH", body?: any): Promise<GatewayItem[]> {
    if (method === "PATCH" && !body) {
        throw new Error("Body is required for PATCH method")
    } else if (method === "GET" && body) {
        throw new Error("Body is not allowed for GET method")
    }
    const response = await _fetch(cf_gateway_list_endpoint, method, body)
    return _parse(response)
}

// returns list values exactly as stored, for operations (e.g. remove) that must match literally
async function _list_raw(): Promise<string[]> {
    const users = await cf_gateway_list("GET")
    return users.map((item) => (item.value ? item.value : "")).filter((item) => item !== "")
}

/**
 * List Cloudflare Access policy users
 *
 * @returns {Promise<string[]>} - a list of user emails (lowercased) that are currently allowed by the Access policy
 *
 */
export async function list_users(): Promise<string[]> {
    const users = await _list_raw()
    return users.map((value) => value.toLowerCase())
}

/**
 * Add a user to the Cloudflare Access policy list, if they are not already present
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
    const existing = await list_users();
    if (existing.includes(normalized)) {
        return;
    }
    await cf_gateway_list("PATCH", {
        append: [
            {
                value: normalized
            }
        ]
    })
    return;
}

/**
 * Remove a user from the Cloudflare Access policy list, if they are present
 *
 * @param {string} email - the email address of the user to remove
 * @returns {Promise<void>}
 */
export async function remove_user(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase()
    // removal matches stored values literally, so collect the exact entries that match case-insensitively
    const matches = (await _list_raw()).filter((value) => value.toLowerCase() === normalized)
    if (matches.length === 0) {
        return;
    }
    await cf_gateway_list("PATCH", {
        remove: matches
    })
    return;
}