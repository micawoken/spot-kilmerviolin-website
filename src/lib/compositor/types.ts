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

// Type-only import: erased at build, so referencing Puck's data type here does not pull the
// editor runtime into any bundle (the spike's "bare @puckeditor/core import drags the editor in"
// gotcha applies to value imports, not `import type`).
import type { Data as PuckData } from "@puckeditor/core"

export type { PuckData }

/**
 * The content collections a template can render entries of (pivot §3).
 *
 * Lives here, not with the build reader that validates against it, because the /_emdash authorization gate
 * (middleware/emdash_access.ts) must bound the collections a design_editor may READ for the preview-entry
 * picker and the outlet field pickers — and middleware cannot import a build module without pulling
 * build-only code into the worker runtime. One list, two consumers, no drift.
 */
export type TemplateCollection = "pages" | "posts"

export const TEMPLATE_COLLECTIONS: readonly TemplateCollection[] = ["pages", "posts"]

/**
 * Whether a string names a collection a template can render (and therefore one the design system is
 * allowed to read entries and field schemas from).
 *
 * @param {string} collection - the candidate collection slug
 * @returns {boolean} - true when it is a routable template collection
 */
export function isTemplateCollection(collection: string): collection is TemplateCollection {
    return (TEMPLATE_COLLECTIONS as readonly string[]).includes(collection)
}

/**
 * The stored design envelope (impl §4.2). `schemaVersion` lives inside this JSON — atomic with
 * the layout it describes, so it travels through EmDash revisions/rollbacks — not as a DB column.
 */
export interface DesignDoc {
    /** Design schema version; starts at 1, bumped by a `migrations.ts` transform on any breaking change. */
    schemaVersion: number
    /** Puck's `{ root, content, … }` tree. Slot fields nest component arrays inside component props. */
    puck: PuckData
}

/**
 * A single Puck component instance as it appears in stored design data: a discriminated `type`
 * plus a props bag. Slot fields are arrays of these nested inside a parent's props. Deliberately
 * structural (not Puck's deeply-generic `ComponentData`) so the migration and conversion walks can
 * traverse arbitrary catalogs without the catalog's compile-time prop types.
 */
export interface PuckComponent {
    type: string
    props: Record<string, unknown>
}

/**
 * Whether a value is a plain object (a record). Rejects null and arrays, which `typeof` calls "object".
 *
 * @param {unknown} value - the candidate
 * @returns {boolean} - true if value is a non-null, non-array object
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Whether a value has the structural shape of a stored Puck component (a string `type` and a
 * props record). Used to tell a slot array (of components) apart from a rich-text prop array
 * (of Portable Text blocks) when walking design data.
 *
 * @param {unknown} value - the candidate
 * @returns {boolean} - true if value looks like a { type, props } component
 */
export function isPuckComponent(value: unknown): value is PuckComponent {
    return isRecord(value) && typeof value.type === "string" && isRecord(value.props)
}

/**
 * Reads a boolean field off an EmDash API payload. Use this for EVERY EmDash boolean — a strict
 * `value === true` check is WRONG and silently reads every set flag as false.
 *
 * EmDash maps a boolean field to a SQLite INTEGER column (`schema/types.ts`) and serializes true/false
 * to 1/0 on write, but its `deserializeValue` never converts them back (`schema/zod-generator.ts`). So a
 * field written as `true` comes back over the API as the NUMBER 1, and one written as `false` as 0 —
 * which is also why 0 must not be treated as merely falsy-and-therefore-fine: the round trip changes the
 * type, not just the value, and nothing in a build, a type check, or a fixture will say so.
 *
 * @param {unknown} value - the raw field value from an EmDash API payload
 * @returns {boolean} - true when the field is set, for both the 1/0 and the true/false encodings
 */
export function cmsBoolean(value: unknown): boolean {
    return value === true || value === 1
}
