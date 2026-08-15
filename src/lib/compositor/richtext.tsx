/**
 * lib/compositor/richtext.tsx
 *
 * React Portable Text renderer for the compositor's RichText component
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
 * a fragment
 */
export const SAFE_URL_SCHEME_RE = /^(https?:|mailto:|tel:|\/(?!\/)|#)/i

/** Returns the url when it uses a safe scheme, otherwise "#". Shared by the catalog Button and lint (§6.7). */
export function sanitizeHref(url: string | undefined | null): string {
    return url && SAFE_URL_SCHEME_RE.test(url) ? url : "#"
}

/** Hrefs that leave the site. Within SAFE_URL_SCHEME_RE the complement is site-relative and fragment. */
const EXTERNAL_URL_SCHEME_RE = /^(https?:|mailto:|tel:)/i

/**
 * Whether a link opens in a new tab
 */
export function opensInNewTab(href: string, target?: string): boolean {
    if (target === "_blank") return true
    if (target === "_self") return false
    return EXTERNAL_URL_SCHEME_RE.test(href)
}

/**
 * Maps a block's `textAlign` to emdash's WordPress-style class, or undefined for the default
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
            // `blank` is deliberately not read — see opensInNewTab for why it carries no author intent.
            const markDef = props.value as { href?: string; target?: string } | undefined
            const href = sanitizeHref(markDef?.href)
            const newTab = opensInNewTab(href, markDef?.target)
            return (
                <a href={href} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener noreferrer" : undefined}>
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

/** Renders a stored Portable Text body to React elements with `pages`-parity output. */
export function RichTextView({ value }: { value: PortableTextBlock[] }): JSX.Element {
    // emdash's PortableTextBlock is structurally the stored form; @portabletext/react types its value
    // against @portabletext/types' near-identical shape — bridge the two nominal types here.
    return <PortableText value={value as never} components={components} />
}
