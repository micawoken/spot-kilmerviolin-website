/**
 * tests/compositor/catalog.test.ts
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

import { describe, it, expect } from "vitest"

import { buildConfig, RICH_TEXT_PROPS } from "../../src/lib/compositor/catalog"
import type { TokenCatalog } from "../../src/lib/compositor/tokens"

const theme: TokenCatalog = {
    schemaVersion: 1,
    colors: [
        { name: "page-bg", value: "#fff" },
        { name: "accent", value: "#2337ff" }
    ],
    typography: [{ name: "display", family: "serif", size: "2rem", weight: "700", lineHeight: "1.2" }],
    space: [
        { name: "sm", value: "1rem" },
        { name: "md", value: "2rem" }
    ],
    radius: [{ name: "md", value: "0.5rem" }],
    shadows: [{ name: "md", value: "0 1px 3px rgba(0,0,0,0.12)" }],
    borders: [{ name: "default", width: "1px", style: "solid", colorRef: "accent" }],
    breakpoints: [{ name: "md", minWidth: "768px" }]
}

/** The frozen catalog v1 component set (§4.5). A change here is a deliberate version bump. */
const CATALOG_V1 = ["Section", "Columns", "Heading", "RichText", "Image", "Button", "Spacer", "Divider"]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function field(config: any, component: string, prop: string): any {
    return config.components[component].fields[prop]
}

describe("buildConfig — component set", () => {
    it("exposes exactly the frozen catalog v1 components in both targets", () => {
        expect(Object.keys(buildConfig(theme, "editor").components).sort()).toEqual([...CATALOG_V1].sort())
        expect(Object.keys(buildConfig(theme, "build").components).sort()).toEqual([...CATALOG_V1].sort())
    })
})

describe("buildConfig — token-select options track the live theme", () => {
    const config = buildConfig(theme, "editor")
    it("populates a token select from the theme's tokens", () => {
        expect(field(config, "Heading", "typography").options).toEqual([{ label: "display", value: "display" }])
        expect(field(config, "Spacer", "size").options).toEqual([
            { label: "sm", value: "sm" },
            { label: "md", value: "md" }
        ])
    })
    it("prepends a None option to optional token selects", () => {
        expect(field(config, "Section", "background").options[0]).toEqual({ label: "None", value: "" })
        expect(field(config, "Divider", "color").options[0]).toEqual({ label: "None", value: "" })
    })
})

describe("buildConfig — editor vs build richtext field", () => {
    it("uses a native richtext field in the editor target", () => {
        expect(field(buildConfig(theme, "editor"), "RichText", "body").type).toBe("richtext")
    })
    it("uses a passthrough (non-richtext) field in the build target so a stored PT array is not blanked", () => {
        // Puck's useRichtextProps normalizes a PT array to an empty ProseMirror doc; the build path must
        // keep `body` out of that interception so the render receives the raw array (see catalog header).
        expect(field(buildConfig(theme, "build"), "RichText", "body").type).not.toBe("richtext")
    })
    it("attaches the media custom field only in the editor target", () => {
        expect(field(buildConfig(theme, "editor"), "Image", "media").type).toBe("custom")
        expect(field(buildConfig(theme, "build"), "Image", "media").type).not.toBe("custom")
    })
})

describe("RICH_TEXT_PROPS", () => {
    it("registers exactly RichText.body (drives convert.ts walks; contributor rule 5)", () => {
        expect(RICH_TEXT_PROPS).toEqual({ RichText: ["body"] })
    })
})
