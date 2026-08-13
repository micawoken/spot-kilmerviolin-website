/**
 * lib/compositor/migrations.ts
 *
 * Design-doc envelope validation and schema migration (impl §4.2). `migrateDesign` runs on every
 * read, editor and build: validates the envelope, applies ordered transforms `v → v+1` up to
 * `CURRENT_SCHEMA_VERSION`, throws an actionable error on malformed input or an unknown version.
 * Explicit failure is the point — a bad design fails the build loudly rather than rendering wrong.
 *
 * Contributor rule (impl §9.2): never rename or remove a component or prop without adding a
 * transform here and bumping the version.
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

import type { DesignDoc, PuckData } from "./types"
import { isPuckComponent, isRecord } from "./types"

/** The design schema version this build understands. Bump when adding a transform below. */
export const CURRENT_SCHEMA_VERSION = 2

/**
 * One ordered schema transform: rewrites a design at version `from` into version `from + 1`. Only
 * the Puck tree is transformed; `migrateDesign` manages the `schemaVersion` field itself.
 *
 * When a breaking catalog/prop change lands, append `{ from: N, migrate }` here and bump
 * CURRENT_SCHEMA_VERSION to N + 1. The list must stay contiguous and sorted by `from`.
 */
interface SchemaTransform {
    from: number
    migrate: (puck: PuckData) => PuckData
}

/** v1 → v2: splits `Columns`/`Row`'s single `gap` prop into independent `columnGap`/`rowGap` — the
 * two axes shared one token under the old shape. `gap: "<name>"` becomes `columnGap`/`rowGap:
 * "<name>"`, so rendered spacing is unchanged until the owner splits them apart in the editor. */
function splitColumnsRowGap(components: unknown[]): void {
    for (const component of components) {
        if (!isPuckComponent(component)) continue
        if ((component.type === "Columns" || component.type === "Row") && typeof component.props.gap === "string") {
            component.props.columnGap = component.props.gap
            component.props.rowGap = component.props.gap
            delete component.props.gap
        }
        for (const value of Object.values(component.props)) {
            if (Array.isArray(value)) splitColumnsRowGap(value)
        }
    }
}

const TRANSFORMS: SchemaTransform[] = [
    {
        from: 1,
        migrate: (puck) => {
            if (Array.isArray(puck.content)) splitColumnsRowGap(puck.content as unknown[])
            return puck
        }
    }
]

/** A minimal empty design envelope, for the editor to seed a brand-new `design_page`. */
export function emptyDesignDoc(): DesignDoc {
    return { schemaVersion: CURRENT_SCHEMA_VERSION, puck: { root: {}, content: [] } as unknown as PuckData }
}

/** Wraps a pre-envelope design value in a version-1 envelope; passes anything else through unchanged.
 * An early build's editor autosaved the bare Puck tree (`{root, content}`, no `schemaVersion`)
 * instead of the envelope — layout intact, envelope missing. Read as version 1 (the only version that
 * build could have written); the editor's next save rewrites it in envelope form. Shape is
 * unambiguous: an envelope always carries `schemaVersion`/`puck`, a Puck tree always carries
 * `content`. Drop this once no pre-envelope documents remain in the CMS. */
function wrapPreEnvelopeDesign(raw: Record<string, unknown>): Record<string, unknown> {
    const isPreEnvelope = raw.schemaVersion === undefined && raw.puck === undefined && Array.isArray(raw.content)
    return isPreEnvelope ? { schemaVersion: 1, puck: raw } : raw
}

/** Assigns a fresh id to every component missing one, recursing into slots, mutates in place.
 * Puck's editor store indexes every node BY `props.id` (`WithId<Props>` — required, not optional, in
 * `@puckeditor/core`'s own types) — an id-less component doesn't just lack metadata, it collides with
 * every other id-less sibling on the same index key, corrupting the store and driving the editor into
 * an infinite re-render loop that OOMs the tab. `editorFormToDesign` always writes real ids, so this
 * only ever fires on a document written outside the editor (e.g. `tools/seed-entity-templates.mjs`) —
 * but runs unconditionally so ANY id-less write, present or future, self-heals on next read instead of
 * corrupting the editor again. */
function ensureComponentIds(components: unknown[]): void {
    for (const component of components) {
        if (!isPuckComponent(component)) continue
        if (typeof component.props.id !== "string" || component.props.id === "") {
            component.props.id = crypto.randomUUID()
        }
        for (const value of Object.values(component.props)) {
            if (Array.isArray(value)) ensureComponentIds(value)
        }
    }
}

/** Validates and up-migrates a stored design envelope to `CURRENT_SCHEMA_VERSION`. Throws (with an
 * actionable message) on a non-object `raw`, a missing numeric `schemaVersion`/object `puck`, a
 * version newer than this build understands, or a version with no path to the current one. */
export function migrateDesign(raw: unknown): DesignDoc {
    if (!isRecord(raw)) {
        throw new Error("Invalid design document: expected an object envelope")
    }
    const envelope = wrapPreEnvelopeDesign(raw)
    if (typeof envelope.schemaVersion !== "number" || !Number.isInteger(envelope.schemaVersion)) {
        throw new Error("Invalid design document: missing integer 'schemaVersion'")
    }
    if (!isRecord(envelope.puck) || !Array.isArray((envelope.puck as Record<string, unknown>).content)) {
        throw new Error("Invalid design document: 'puck' must be an object with a 'content' array")
    }
    if (envelope.schemaVersion > CURRENT_SCHEMA_VERSION) {
        throw new Error(
            `Design document schemaVersion ${envelope.schemaVersion} is newer than this build supports ` +
                `(${CURRENT_SCHEMA_VERSION}); deploy the matching code before reading it`
        )
    }
    if (envelope.schemaVersion < 1) {
        throw new Error(`Invalid design document: schemaVersion ${envelope.schemaVersion} is below the minimum of 1`)
    }

    let version = envelope.schemaVersion
    let puck = envelope.puck as PuckData
    while (version < CURRENT_SCHEMA_VERSION) {
        const transform = TRANSFORMS.find((candidate) => candidate.from === version)
        if (!transform) {
            throw new Error(`No migration path from design schemaVersion ${version} to ${CURRENT_SCHEMA_VERSION}`)
        }
        puck = transform.migrate(puck)
        version += 1
    }

    if (Array.isArray(puck.content)) ensureComponentIds(puck.content)

    return { schemaVersion: CURRENT_SCHEMA_VERSION, puck }
}
