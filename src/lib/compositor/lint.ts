/**
 * lib/compositor/lint.ts
 *
 * Design lint, rules v1 (impl §6.7). One pure pass over a stored design document, shared by the
 * editor (publish dialog + side panel) and the static build. Findings carry a `severity`, the
 * component `path` they anchor to, and a human message; `errors` block publish and fail the build
 * (they would produce broken or inaccessible output), `warnings` are advisory.
 *
 * Runs on the *stored* (Portable Text) form of a design — the same shape the build reads and the
 * editor produces via `editorFormToDesign` before a publish — so rich-text bodies are PT arrays here,
 * never the editor's ProseMirror working form. The catalog-specific knowledge this pass needs (which
 * props are token selects, and of what kind) arrives as a `TokenPropRegistry` argument so this module
 * stays free of `catalog.tsx`'s React/Puck imports and unit-testable on its own; the a11y rules below
 * are inherently tied to catalog v1's component and prop names and track it directly (contributor
 * rule: extend these when the frozen catalog changes).
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

import { SAFE_URL_SCHEME_RE } from "./richtext"
import { hasToken, type TokenCatalog, type TokenPropRegistry } from "./tokens"
import { isPuckComponent, isRecord, type DesignDoc, type PuckComponent } from "./types"

/** Severity of a lint finding. `error` blocks publish and fails the build; `warning` is advisory. */
export type LintSeverity = "error" | "warning"

/** A single lint result: what is wrong, how bad, where, and a stable rule id for grouping/tests. */
export interface LintFinding {
    severity: LintSeverity
    /** Stable rule identifier (e.g. "single-h1"), for de-duping, UI grouping, and tests. */
    rule: string
    /** Human-readable component path, e.g. `content[0]:Section › content[1]:Heading`. */
    path: string
    message: string
}

/** Portable Text block `_type`s the RichText renderer supports (§6.4); any other warns. */
const SUPPORTED_PT_TYPES = new Set(["block", "code"])

/** Maps a Heading `level` prop ("h1".."h4") to its numeric depth, or null when unrecognized. */
function headingDepth(level: unknown): number | null {
    if (typeof level !== "string") return null
    const match = /^h([1-6])$/.exec(level)
    return match ? Number(match[1]) : null
}

/** Appends a `type[index]` segment to a parent path, producing the child's readable path. */
function childPath(parent: string, type: string, index: number): string {
    const segment = `${type}[${index}]`
    return parent ? `${parent} › ${segment}` : segment
}

/** A heading occurrence collected during the walk, in document order, for the whole-page checks. */
interface HeadingRef {
    depth: number
    path: string
}

/**
 * Lints one component's own props (not its slots): token references, a11y, and rich-text bodies.
 * Heading occurrences are pushed to `headings` for the document-order checks run after the walk.
 */
function lintComponent(
    component: PuckComponent,
    path: string,
    theme: TokenCatalog | null,
    tokenProps: TokenPropRegistry,
    findings: LintFinding[],
    headings: HeadingRef[]
): void {
    const { type, props } = component

    // Token references: a stored token name that no longer exists in the theme (warning; renders unstyled).
    if (theme) {
        for (const [prop, kind] of Object.entries(tokenProps[type] ?? {})) {
            const value = props[prop]
            if (typeof value === "string" && value !== "" && !hasToken(theme, kind, value)) {
                findings.push({
                    severity: "warning",
                    rule: "unknown-token",
                    path,
                    message: `${prop} references ${kind} token "${value}", which is not in the theme`
                })
            }
        }
    }

    switch (type) {
        case "Heading": {
            const depth = headingDepth(props.level)
            if (depth !== null) headings.push({ depth, path })
            break
        }
        case "Image": {
            const alt = props.alt
            if (typeof alt !== "string" || alt.trim() === "") {
                findings.push({ severity: "error", rule: "image-alt", path, message: "Image is missing alt text" })
            }
            break
        }
        case "Button": {
            const href = props.href
            if (typeof href === "string" && href !== "" && !SAFE_URL_SCHEME_RE.test(href)) {
                findings.push({
                    severity: "error",
                    rule: "unsafe-href",
                    path,
                    message: `Button link uses a disallowed URL scheme: "${href}"`
                })
            }
            break
        }
        case "Columns": {
            const count = typeof props.count === "number" ? props.count : 0
            for (let col = 1; col <= count; col++) {
                const slot = props[`col${col}`]
                if (!Array.isArray(slot) || slot.length === 0) {
                    findings.push({
                        severity: "warning",
                        rule: "empty-column",
                        path,
                        message: `Column ${col} of ${count} is empty`
                    })
                }
            }
            break
        }
        case "RichText": {
            lintRichText(props.body, path, findings)
            break
        }
    }
}

/** Lints a stored rich-text body (PT array): unsupported block types (warning) and unsafe link hrefs (error). */
function lintRichText(body: unknown, path: string, findings: LintFinding[]): void {
    if (!Array.isArray(body)) return // ProseMirror working form is never linted; only stored PT reaches here
    for (const block of body) {
        if (!isRecord(block)) continue
        if (typeof block._type === "string" && !SUPPORTED_PT_TYPES.has(block._type)) {
            findings.push({
                severity: "warning",
                rule: "unsupported-block",
                path,
                message: `Rich text contains an unsupported block type "${block._type}", which will not render`
            })
        }
        if (Array.isArray(block.markDefs)) {
            for (const def of block.markDefs) {
                if (isRecord(def) && def._type === "link" && typeof def.href === "string" && def.href !== "" && !SAFE_URL_SCHEME_RE.test(def.href)) {
                    findings.push({
                        severity: "error",
                        rule: "unsafe-href",
                        path,
                        message: `Rich text link uses a disallowed URL scheme: "${def.href}"`
                    })
                }
            }
        }
    }
}

/**
 * Depth-first walk over a component array in document order: lints each component, then recurses into
 * its slot props (array-valued props whose elements are components). Rich-text bodies are PT arrays,
 * not component arrays, so they are not descended into here — `lintComponent` handles them directly.
 */
function walk(
    components: unknown[],
    parentPath: string,
    theme: TokenCatalog | null,
    tokenProps: TokenPropRegistry,
    findings: LintFinding[],
    headings: HeadingRef[]
): void {
    components.forEach((component, index) => {
        if (!isPuckComponent(component)) return
        const path = childPath(parentPath, component.type, index)
        lintComponent(component, path, theme, tokenProps, findings, headings)
        for (const value of Object.values(component.props)) {
            if (Array.isArray(value) && value.some(isPuckComponent)) {
                walk(value, path, theme, tokenProps, findings, headings)
            }
        }
    })
}

/**
 * Runs document-order heading checks: exactly one H1, and no skipped level between adjacent headings.
 */
function lintHeadings(headings: HeadingRef[], findings: LintFinding[]): void {
    const h1s = headings.filter((heading) => heading.depth === 1)
    if (h1s.length !== 1) {
        findings.push({
            severity: "error",
            rule: "single-h1",
            path: h1s[1]?.path ?? "root",
            message: `A page must have exactly one H1 heading (found ${h1s.length})`
        })
    }
    for (let i = 1; i < headings.length; i++) {
        const previous = headings[i - 1].depth
        const current = headings[i].depth
        if (current - previous > 1) {
            findings.push({
                severity: "error",
                rule: "heading-skip",
                path: headings[i].path,
                message: `Heading level jumps from h${previous} to h${current}, skipping a level`
            })
        }
    }
}

/**
 * Lints a stored design document against the theme. Returns every finding (errors and warnings) in a
 * stable order: per-component findings in document order, then the whole-page heading findings.
 *
 * @param {DesignDoc} doc - the design in stored form (rich text as Portable Text)
 * @param {TokenCatalog | null} theme - the live theme; when null, token-reference checks are skipped
 * @param {TokenPropRegistry} tokenProps - component type → token-select props (catalog `TOKEN_PROPS`)
 * @returns {LintFinding[]} - all findings; callers gate on `severity === "error"`
 */
export function lintDesign(doc: DesignDoc, theme: TokenCatalog | null, tokenProps: TokenPropRegistry): LintFinding[] {
    const findings: LintFinding[] = []
    const headings: HeadingRef[] = []

    const content = (doc.puck as { content?: unknown }).content
    if (Array.isArray(content)) {
        walk(content, "", theme, tokenProps, findings, headings)
    }
    lintHeadings(headings, findings)

    return findings
}

/** Whether a finding set blocks publish / fails the build (any error present). */
export function hasBlockingError(findings: LintFinding[]): boolean {
    return findings.some((finding) => finding.severity === "error")
}
