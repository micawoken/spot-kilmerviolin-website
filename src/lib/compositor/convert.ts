/**
 * lib/compositor/convert.ts
 *
 * Portable Text <-> ProseMirror conversion at the design-doc boundary
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

import { generateJSON } from "@tiptap/html"
import { portableTextToProsemirror, prosemirrorToPortableText } from "#emdash/converters"
import type { PortableTextBlock, ProseMirrorDocument } from "emdash"

import { RICH_TEXT_EXTENSIONS } from "./richtext-extensions"
import type { DesignDoc, PuckData } from "./types"
import { isPuckComponent, isRecord } from "./types"

/** A link's explicit "Opens in" choice, href-keyed - see the module header for why href, not occurrence. */
type LinkTargetMap = Map<string, "_self" | "_blank">

/** Collects the explicit `target` already on each link markDef, keyed by href (first occurrence in
 *  document order wins). A markDef with no `target` (never authored, or "Automatic") contributes no
 *  entry - the mirror of {@link collectPmLinkTargets}. */
function collectPtLinkTargets(blocks: unknown): LinkTargetMap {
    const targets: LinkTargetMap = new Map()
    if (!Array.isArray(blocks)) return targets
    for (const block of blocks) {
        if (!isRecord(block) || !Array.isArray(block.markDefs)) continue
        for (const def of block.markDefs) {
            if (!isRecord(def) || def._type !== "link") continue
            const href = typeof def.href === "string" ? def.href : ""
            const target = def.target
            if (href !== "" && (target === "_self" || target === "_blank") && !targets.has(href)) {
                targets.set(href, target)
            }
        }
    }
    return targets
}

/** Recursively sets every link mark's `target` attr from `targets` (or `null` when its href is absent),
 *  overwriting whatever EmDash's PT->ProseMirror conversion derived from the untrustworthy `blank` flag */
function applyPmLinkTargets(nodes: unknown[], targets: LinkTargetMap): void {
    for (const node of nodes) {
        if (!isRecord(node)) continue
        if (Array.isArray(node.marks)) {
            for (const mark of node.marks) {
                if (!isRecord(mark) || mark.type !== "link" || !isRecord(mark.attrs)) continue
                const href = typeof mark.attrs.href === "string" ? mark.attrs.href : ""
                mark.attrs.target = targets.get(href) ?? null
            }
        }
        if (Array.isArray(node.content)) applyPmLinkTargets(node.content, targets)
    }
}

/** Collects the live `target` attr of each link mark in a ProseMirror doc, keyed by href (first
 *  occurrence in document order wins) - the mirror of {@link collectPtLinkTargets}, read from the editor
 *  state instead of stored markDefs. */
function collectPmLinkTargets(nodes: unknown[], targets: LinkTargetMap = new Map()): LinkTargetMap {
    for (const node of nodes) {
        if (!isRecord(node)) continue
        if (Array.isArray(node.marks)) {
            for (const mark of node.marks) {
                if (!isRecord(mark) || mark.type !== "link" || !isRecord(mark.attrs)) continue
                const href = typeof mark.attrs.href === "string" ? mark.attrs.href : ""
                const target = mark.attrs.target
                if (href !== "" && (target === "_self" || target === "_blank") && !targets.has(href)) {
                    targets.set(href, target)
                }
            }
        }
        if (Array.isArray(node.content)) collectPmLinkTargets(node.content, targets)
    }
    return targets
}

/** Applies `targets` onto the resulting PT markDefs, keyed by href */
function applyPtLinkTargets(blocks: unknown, targets: LinkTargetMap): void {
    if (!Array.isArray(blocks)) return
    for (const block of blocks) {
        if (!isRecord(block) || !Array.isArray(block.markDefs)) continue
        for (const def of block.markDefs) {
            if (!isRecord(def) || def._type !== "link") continue
            const href = typeof def.href === "string" ? def.href : ""
            const target = targets.get(href)
            if (target) {
                def.target = target
            } else {
                delete def.target
            }
        }
    }
}

/**
 * Registry mapping a component `type` to the names of its rich-text props
 */
export type RichTextPropRegistry = Record<string, readonly string[]>

/** A transform applied to one rich-text prop value during a walk (PT -> ProseMirror or the inverse). */
type PropTransform = (value: unknown) => unknown

/** PT block array -> ProseMirror document */
function portableTextToEditor(value: unknown): unknown {
    if (!Array.isArray(value)) return value
    const targets = collectPtLinkTargets(value)
    const doc = portableTextToProsemirror(value as PortableTextBlock[])
    applyPmLinkTargets(doc.content, targets)
    return doc
}

/** ProseMirror document -> PT block array */
function editorToPortableText(value: unknown): unknown {
    const doc: ProseMirrorDocument | null =
        typeof value === "string"
            ? (generateJSON(value, RICH_TEXT_EXTENSIONS) as unknown as ProseMirrorDocument)
            : isRecord(value) && value.type === "doc"
              ? (value as unknown as ProseMirrorDocument)
              : null
    if (doc === null) return value

    const targets = collectPmLinkTargets(doc.content)
    const blocks = prosemirrorToPortableText(doc)
    applyPtLinkTargets(blocks, targets)
    return blocks
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
 * Walks one component's props in place
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
    // Legacy DropZone data: a map of zone name -> component array. Slots supersede it, but tolerate it.
    if (isRecord(puck.zones)) {
        for (const zone of Object.values(puck.zones)) {
            if (Array.isArray(zone)) walkComponents(zone, registry, transform)
        }
    }

    return { schemaVersion: doc.schemaVersion, puck: puck as PuckData }
}

/** Load boundary: copy of the design doc with every rich-text prop converted PT -> ProseMirror. Input
 * not mutated. */
export function designToEditorForm(doc: DesignDoc, registry: RichTextPropRegistry): DesignDoc {
    return mapRichText(doc, registry, portableTextToEditor)
}

/** Save boundary: copy of the editor's working doc with every rich-text prop converted ProseMirror ->
 * PT. Input not mutated. */
export function editorFormToDesign(working: DesignDoc, registry: RichTextPropRegistry): DesignDoc {
    return mapRichText(working, registry, editorToPortableText)
}
