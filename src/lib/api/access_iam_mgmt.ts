/**
 * lib/api/access_iam_mgmt.ts
 * 
 * Provides functions relating to granting and revoking access via Cloudflare Access
 * 
 */

import { env } from 'cloudflare:workers';

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
    if (!response.ok) {
        return response.json().then((data) => {
            throw new Error(`Cloudflare API error: ${response.status} ${response.statusText} - ${JSON.stringify(data)}`);
        });
    }
    const response_json: CfResponseInfoGatewayList = await response.json();
    if (response_json.success) {
        return response_json.result?.items || [];
    } else {
        throw new Error(`Cloudflare API error: ${response.status} ${response.statusText} - ${JSON.stringify(response_json)}`);
    }
}

async function test(): Promise<boolean> {
    const test_endpoint = "/tokens/verify"
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

async function cf_gateway_list(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", body?: any): Promise<GatewayItem[]> {
    if (method !== "GET" && method !== "PATCH") throw new Error("Method not implemented for Cloudflare API call")
    if (method === "PATCH" && !body) {
        throw new Error("Body is required for PATCH method")
    } else if (method === "GET" && body) {
        throw new Error("Body is not allowed for GET method")
    }
    const response = await _fetch(cf_gateway_list_endpoint, method, body)
    return _parse(response)
}

/**
 * List Cloudflare Access policy users
 * 
 * @returns {Promise<string[]>} - a list of user emails that are currently allowed by the Access policy
 * 
 */
export async function list_users(): Promise<string[]> {
    const users = await cf_gateway_list("GET")
    return users.map((item) => (item.value ? item.value : "")).filter((item) => item !== "")
}

/**
 * Add a user to the Cloudflare Access policy list, if they are not already present
 * 
 * @param {string} email - the email address of the user to add
 * @returns {Promise<void>}
 */
export async function add_user(email: string): Promise<void> {
    const existing = await list_users();
    if (existing.includes(email)) {
        return;
    }
    await cf_gateway_list("PATCH", {
        append: [
            {
                value: email
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
    const existing = await list_users();
    if (!existing.includes(email)) {
        return;
    }
    await cf_gateway_list("PATCH", {
        remove: [email]
    })
    return;
}