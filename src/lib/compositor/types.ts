/**
 * lib/compositor/types.ts
 *
 * Core types and structural guards for the visual compositor's stored design documents.
 *
 * A design document is the value of a `design_page` item's `design` JSON field (impl
 * §4.2): a versioned envelope wrapping Puck's own data tree. This module owns the envelope
 * type and the small structural guards used to walk that tree (migrations §6.2, PT/ProseMirror
 * conversion §6.4). Per-component prop interfaces live with the Puck config in `catalog.tsx`
 * (§6.3) — they are defined where the catalog that produces them is, not here.
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

// Type-only, erased at build — doesn't pull the editor runtime into any bundle like a bare
// `@puckeditor/core` value import would.
import type { Data as PuckData } from "@puckeditor/core"

export type { PuckData }

/** Content collections a template can render entries of (pivot §3). Lives here, not with the build
 * reader, because `middleware/emdash_access.ts` must bound design_editor reads without importing
 * build code — one list, two consumers, no drift. */
export type TemplateCollection = "pages" | "posts"

export const TEMPLATE_COLLECTIONS: readonly TemplateCollection[] = ["pages", "posts"]

/** Is `collection` a routable template collection? */
export function isTemplateCollection(collection: string): collection is TemplateCollection {
    return (TEMPLATE_COLLECTIONS as readonly string[]).includes(collection)
}

/** Stored design envelope (impl §4.2). `schemaVersion` lives inside the JSON, atomic with the
 * layout — travels through EmDash revisions/rollbacks, not a DB column. */
export interface DesignDoc {
    /** Starts at 1, bumped by a `migrations.ts` transform on any breaking change. */
    schemaVersion: number
    /** Puck's `{ root, content, … }` tree; slot fields nest component arrays inside props. */
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

/** Structural shape of a stored Puck component — string `type` + props record. Tells a slot array
 * (components) apart from a rich-text array (Portable Text blocks) during a design-data walk. */
export function isPuckComponent(value: unknown): value is PuckComponent {
    return isRecord(value) && typeof value.type === "string" && isRecord(value.props)
}

/** Reads an EmDash boolean field. Use for every one — strict `=== true` silently reads every set
 * flag as false. EmDash serializes true/false to a SQLite INTEGER 1/0 on write, never converts back
 * on read — the API returns the number 1 or 0, not a boolean. No compiler or test net catches this. */
export function cmsBoolean(value: unknown): boolean {
    return value === true || value === 1
}
