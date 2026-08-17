/**
 * lib/compositor/lint.ts
 *
 * Design lint, rules
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

import { rendersOwnAnchors } from "./catalog-renderers"
import { isEmptyFieldValue } from "./entity-fields"
import { mediaSource } from "./media"
import { SAFE_URL_SCHEME_RE } from "./richtext"
import { hasToken, type TokenCatalog, type TokenPropRegistry } from "./tokens"
import { isPuckComponent, isRecord, type DesignDoc, type PuckComponent } from "./types"
// Type-only: erased at compile, so this module stays runtime-independent of the build-side reader.
import type { CollectionField } from "../build/design-api"

/** Severity of a lint finding. `error` blocks publish and fails the build; `warning` is advisory. */
export type LintSeverity = "error" | "warning"

/** Outlet component type -> the schema field types it accepts (catalog `OUTLET_PROPS`). */
export type OutletPropRegistry = Record<string, readonly string[]>

/**
 * The template-mode pairing context
 */
export interface LintPairingContext {
    entry: Record<string, unknown> | null
    schemaFields: CollectionField[] | null
}

/** A single lint result: what is wrong, how bad, where, and a stable rule id for grouping/tests. */
export interface LintFinding {
    severity: LintSeverity
    /** Stable rule identifier (e.g. "single-h1"), for de-duping, UI grouping, and tests. */
    rule: string
    /** Human-readable component path, e.g. `content[0]:Section › content[1]:Heading`. */
    path: string
    message: string
}

/** Portable Text block `_type`s the RichText renderer supports; any other warns. */
const SUPPORTED_PT_TYPES = new Set(["block", "code"])

/** Whether a value is a non-empty string href that fails the safe-scheme allowlist. */
function isUnsafeHref(value: unknown): value is string {
    return typeof value === "string" && value !== "" && !SAFE_URL_SCHEME_RE.test(value)
}

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

/** Everything one walk accumulates and consults, bundled so the recursion stays readable. */
interface LintState {
    theme: TokenCatalog | null
    tokenProps: TokenPropRegistry
    outletProps: OutletPropRegistry
    context: LintPairingContext | undefined
    /** true when linting a document about to be published - hardens `unknown-token` to an error (DD2). */
    published: boolean
    findings: LintFinding[]
    headings: HeadingRef[]
    outletCount: number
}

/**
 * Pushes a `HeadingRef` for every PT block styled `h1`-`h6` in a rich-text body, in block order */
function collectPtHeadings(body: unknown, path: string, headings: HeadingRef[]): void {
    if (!Array.isArray(body)) return
    for (const block of body) {
        if (!isRecord(block) || block._type !== "block") continue
        const depth = headingDepth(block.style)
        if (depth !== null) headings.push({ depth, path })
    }
}

/**
 * Lints one component's own props (not its slots): token references, a11y, and rich-text bodies
 */
function lintComponent(component: PuckComponent, path: string, state: LintState): void {
    const { type, props } = component
    const { theme, context, findings, headings } = state

    // Token references
    if (theme) {
        for (const [prop, kind] of Object.entries(state.tokenProps[type] ?? {})) {
            const value = props[prop]
            if (typeof value === "string" && value !== "" && !hasToken(theme, kind, value)) {
                findings.push({
                    severity: state.published ? "error" : "warning",
                    rule: "unknown-token",
                    path,
                    message: `${prop} references ${kind} token "${value}", which is not in the theme`
                })
            }
        }
    }

    if (type in state.outletProps) {
        lintOutlet(component, path, state)
        return
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
            if (isUnsafeHref(href)) {
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
            collectPtHeadings(props.body, path, headings)
            break
        }
        case "Spacer": {
            // Unlike an outlet's `field`, "" is Spacer's valid default (always renders)
            const linkedField = typeof props.linkedField === "string" ? props.linkedField : ""
            if (
                linkedField &&
                context?.schemaFields &&
                !context.schemaFields.some((candidate) => candidate.slug === linkedField)
            ) {
                findings.push({
                    severity: "warning",
                    rule: "dangling-spacer-field",
                    path,
                    message:
                        `Spacer is linked to field "${linkedField}", which does not exist in the collection schema - ` +
                        "it will always be treated as empty and never render"
                })
            }
            break
        }
    }
}

/**
 * Lints one content outlet
 */
function lintOutlet(component: PuckComponent, path: string, state: LintState): void {
    const { type, props } = component
    const { context, findings, headings } = state
    state.outletCount += 1

    if (!context) {
        findings.push({
            severity: "error",
            rule: "outlet-outside-template",
            path,
            message: `${type} is a content outlet and can only be used in a design template, not a design page`
        })
        return
    }

    const field = typeof props.field === "string" ? props.field : ""

    // Field binding vs the collection schema (error: the outlet can never render). Skipped when the
    // schema could not be read (schemaFields null) - the caller has already warned about that.
    let dangling = false
    const schemaField = context.schemaFields?.find((candidate) => candidate.slug === field)
    if (context.schemaFields !== null) {
        const accepted = state.outletProps[type]
        if (field === "") {
            dangling = true
            findings.push({
                severity: "error",
                rule: "dangling-outlet-field",
                path,
                message: `${type} has no content field bound`
            })
        } else if (!schemaField) {
            dangling = true
            findings.push({
                severity: "error",
                rule: "dangling-outlet-field",
                path,
                message: `${type} is bound to field "${field}", which does not exist in the collection schema`
            })
        } else if (!accepted.includes(schemaField.type)) {
            dangling = true
            findings.push({
                severity: "error",
                rule: "dangling-outlet-field",
                path,
                message:
                    `${type} is bound to field "${field}" of type "${schemaField.type}"; ` +
                    `it accepts ${accepted.join(", ")}`
            })
        }
    }

    if (type === "ContentText") {
        const depth = headingDepth(props.level)
        if (depth !== null) headings.push({ depth, path })
    }

    // Forced-link checks (ContentField only)
    if (type === "ContentField" && props.forceLink === "yes") {
        const linkHref = typeof props.linkHref === "string" ? props.linkHref : ""
        if (linkHref.trim() === "") {
            findings.push({
                severity: "warning",
                rule: "force-link-no-url",
                path,
                message: `${type}'s "Force hyperlink" is on, but no Link URL is set`
            })
        } else if (isUnsafeHref(linkHref)) {
            findings.push({
                severity: "error",
                rule: "unsafe-href",
                path,
                message: `${type}'s forced link uses a disallowed URL scheme: "${linkHref}"`
            })
        }
        if (schemaField && rendersOwnAnchors(undefined, schemaField.type)) {
            findings.push({
                severity: "warning",
                rule: "force-link-inert",
                path,
                message:
                    `${type}'s "Force hyperlink" has no effect on field "${field}" - ` +
                    `its type ("${schemaField.type}") already renders its own link`
            })
        }
    }

    // Entry-dependent rows: skipped template-alone (entry null) or when the binding is already broken.
    const entry = context.entry
    if (!entry || field === "" || dangling) return
    const value = entry[field]

    const emptyValue = (): void => {
        // ContentField never omits its row on empty - `onEmpty` controls what shows instead (placeholder,
        // blank+hidden-label, or blank as-is; see catalog.tsx's ContentField render)
        const onEmpty = typeof props.onEmpty === "string" ? props.onEmpty : "doNothing"
        const outcome =
            type !== "ContentField"
                ? "renders nothing"
                : onEmpty === "placeholder"
                  ? `renders the placeholder value "${typeof props.emptyValue === "string" ? props.emptyValue : "(none)"}"`
                  : onEmpty === "hideLabel"
                    ? "renders with a blank value and no label"
                    : "renders with a blank value"
        findings.push({
            severity: "warning",
            rule: "empty-outlet-value",
            path,
            message: `${type}'s field "${field}" is empty on this entry, so it ${outcome}`
        })
    }

    switch (type) {
        case "ContentText": {
            if (typeof value !== "string" || value.trim() === "") emptyValue()
            break
        }
        case "ContentRichText": {
            if (!Array.isArray(value) || value.length === 0) {
                emptyValue()
            } else {
                lintRichText(value, path, findings)
                collectPtHeadings(value, path, headings)
            }
            break
        }
        case "ContentImage":
        case "MediaText": {
            // The renderer's own predicate (media.ts): a bare media `id` is NOT a usable handle
            if (mediaSource(value) === null) {
                emptyValue()
            } else if (isRecord(value) && (typeof value.alt !== "string" || value.alt.trim() === "")) {
                // Only EmDash media carries an authorable `alt` slot; a string-sourced (D1 entity) image
                // has none to check - the render accepts that gap (renders alt="")
                findings.push({
                    severity: "error",
                    rule: "content-image-alt",
                    path,
                    message:
                        `${type}'s image (field "${field}") has no alt text - ` + "set it on the media item in the CMS"
                })
            }
            break
        }
        case "ContentField": {
            if (isEmptyFieldValue(value, schemaField?.type)) emptyValue()
            break
        }
    }
}

/**
 * Lints a stored rich-text body: must be a PT array (a raw string here means the editor's
 * ProseMirror-to-PT conversion was skipped or failed - see convert.ts - and would render as literal
 * text instead of formatted content)
 */
function lintRichText(body: unknown, path: string, findings: LintFinding[]): void {
    if (!Array.isArray(body)) {
        if (body !== undefined && body !== null) {
            findings.push({
                severity: "error",
                rule: "richtext-not-portable-text",
                path,
                message:
                    "Rich text body is not a Portable Text array and will render as literal text instead of formatted content"
            })
        }
        return
    }
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
                if (isRecord(def) && def._type === "link" && isUnsafeHref(def.href)) {
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
 * its slot props (array-valued props whose elements are components)
 */
function walk(components: unknown[], parentPath: string, state: LintState): void {
    components.forEach((component, index) => {
        if (!isPuckComponent(component)) return
        const path = childPath(parentPath, component.type, index)
        lintComponent(component, path, state)
        for (const value of Object.values(component.props)) {
            if (Array.isArray(value) && value.some(isPuckComponent)) {
                walk(value, path, state)
            }
        }
    })
}

/**
 * Runs document-order heading checks: exactly one H1, and no skipped level between adjacent headings
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

/** Lints a stored design document against the theme and, in template mode, its pairing context */
export function lintDesign(
    doc: DesignDoc,
    theme: TokenCatalog | null,
    tokenProps: TokenPropRegistry,
    outletProps: OutletPropRegistry,
    context?: LintPairingContext,
    published = false
): LintFinding[] {
    const state: LintState = {
        theme,
        tokenProps,
        outletProps,
        context,
        published,
        findings: [],
        headings: [],
        outletCount: 0
    }

    const content = (doc.puck as { content?: unknown }).content
    if (Array.isArray(content)) {
        walk(content, "", state)
    }
    // Heading order is a property of the COMBINED template+entry sequence: template-alone
    // (entry null) the sequence is incomplete
    if (!context || context.entry) {
        lintHeadings(state.headings, state.findings)
    }

    if (context && state.outletCount === 0) {
        state.findings.push({
            severity: "warning",
            rule: "template-no-outlets",
            path: "root",
            message: "This template contains no content outlets, so every entry renders identically through it"
        })
    }

    return state.findings
}

/**
 * Whether a finding set blocks publish / fails the build (any error present).
 */
export function hasBlockingError(findings: LintFinding[]): boolean {
    return findings.some((finding) => finding.severity === "error")
}

/**
 * Every token a set of designs references, as `"<kind>:<name>"` -> the design labels using it
 */
export function collectTokenUsage(
    docs: { label: string; doc: DesignDoc }[],
    tokenProps: TokenPropRegistry
): Map<string, string[]> {
    const usage = new Map<string, string[]>()

    const record = (key: string, label: string): void => {
        const labels = usage.get(key)
        if (!labels) usage.set(key, [label])
        else if (!labels.includes(label)) labels.push(label)
    }

    const visit = (components: unknown[], label: string): void => {
        for (const component of components) {
            if (!isPuckComponent(component)) continue
            for (const [prop, kind] of Object.entries(tokenProps[component.type] ?? {})) {
                const value = component.props[prop]
                if (typeof value === "string" && value !== "") record(`${kind}:${value}`, label)
            }
            for (const value of Object.values(component.props)) {
                if (Array.isArray(value) && value.some(isPuckComponent)) visit(value, label)
            }
        }
    }

    for (const { label, doc } of docs) {
        const content = (doc.puck as { content?: unknown }).content
        if (Array.isArray(content)) visit(content, label)
    }

    return usage
}
