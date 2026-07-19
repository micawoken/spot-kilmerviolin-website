/**
 * lib/api/analytics.ts
 *
 * Reads a Cloudflare Web Analytics (RUM) summary for the admin site-analytics view, over Cloudflare's
 * GraphQL Analytics API. Web Analytics itself is the public-page beacon (see PublicHead.astro) — this
 * module is only the admin-side read of the data that beacon reports, so the numbers can be viewed in
 * admin instead of a separate Cloudflare dashboard link.
 *
 * Requires CF_ANALYTICS_SITE_TAG (wrangler var) and CF_ANALYTICS_TOKEN (secret, scoped to "Account
 * Analytics: Read" — see DEPLOY.md) to be set. Either being unset is not an error: it means Web Analytics
 * has not been provisioned yet, so getWebAnalyticsSummary returns an "unconfigured" result and the admin
 * page renders a "not configured" message instead of failing.
 *
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
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

const graphql_endpoint = "https://api.cloudflare.com/client/v4/graphql"

export type AnalyticsRange = "1d" | "7d" | "30d"

const RANGE_DAYS: Record<AnalyticsRange, number> = { "1d": 1, "7d": 7, "30d": 30 }

export type AnalyticsSummary =
    | { ok: true; range: AnalyticsRange; pageviews: number; visits: number }
    | { ok: false; reason: "unconfigured" }
    | { ok: false; reason: "error"; message: string }

const query = `
    query WebAnalyticsSummary($accountTag: string!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject) {
        viewer {
            accounts(filter: { accountTag: $accountTag }) {
                rumPageloadEventsAdaptiveGroups(limit: 1, filter: $filter) {
                    count
                    sum { visits }
                }
            }
        }
    }
`

/**
 * Reads total pageviews and visits recorded by the Web Analytics beacon over the given trailing window
 *
 * @param {AnalyticsRange} range - how far back to summarize: "1d", "7d", or "30d"
 * @returns {Promise<AnalyticsSummary>} the summary, or a reason the read could not be performed
 */
export async function getWebAnalyticsSummary(range: AnalyticsRange): Promise<AnalyticsSummary> {
    const siteTag = env.CF_ANALYTICS_SITE_TAG
    const token = env.CF_ANALYTICS_TOKEN
    if (!siteTag || !token) {
        return { ok: false, reason: "unconfigured" }
    }

    const end = new Date()
    const start = new Date(end.getTime() - RANGE_DAYS[range] * 86_400_000)
    const variables = {
        accountTag: env.CF_ACCOUNT_ID,
        filter: {
            siteTag,
            datetime_geq: start.toISOString(),
            datetime_leq: end.toISOString()
        }
    }

    let response: Response
    try {
        response = await fetch(graphql_endpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: JSON.stringify({ query, variables })
        })
    } catch (error) {
        return { ok: false, reason: "error", message: error instanceof Error ? error.message : String(error) }
    }

    // read as text first: error responses from the Cloudflare edge are not always JSON
    const response_text = await response.text()
    if (!response.ok) {
        return { ok: false, reason: "error", message: `Cloudflare API error: ${response.status} ${response.statusText} - ${response_text}` }
    }
    const parsed: CfGraphqlAnalyticsResponse = JSON.parse(response_text)
    if (parsed.errors && parsed.errors.length > 0) {
        return { ok: false, reason: "error", message: parsed.errors.map((error) => error.message).join("; ") }
    }
    const group = parsed.data?.viewer?.accounts?.[0]?.rumPageloadEventsAdaptiveGroups?.[0]
    return {
        ok: true,
        range,
        pageviews: group?.count ?? 0,
        visits: group?.sum?.visits ?? 0
    }
}
