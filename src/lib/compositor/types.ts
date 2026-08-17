/**
 * lib/compositor/types.ts
 *
 * Core types and structural guards for the visual compositor's stored design documents
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

// Type-only, erased at build - doesn't pull the editor runtime into any bundle like a bare
// `@puckeditor/core` value import would.
import type { Data as PuckData } from "@puckeditor/core"

export type { PuckData }

/** Content collections a template can render entries of */
export type TemplateCollection = "pages" | "posts"

export const TEMPLATE_COLLECTIONS: readonly TemplateCollection[] = ["pages", "posts"]

/** Is `collection` a routable template collection? */
export function isTemplateCollection(collection: string): collection is TemplateCollection {
    return (TEMPLATE_COLLECTIONS as readonly string[]).includes(collection)
}

/** Stored design envelope */
export interface DesignDoc {
    /** Starts at 1, bumped by a `migrations.ts` transform */
    schemaVersion: number
    /** Puck's `{ root, content, … }` tree */
    puck: PuckData
}

/** One stored Puck component: discriminated `type` + props bag. Deliberately structural, not
 * Puck's generic `ComponentData`, so migration/conversion walks traverse any catalog untyped. */
export interface PuckComponent {
    type: string
    props: Record<string, unknown>
}

/** Plain object, not null, not array (`typeof` calls both "object"). */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Structural shape of a stored Puck component - string `type` + props record. Tells a slot array
 * (components) apart from a rich-text array (Portable Text blocks) during a design-data walk. */
export function isPuckComponent(value: unknown): value is PuckComponent {
    return isRecord(value) && typeof value.type === "string" && isRecord(value.props)
}

/** Reads an EmDash boolean field. Use for every one - strict `=== true` silently reads every set
 * flag as false. EmDash serializes true/false to a SQLite INTEGER 1/0 on write, never converts back
 * on read - the API returns the number 1 or 0, not a boolean. No compiler or test net catches this. */
export function cmsBoolean(value: unknown): boolean {
    return value === true || value === 1
}
