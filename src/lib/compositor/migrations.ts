/**
 * lib/compositor/migrations.ts
 *
 * Design-doc envelope validation and schema migration
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
 * One ordered schema transform: rewrites a design at version `from` into version `from + 1`
 */
interface SchemaTransform {
    from: number
    migrate: (puck: PuckData) => PuckData
}

/**
 * Splits `Columns`/`Row`'s single `gap` prop into independent `columnGap`/`rowGap` — the
 * two axes shared one token under the old shape
 */
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

/** Wraps a pre-envelope design value in a version-1 envelope */
function wrapPreEnvelopeDesign(raw: Record<string, unknown>): Record<string, unknown> {
    const isPreEnvelope = raw.schemaVersion === undefined && raw.puck === undefined && Array.isArray(raw.content)
    return isPreEnvelope ? { schemaVersion: 1, puck: raw } : raw
}

/** Assigns a fresh id to every component missing one, recursing into slots, mutates in place.
 */
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

/** Validates and up-migrates a stored design envelope to `CURRENT_SCHEMA_VERSION` */
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
