/**
 * lib/compositor/convert.ts
 *
 * Portable Text ↔ ProseMirror conversion at the design-doc boundary (impl §4.4). Design docs store
 * rich text as Portable Text (the same format as `pages`, so the Phase 2 migration is lossless and
 * output parity is one renderer's concern). Puck's built-in richtext field edits ProseMirror
 * (Tiptap). So on load we convert every rich-text prop PT → ProseMirror; on save, the inverse.
 *
 * The walk is driven by a registry (component type → rich-text prop names) supplied by the caller.
 * In Phase 1 that registry is `catalog.tsx`'s `RICH_TEXT_PROPS` (§6.3, exactly `RichText.body`);
 * passing it in keeps this module decoupled from the catalog and unit-testable on its own. Both
 * walks recurse into slot contents so a rich-text prop nested inside a Section/Columns slot is
 * reached. Conversion uses emdash's public converters; per spike (d) they regenerate every `_key`
 * on each PT pass and default a link markDef's `blank` to false — callers must diff semantically and
 * never hold `_key` references across an edit session.
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

// The converters must run in the browser (the editor island loads and saves rich text client-side), but
// emdash's package entry pulls its server graph (astro:config/server, kysely, node:async_hooks) in with
// it, and `emdash/client` does not re-export them. The converter modules themselves are pure — no
// platform APIs, only type-only imports — so `#emdash/converters` (package.json `imports`) resolves
// straight to that source for Vite, Vitest, and tsc alike, keeping emdash the single source of truth
// rather than vendoring ~900 lines that would drift from its Portable Text schema. It reaches past
// emdash's export map, so an upgrade that moves the file breaks the build loudly; the durable fix is for
// emdash to export the converters from `emdash/client`.
import { portableTextToProsemirror, prosemirrorToPortableText } from "#emdash/converters"
import type { PortableTextBlock, ProseMirrorDocument } from "emdash"

import type { DesignDoc, PuckData } from "./types"
import { isPuckComponent, isRecord } from "./types"

/**
 * Registry mapping a component `type` to the names of its rich-text props. Supplied by the catalog
 * (§6.3). A component type absent from the registry has no rich-text props.
 */
export type RichTextPropRegistry = Record<string, readonly string[]>

/** A transform applied to one rich-text prop value during a walk (PT → ProseMirror or the inverse). */
type PropTransform = (value: unknown) => unknown

/** PT block array → ProseMirror document. Non-array values pass through (defensive against double conversion). */
function portableTextToEditor(value: unknown): unknown {
    return Array.isArray(value) ? portableTextToProsemirror(value as PortableTextBlock[]) : value
}

/** ProseMirror document → PT block array. Non-doc values pass through (defensive against double conversion). */
function editorToPortableText(value: unknown): unknown {
    return isRecord(value) && value.type === "doc" ? prosemirrorToPortableText(value as unknown as ProseMirrorDocument) : value
}

/** Walks an array of components in place, converting rich-text props and recursing into slots. */
function walkComponents(components: unknown[], registry: RichTextPropRegistry, transform: PropTransform): void {
    for (const component of components) {
        if (isPuckComponent(component)) {
            walkProps(component.type, component.props, registry, transform)
        }
    }
}

/**
 * Walks one component's props in place. A prop named in the registry for this type is a rich-text
 * prop and is transformed; any other array-valued prop is treated as a slot and recursed into. A
 * rich-text prop's value is a PT/ProseMirror structure (never component-shaped), so the two branches
 * never overlap.
 */
function walkProps(
    type: string,
    props: Record<string, unknown>,
    registry: RichTextPropRegistry,
    transform: PropTransform
): void {
    const richTextProps = registry[type] ?? []
    for (const key of Object.keys(props)) {
        if (richTextProps.includes(key)) {
            props[key] = transform(props[key])
        } else if (Array.isArray(props[key])) {
            walkComponents(props[key] as unknown[], registry, transform)
        }
    }
}

/** Deep-clones a design doc and applies `transform` to every rich-text prop reached by the walk. */
function mapRichText(doc: DesignDoc, registry: RichTextPropRegistry, transform: PropTransform): DesignDoc {
    const puck = structuredClone(doc.puck) as PuckData & { root?: unknown; content?: unknown; zones?: unknown }

    if (Array.isArray(puck.content)) {
        walkComponents(puck.content, registry, transform)
    }
    // The root can carry slot fields inside its props; walk them (no rich-text props on root in v1).
    if (isRecord(puck.root) && isRecord(puck.root.props)) {
        walkProps("root", puck.root.props, registry, transform)
    }
    // Legacy DropZone data: a map of zone name → component array. Slots supersede it, but tolerate it.
    if (isRecord(puck.zones)) {
        for (const zone of Object.values(puck.zones)) {
            if (Array.isArray(zone)) walkComponents(zone, registry, transform)
        }
    }

    return { schemaVersion: doc.schemaVersion, puck: puck as PuckData }
}

/**
 * Load boundary: returns a copy of the design doc with every rich-text prop converted from stored
 * Portable Text to the ProseMirror form Puck's richtext field edits. Input is not mutated.
 *
 * @param {DesignDoc} doc - the stored design document (rich text as Portable Text)
 * @param {RichTextPropRegistry} registry - component type → rich-text prop names
 * @returns {DesignDoc} - a copy whose rich-text props hold ProseMirror documents
 */
export function designToEditorForm(doc: DesignDoc, registry: RichTextPropRegistry): DesignDoc {
    return mapRichText(doc, registry, portableTextToEditor)
}

/**
 * Save boundary: returns a copy of the editor's working doc with every rich-text prop converted
 * from ProseMirror back to stored Portable Text. Input is not mutated.
 *
 * @param {DesignDoc} working - the editor working document (rich text as ProseMirror)
 * @param {RichTextPropRegistry} registry - component type → rich-text prop names
 * @returns {DesignDoc} - a copy whose rich-text props hold Portable Text block arrays
 */
export function editorFormToDesign(working: DesignDoc, registry: RichTextPropRegistry): DesignDoc {
    return mapRichText(working, registry, editorToPortableText)
}
