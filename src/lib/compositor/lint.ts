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
 * props are token selects, and which components are content outlets accepting which field types)
 * arrives as `TokenPropRegistry`/`OutletPropRegistry` arguments so this module stays free of
 * `catalog.tsx`'s React/Puck imports and unit-testable on its own; the a11y rules below are inherently
 * tied to catalog v1's component and prop names and track it directly (contributor rule: extend these
 * when the frozen catalog changes).
 *
 * Pairing rules (pivot §5.5): passing a `LintPairingContext` switches the pass into template mode —
 * outlets are legal, their field bindings are checked against the collection schema, and the
 * entry-dependent rows run when a (preview or routed) entry is present. WITHOUT a context the doc is
 * a `design_page`, where any outlet is an error: no pairing context will ever exist for it.
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

import { isEmptyFieldValue } from "./entity-fields"
import { mediaSource } from "./media"
import { SAFE_URL_SCHEME_RE } from "./richtext"
import { hasToken, type TokenCatalog, type TokenPropRegistry } from "./tokens"
import { isPuckComponent, isRecord, type DesignDoc, type PuckComponent } from "./types"
// Type-only: erased at compile, so this module stays runtime-independent of the build-side reader.
import type { CollectionField } from "../build/design-api"

/** Severity of a lint finding. `error` blocks publish and fails the build; `warning` is advisory. */
export type LintSeverity = "error" | "warning"

/** Outlet component type → the schema field types it accepts (catalog `OUTLET_PROPS`). */
export type OutletPropRegistry = Record<string, readonly string[]>

/**
 * The template-mode pairing context (pivot §5.5). Present = the doc is a `design_template`; absent =
 * a `design_page`, where outlets are errors. `entry` is the routed (build) or preview (editor) entry's
 * raw fields — null lints the template alone, running structural rules only. `schemaFields` is the
 * template collection's live schema — null means it could not be read, so the dangling-outlet-field
 * checks are skipped (the caller warns; see design-api.ts `fetchCollectionFields`).
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

/** Everything one walk accumulates and consults, bundled so the recursion stays readable. */
interface LintState {
    theme: TokenCatalog | null
    tokenProps: TokenPropRegistry
    outletProps: OutletPropRegistry
    context: LintPairingContext | undefined
    /** true when linting a document about to be published — hardens `unknown-token` to an error (DD2). */
    published: boolean
    findings: LintFinding[]
    headings: HeadingRef[]
    outletCount: number
}

/**
 * Pushes a `HeadingRef` for every PT block styled `h1`–`h6` in a rich-text body, in block order (the
 * §1.11 fix): these render as real heading tags, so the single-h1/skip checks must see them.
 */
function collectPtHeadings(body: unknown, path: string, headings: HeadingRef[]): void {
    if (!Array.isArray(body)) return
    for (const block of body) {
        if (!isRecord(block) || block._type !== "block") continue
        const depth = headingDepth(block.style)
        if (depth !== null) headings.push({ depth, path })
    }
}

/**
 * Lints one component's own props (not its slots): token references, a11y, and rich-text bodies.
 * Heading occurrences are pushed to `state.headings` for the document-order checks run after the walk.
 */
function lintComponent(component: PuckComponent, path: string, state: LintState): void {
    const { type, props } = component
    const { theme, findings, headings } = state

    // Token references: a stored token name that no longer exists in the theme. On a PUBLISHED document
    // this is an error — it ships a visibly-unstyled element, the failure the 2026-07-14 homepage incident
    // taught us to catch at the gate (DD2). In the editor (draft) it stays a warning: the author may be
    // mid-rename and must not be blocked on a token they are about to fix.
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
            collectPtHeadings(props.body, path, headings)
            break
        }
    }
}

/**
 * Lints one content outlet (pivot §5.5): placement, field binding against the collection schema, and
 * — when an entry is present — the resolved value (emptiness, image alt, PT safety, PT headings).
 * `ContentText` contributes its heading level STRUCTURALLY (entry or not): the template places that
 * heading for every entry it renders, so heading order is checked template-alone too.
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
    // schema could not be read (schemaFields null) — the caller has already warned about that.
    let dangling = false
    if (context.schemaFields !== null) {
        const accepted = state.outletProps[type]
        const schemaField = context.schemaFields.find((candidate) => candidate.slug === field)
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

    // Entry-dependent rows: skipped template-alone (entry null) or when the binding is already broken.
    const entry = context.entry
    if (!entry || field === "" || dangling) return
    const value = entry[field]

    const emptyValue = (): void => {
        // ContentField never omits its row on an empty value — its `onEmpty` prop instead controls what
        // shows in it (a placeholder, a blank value with the label hidden, or a blank value as-is; see
        // catalog.tsx's ContentField render). Every other outlet renders nothing. The warning wording
        // reflects whichever applies, kept in step with that render by hand.
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
            // The renderer's own predicate (media.ts): a bare media `id` is NOT a usable handle — the file
            // route is keyed by storage key and 404s on an id — so "empty" means "resolves to no source",
            // not "has no id". A plain string (a D1 entity's `image` column) is a resolvable source too.
            // Keep this in step with ContentImage's/MediaText's render or lint stops predicting it.
            if (mediaSource(value) === null) {
                emptyValue()
            } else if (isRecord(value) && (typeof value.alt !== "string" || value.alt.trim() === "")) {
                // Only EmDash media carries an authorable `alt` slot; a string-sourced (D1 entity) image
                // has none to check — the render accepts that gap (renders alt="").
                findings.push({
                    severity: "error",
                    rule: "content-image-alt",
                    path,
                    message:
                        `${type}'s image (field "${field}") has no alt text — ` +
                        "set it on the media item in the CMS"
                })
            }
            break
        }
        case "ContentField": {
            const schemaField = context.schemaFields?.find((candidate) => candidate.slug === field)
            if (isEmptyFieldValue(value, schemaField?.type)) emptyValue()
            break
        }
    }
}

/**
 * Lints a stored rich-text body: must be a PT array (a raw string here means the editor's
 * ProseMirror-to-PT conversion was skipped or failed — see convert.ts — and would render as literal
 * text instead of formatted content); unsupported block types (warning) and unsafe link hrefs (error).
 */
function lintRichText(body: unknown, path: string, findings: LintFinding[]): void {
    if (!Array.isArray(body)) {
        if (body !== undefined && body !== null) {
            findings.push({
                severity: "error",
                rule: "richtext-not-portable-text",
                path,
                message: "Rich text body is not a Portable Text array and will render as literal text instead of formatted content"
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
 * Lints a stored design document against the theme, and — in template mode — against its pairing
 * context (pivot §5.5). Returns every finding (errors and warnings) in a stable order: per-component
 * findings in document order, then the whole-page heading and template-shape findings.
 *
 * @param {DesignDoc} doc - the design in stored form (rich text as Portable Text)
 * @param {TokenCatalog | null} theme - the live theme; when null, token-reference checks are skipped
 * @param {TokenPropRegistry} tokenProps - component type → token-select props (catalog `TOKEN_PROPS`)
 * @param {OutletPropRegistry} outletProps - outlet type → accepted field types (catalog `OUTLET_PROPS`)
 * @param {LintPairingContext} [context] - present for a `design_template` doc; absent for a `design_page`
 * @param {boolean} [published=false] - true for a document being published (build gate), which promotes
 *   the `unknown-token` finding to an error (DD2); false (the default, and the editor's intent) keeps it
 *   a warning so an author mid-rename is not blocked
 * @returns {LintFinding[]} - all findings; callers gate on `severity === "error"`
 */
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
    // Heading order is a property of the COMBINED template+entry sequence (§5.5): template-alone
    // (entry null) the sequence is incomplete — the entry body may supply the missing levels — so the
    // checks are skipped rather than raising false blocking errors. The build always pairs an entry.
    if (!context || context.entry) {
        lintHeadings(state.headings, state.findings)
    }

    // A template with zero outlets renders identically for every entry — almost certainly a mistake.
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

/** Whether a finding set blocks publish / fails the build (any error present). */
export function hasBlockingError(findings: LintFinding[]): boolean {
    return findings.some((finding) => finding.severity === "error")
}

/**
 * Every token a set of designs references, as `"<kind>:<name>"` → the design labels that use it. Powers
 * the theme editor's rename/remove guard (§3.1): before a token is renamed or removed, the editor can
 * name exactly which designs would lose that style. Pure and catalog-agnostic (takes `TokenPropRegistry`
 * as an argument, same decoupling as `lintDesign`); walks the stored Puck tree exactly like `walk`.
 *
 * @param {{ label: string; doc: DesignDoc }[]} docs - the designs to scan, each with a display label
 * @param {TokenPropRegistry} tokenProps - component type → token-select props (catalog `TOKEN_PROPS`)
 * @returns {Map<string, string[]>} - `"<kind>:<name>"` → the distinct design labels referencing it
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
