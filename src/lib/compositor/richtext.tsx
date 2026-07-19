/**
 * lib/compositor/richtext.tsx
 *
 * React Portable Text renderer for the compositor's RichText component (impl §6.4). Output-parity
 * target: the existing `pages` rendering (emdash/ui `PortableText` → astro-portabletext). Rendering
 * pure Portable Text through a whitelist of components — no raw-HTML path — is the sanitization
 * boundary; link hrefs are scheme-checked here and in lint (§6.7). Used by the build renderer and,
 * for already-Portable-Text values, the editor canvas.
 *
 * Parity notes (kept current as differences are found; drives the Phase 2 `pages` retirement gate):
 * - Blocks: `normal`→<p>, `h1`–`h6`, `blockquote`, each carrying a `has-text-align-{center|right|
 *   justify}` class when `textAlign` is set (left/default emits no class), matching emdash's Block.
 * - Marks: strong/em/code use the library defaults (<strong>/<em>/<code>); underline→<u>,
 *   strike-through→<s>, superscript→<sup>, subscript→<sub>, link→<a> (scheme-checked, target/rel on
 *   blank), matching emdash's mark components. (Sub/superscript can't be authored in the compositor —
 *   they don't round-trip, spike (d) — but are rendered for parity with legacy `pages` content.)
 * - `code` blocks mirror emdash's Code.astro DOM (div.emdash-code > optional filename > pre>code with
 *   `language-*` classes). Emdash ships scoped styles for it; here that styling comes from
 *   compositor.css (§6.3), so the visual code-block treatment is a known, accepted diff.
 * - Unsupported block/mark types render nothing and warn loudly (fail-soft, matching emdash-api.ts).
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

import type { JSX, ReactNode } from "react"
import { PortableText, type PortableTextComponentProps, type PortableTextComponents } from "@portabletext/react"
import type { PortableTextBlock } from "emdash"

/**
 * URLs safe to render into an href: http(s), mailto, tel, site-relative (single leading slash), or
 * a fragment. Protocol-relative `//host` is rejected. Mirrors emdash's `sanitizeHref` (utils/url.ts);
 * inlined so this renderer stays out of the emdash server-code dependency graph.
 */
export const SAFE_URL_SCHEME_RE = /^(https?:|mailto:|tel:|\/(?!\/)|#)/i

/** Returns the url when it uses a safe scheme, otherwise "#". Shared by the catalog Button and lint (§6.7). */
export function sanitizeHref(url: string | undefined | null): string {
    return url && SAFE_URL_SCHEME_RE.test(url) ? url : "#"
}

/**
 * Maps a block's `textAlign` to emdash's WordPress-style class, or undefined for the default. Only
 * center/right/justify produce a class; `left`, missing, and unknown values render without one.
 * Allowlist-only so hand-edited PT can't inject an arbitrary class name.
 */
const ALIGN_CLASS: Record<string, string> = {
    center: "has-text-align-center",
    right: "has-text-align-right",
    justify: "has-text-align-justify"
}

function textAlignClassName(value: unknown): string | undefined {
    return typeof value === "string" && Object.hasOwn(ALIGN_CLASS, value) ? ALIGN_CLASS[value] : undefined
}

/** Heading styles the Block component maps to their matching element. */
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"])

const components: PortableTextComponents = {
    block: (props: PortableTextComponentProps<PortableTextBlock>) => {
        const node = props.value as { style?: string; textAlign?: string }
        const style = node.style ?? "normal"
        const className = textAlignClassName(node.textAlign)
        const children = props.children as ReactNode
        if (HEADING_TAGS.has(style)) {
            const Tag = style as keyof JSX.IntrinsicElements
            return <Tag className={className}>{children}</Tag>
        }
        if (style === "blockquote") {
            return <blockquote className={className}>{children}</blockquote>
        }
        return <p className={className}>{children}</p>
    },
    marks: {
        underline: (props) => <u>{props.children as ReactNode}</u>,
        "strike-through": (props) => <s>{props.children as ReactNode}</s>,
        superscript: (props) => <sup>{props.children as ReactNode}</sup>,
        subscript: (props) => <sub>{props.children as ReactNode}</sub>,
        link: (props) => {
            const markDef = props.value as { href?: string; blank?: boolean } | undefined
            const blank = markDef?.blank
            return (
                <a
                    href={sanitizeHref(markDef?.href)}
                    target={blank ? "_blank" : undefined}
                    rel={blank ? "noopener noreferrer" : undefined}
                >
                    {props.children as ReactNode}
                </a>
            )
        }
    },
    types: {
        code: (props) => {
            const node = props.value as { code?: string; language?: string; filename?: string }
            if (!node.code) return null
            const languageClass = node.language ? `language-${node.language}` : undefined
            return (
                <div className="emdash-code">
                    {node.filename && <div className="emdash-code-filename">{node.filename}</div>}
                    <pre className={languageClass}>
                        <code className={languageClass}>{node.code}</code>
                    </pre>
                </div>
            )
        }
    },
    unknownType: (props) => {
        console.warn(`[compositor] richtext: unsupported block type "${(props.value as { _type?: string })._type}" — rendering nothing`)
        return null
    },
    unknownMark: (props) => {
        console.warn(`[compositor] richtext: unsupported mark "${props.markType}" — rendering children unstyled`)
        return <>{props.children as ReactNode}</>
    }
}

/**
 * Renders a stored Portable Text body to React elements with `pages`-parity output.
 *
 * @param {{ value: PortableTextBlock[] }} props - the Portable Text block array to render
 * @returns {JSX.Element} - the rendered rich text
 */
export function RichTextView({ value }: { value: PortableTextBlock[] }): JSX.Element {
    // emdash's PortableTextBlock is structurally the stored form; @portabletext/react types its value
    // against @portabletext/types' near-identical shape, so bridge the two nominal types here.
    return <PortableText value={value as never} components={components} />
}
