/**
 * lib/api/github_repo_mgmt.ts
 *
 * Provides functions relating to granting and revoking GitHub repository write access for the repository
 * powering the external content CMS (Pages CMS). It is the GitHub counterpart to access_iam_mgmt.ts:
 * a thin module over the GitHub REST API that resolves accounts and adds/removes repository collaborators
 * using a secret admin token (a fine-grained PAT scoped to this single repository with Administration:
 * Read and write).
 *
 * Binding to a GitHub account is ID-primary: a username is resolved to its immutable numeric account id at
 * link time, and authorization later resolves the id back to the account's *current* login before adding a
 * collaborator. This means a username that was reassigned to a different account is denied write access,
 * while a legitimate self-rename is followed automatically. See docs/dev/github-linkage.md.
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

const gh_api_base = "https://api.github.com"

/** A resolved GitHub account: its immutable numeric id and current login (username). */
export interface GithubAccount {
    id: number
    login: string
}

/**
 * Issues a request to the GitHub REST API with the required headers. GitHub rejects requests without a
 * User-Agent (403), and pins the API version and JSON media type per its recommendations. The admin token
 * lives only in the Authorization header; it is never logged.
 *
 * @param path - the API path (beginning with "/")
 * @param method - the HTTP method
 * @param body - an optional JSON body
 * @returns the raw Response
 */
function _fetch(path: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<Response> {
    return fetch(gh_api_base + path, {
        method,
        headers: {
            Authorization: `Bearer ${env.GITHUB_ADMIN_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            // GitHub requires a User-Agent; identify the integration by repository name
            "User-Agent": String(env.GITHUB_REPO_NAME),
            ...(body !== undefined ? { "Content-Type": "application/json" } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
    })
}

/** The configured repository owner (the account that owns the repo and can never be deauthorized). */
export function repoOwner(): string {
    return String(env.GITHUB_REPO_OWNER)
}

/** Whether a login is the repository owner (case-insensitive); the owner is protected from deauthorization. */
export function isOwner(login: string): boolean {
    return login.trim().toLowerCase() === repoOwner().trim().toLowerCase()
}

/**
 * Raises a uniform error for an unexpected (non-handled) GitHub response, surfacing the status and body
 * so the cause is identifiable upstream. The token is in headers only, so the body is safe to include.
 */
async function _raise(operation: string, response: Response): Promise<never> {
    const text = await response.text().catch(() => "")
    throw new Error(`GitHub API error during ${operation}: ${response.status} ${response.statusText} - ${text}`)
}

/**
 * Resolves a GitHub username to its account (id + canonical login) via GET /users/{username}.
 *
 * @param username - the candidate username
 * @returns the resolved account, or null when no such user exists (404)
 */
export async function resolveByUsername(username: string): Promise<GithubAccount | null> {
    const response = await _fetch(`/users/${encodeURIComponent(username.trim())}`, "GET")
    if (response.status === 404) {
        return null
    }
    if (!response.ok) {
        return _raise("resolveByUsername", response)
    }
    const data = (await response.json()) as { id?: number; login?: string }
    if (typeof data.id !== "number" || typeof data.login !== "string") {
        throw new Error("GitHub API error during resolveByUsername: malformed user payload")
    }
    return { id: data.id, login: data.login }
}

/**
 * Resolves a GitHub numeric account id to its *current* account (id + canonical login) via
 * GET /user/{account_id}. This is the authoritative resolution used at authorization time (ID-primary).
 *
 * @param id - the immutable GitHub account id
 * @returns the resolved account, or null when no such account exists (404)
 */
export async function resolveById(id: number): Promise<GithubAccount | null> {
    const response = await _fetch(`/user/${encodeURIComponent(String(id))}`, "GET")
    if (response.status === 404) {
        return null
    }
    if (!response.ok) {
        return _raise("resolveById", response)
    }
    const data = (await response.json()) as { id?: number; login?: string }
    if (typeof data.id !== "number" || typeof data.login !== "string") {
        throw new Error("GitHub API error during resolveById: malformed user payload")
    }
    return { id: data.id, login: data.login }
}

/** The repository path prefix for collaborator/invitation endpoints. */
function _repoPath(): string {
    return `/repos/${encodeURIComponent(repoOwner())}/${encodeURIComponent(String(env.GITHUB_REPO_NAME))}`
}

/**
 * Whether a login currently has repository write access — either an accepted collaborator (the
 * collaborators check returns 204) or a still-pending invitation for that login.
 *
 * @param login - the GitHub login to check
 * @returns true if the login is a collaborator or has a pending invitation
 */
export async function isAuthorized(login: string): Promise<boolean> {
    const response = await _fetch(`${_repoPath()}/collaborators/${encodeURIComponent(login.trim())}`, "GET")
    if (response.status === 204) {
        return true
    }
    if (response.status === 404) {
        // not an accepted collaborator; a pending invitation still counts as authorized
        return (await _findPendingInvitation(login)) !== null
    }
    return _raise("isAuthorized", response)
}

/** A pending repository invitation: its id and the invited login. */
interface PendingInvitation {
    id: number
    login: string
}

/**
 * Finds a pending repository invitation for the given login (case-insensitive), or null if none exists.
 * Used to cancel an outstanding invitation on removal and to treat a pending invite as authorized.
 */
async function _findPendingInvitation(login: string): Promise<PendingInvitation | null> {
    const response = await _fetch(`${_repoPath()}/invitations`, "GET")
    if (!response.ok) {
        return _raise("listInvitations", response)
    }
    const data = (await response.json()) as { id?: number; invitee?: { login?: string } | null }[]
    const target = login.trim().toLowerCase()
    for (const invitation of data) {
        const invitee = invitation.invitee?.login
        if (typeof invitation.id === "number" && typeof invitee === "string" && invitee.toLowerCase() === target) {
            return { id: invitation.id, login: invitee }
        }
    }
    return null
}

/**
 * Grants repository write access to a login by adding it as a collaborator with the "push" permission. For
 * an outside account this creates an invitation the user must accept; GitHub returns 201 (invitation
 * created) or 204 (already a collaborator). Idempotent: re-adding an existing collaborator is a no-op.
 *
 * @param login - the GitHub login to authorize
 */
export async function addCollaborator(login: string): Promise<void> {
    const response = await _fetch(`${_repoPath()}/collaborators/${encodeURIComponent(login.trim())}`, "PUT", {
        permission: "push"
    })
    // 201 = invitation created; 204 = already a collaborator (no change)
    if (response.status === 201 || response.status === 204) {
        return
    }
    return _raise("addCollaborator", response)
}

/**
 * Revokes repository write access from a login: removes it as a collaborator and cancels any pending
 * invitation it still holds. Idempotent: a login with no access and no invitation resolves to a no-op.
 *
 * @param login - the GitHub login to deauthorize
 */
export async function removeCollaborator(login: string): Promise<void> {
    const response = await _fetch(`${_repoPath()}/collaborators/${encodeURIComponent(login.trim())}`, "DELETE")
    // 204 = removed; 404 = was not a collaborator (still proceed to clear any pending invitation)
    if (response.status !== 204 && response.status !== 404) {
        return _raise("removeCollaborator", response)
    }
    const invitation = await _findPendingInvitation(login)
    if (invitation !== null) {
        const cancel = await _fetch(`${_repoPath()}/invitations/${encodeURIComponent(String(invitation.id))}`, "DELETE")
        if (cancel.status !== 204 && cancel.status !== 404) {
            return _raise("cancelInvitation", cancel)
        }
    }
}

/**
 * Verifies that the configured GitHub admin token can reach the repository; useful for diagnosing auth
 * failures. Mirrors access_iam_mgmt.test().
 *
 * @returns whether the token could read the repository
 */
export async function test(): Promise<boolean> {
    try {
        const response = await _fetch(_repoPath(), "GET")
        if (!response.ok) {
            console.error(`GitHub API token verification failed: ${response.status} ${response.statusText}`)
            return false
        }
        return true
    } catch (error) {
        console.error(`GitHub API token verification error: ${error}`)
        return false
    }
}
