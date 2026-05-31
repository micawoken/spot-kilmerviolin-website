/**
 * lib/api/access_iam_mgmt.ts
 * 
 * Provides functions relating to granting and revoking access via Cloudflare Access
 * 
 */

import Cloudflare from 'cloudflare';
import { env } from 'cloudflare:workers';

const client = new Cloudflare({
    apiToken: env.CF_ACCESS_TOKEN
})

/**
 * List Cloudflare Access policy users
 * 
 * @returns {Promise<string[]>} - a list of user emails that are currently allowed by the Access policy
 * 
 */
export async function list_users(): Promise<string[]> {
    const users = await client.zeroTrust.gateway.lists.get(env.CF_ACCESS_LIST_ID, {
        "account_id": env.CF_ACCOUNT_ID
    })
    if (!users.items) {
        return [];
    }
    return users.items.map((item) => (item.value ? item.value : "")).filter((item) => item !== "")
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
    await client.zeroTrust.gateway.lists.edit(env.CF_ACCESS_LIST_ID, {
        account_id: env.CF_ACCOUNT_ID,
        append: [{
            value: email,
        }]
    })
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
    await client.zeroTrust.gateway.lists.edit(env.CF_ACCESS_LIST_ID, {
        account_id: env.CF_ACCOUNT_ID,
        remove: [email]
    })
}