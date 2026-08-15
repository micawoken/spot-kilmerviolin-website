/**
 * lib/compositor/catalog-richtext-link.tsx
 *
 * The editor-only inline-hyperlink UI for `RichText`'s Puck `richtext` field
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

import { useState } from "react"
import type { ReactNode } from "react"
import { RichTextMenu } from "@puckeditor/core"
import type { RichtextField } from "@puckeditor/core"

import { SAFE_URL_SCHEME_RE } from "./richtext"

// --- Structural types (see the file header's type note) --------------------------------------------

/** The signature `RichtextField.tiptap.selector` accepts, at the default `UserSelector`. */
type LinkSelectorFn = NonNullable<NonNullable<RichtextField["tiptap"]>["selector"]>
type LinkSelectorCtx = Parameters<LinkSelectorFn>[0]

/** The props `RichtextField.renderMenu`/`renderInlineMenu` are called with. */
type RichTextMenuRenderProps = Parameters<NonNullable<RichtextField["renderMenu"]>>[0]
type RichTextEditor = RichTextMenuRenderProps["editor"]
type RichTextEditorState = RichTextMenuRenderProps["editorState"]

// --- Selector: adds isLink/canLink to the field's editorState ---------------------------------------

/** `RichtextField.tiptap.selector` */
export const richTextLinkSelector: LinkSelectorFn = (ctx: LinkSelectorCtx) => {
    const editor = ctx.editor
    if (!editor) return { isLink: false, canLink: false }
    return {
        isLink: editor.isActive("link"),
        canLink: !editor.state.selection.empty || editor.isActive("link")
    }
}

// --- The link control + dialog ------------------------------------------------------------------------

/** Chain-link glyph (24x24, stroke-based, matches the weight of Puck's own toolbar icons). */
const LINK_ICON: ReactNode = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
)

/** The current link mark's href/target at the editor's selection, or blanks when there isn't one. */
function readLinkAttrs(editor: RichTextEditor): { href: string; target: "" | "_self" | "_blank" } {
    if (!editor) return { href: "", target: "" }
    const attrs = editor.getAttributes("link") as { href?: unknown; target?: unknown }
    const target = attrs.target === "_self" || attrs.target === "_blank" ? attrs.target : ""
    return { href: typeof attrs.href === "string" ? attrs.href : "", target }
}

/** How many text runs in the document carry a link to `href` */
function countLinksWithHref(editor: RichTextEditor, href: string): number {
    if (!editor || href.trim() === "") return 0
    let count = 0
    editor.state.doc.descendants((node) => {
        if (node.isText && node.marks.some((mark) => mark.type.name === "link" && mark.attrs.href === href)) {
            count += 1
        }
    })
    return count
}

/** The link toolbar control: a `RichTextMenu.Control` that opens a small dialog to set the href and
 *  "Opens in", or remove the link */
function LinkControl({ editor, editorState, readOnly }: { editor: RichTextEditor; editorState: RichTextEditorState; readOnly: boolean }) {
    const [open, setOpen] = useState(false)
    const [href, setHref] = useState("")
    const [target, setTarget] = useState<"" | "_self" | "_blank">("")
    const [error, setError] = useState<string | null>(null)

    const isLink = editorState?.isLink === true
    const canLink = editorState?.canLink === true

    const openDialog = () => {
        if (!editor) return
        const attrs = readLinkAttrs(editor)
        setHref(attrs.href)
        setTarget(attrs.target)
        setError(null)
        setOpen(true)
    }

    const apply = () => {
        if (!editor) return
        const trimmed = href.trim()
        if (trimmed === "") {
            setError("Enter a URL.")
            return
        }
        if (!SAFE_URL_SCHEME_RE.test(trimmed)) {
            setError("URL must start with http(s):, mailto:, tel:, a site-relative path, or #.")
            return
        }
        editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed, target: target || null }).run()
        setOpen(false)
    }

    const remove = () => {
        if (!editor) return
        editor.chain().focus().extendMarkRange("link").unsetLink().run()
        setOpen(false)
    }

    // A link being edited already accounts for one occurrence of its own href; a new link (isLink false)
    // doesn't yet, so the threshold shifts by one to ask "is there ANOTHER link with this href".
    const sharesTarget = href.trim() !== "" && countLinksWithHref(editor, href.trim()) > (isLink ? 1 : 0)

    return (
        <>
            <RichTextMenu.Control
                icon={LINK_ICON}
                title="Link"
                active={isLink}
                disabled={readOnly || (!canLink && !isLink)}
                onClick={(e) => {
                    e.stopPropagation()
                    openDialog()
                }}
            />
            {open && (
                <div className="design-editor__modal-backdrop" onClick={() => setOpen(false)}>
                    <div
                        className="design-editor__modal"
                        role="dialog"
                        aria-label="Link"
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: "min(420px, 90vw)", display: "flex", flexDirection: "column", gap: "0.75rem" }}
                    >
                        <label>
                            <span>URL</span>
                            <input
                                type="text"
                                value={href}
                                onChange={(e) => setHref(e.target.value)}
                                placeholder="https://example.org"
                                autoFocus
                            />
                        </label>
                        <label>
                            <span>Opens in</span>
                            <select value={target} onChange={(e) => setTarget(e.target.value as "" | "_self" | "_blank")}>
                                <option value="">Automatic (new tab if external)</option>
                                <option value="_self">Same tab</option>
                                <option value="_blank">New tab</option>
                            </select>
                        </label>
                        {sharesTarget && (
                            <p className="design-editor__hint">
                                Other links to this URL in this text share the same "Opens in" setting.
                            </p>
                        )}
                        {error && <p className="design-editor__blocked">{error}</p>}
                        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                            <span>{isLink && <button type="button" onClick={remove}>Remove</button>}</span>
                            <span style={{ display: "flex", gap: "0.5rem" }}>
                                <button type="button" onClick={() => setOpen(false)}>Cancel</button>
                                <button type="button" onClick={apply}>Apply</button>
                            </span>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}

/** `RichtextField.renderMenu` — the form-panel toolbar, with the link control appended to Puck's own. */
export function renderRichTextMenu({ children, editor, editorState, readOnly }: RichTextMenuRenderProps): ReactNode {
    return (
        <RichTextMenu>
            {children}
            <RichTextMenu.Group>
                <LinkControl editor={editor} editorState={editorState} readOnly={readOnly} />
            </RichTextMenu.Group>
        </RichTextMenu>
    )
}

/** `RichtextField.renderInlineMenu` — the compact canvas bubble menu, same control appended. */
export function renderRichTextInlineMenu({ children, editor, editorState, readOnly }: RichTextMenuRenderProps): ReactNode {
    return (
        <RichTextMenu>
            {children}
            <RichTextMenu.Group>
                <LinkControl editor={editor} editorState={editorState} readOnly={readOnly} />
            </RichTextMenu.Group>
        </RichTextMenu>
    )
}
