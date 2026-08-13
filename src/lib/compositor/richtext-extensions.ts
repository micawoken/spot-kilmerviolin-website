/**
 * lib/compositor/richtext-extensions.ts
 *
 * Tiptap extension set Puck's built-in `richtext` field edits with, reconstructed for `@tiptap/html`'s
 * `generateJSON` (impl §4.4 follow-up). Puck's richtext field hands `onChange` an HTML string
 * (`editor.getHTML()`), not a ProseMirror doc — converting back to Portable Text on save must parse it
 * with the *same* schema Puck edited with, or marks/nodes silently drop or misparse.
 *
 * Not importable from `@puckeditor/core` — its internal `PuckRichText` bundle isn't in the package's
 * public `exports` map — so reconstructed here from the same `@tiptap/extension-*` packages, matching
 * its default options exactly (every extension enabled, `TextAlign` scoped to heading/paragraph), with
 * ONE deliberate exception: `Link` (see {@link COMPOSITOR_LINK}). A future `@puckeditor/core` upgrade
 * that changes its default extension set desyncs everything else here silently — Link cannot desync the
 * same way, since both the editor field (`catalog.tsx`'s `RichText.body`) and this save-path re-parse
 * are handed `COMPOSITOR_LINK` explicitly rather than relying on Puck's own default.
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

import { Blockquote } from "@tiptap/extension-blockquote"
import { Bold } from "@tiptap/extension-bold"
import { BulletList, ListItem, ListKeymap, OrderedList } from "@tiptap/extension-list"
import { Code } from "@tiptap/extension-code"
import { CodeBlock } from "@tiptap/extension-code-block"
import { Document } from "@tiptap/extension-document"
import { HardBreak } from "@tiptap/extension-hard-break"
import { Heading } from "@tiptap/extension-heading"
import { HorizontalRule } from "@tiptap/extension-horizontal-rule"
import { Italic } from "@tiptap/extension-italic"
import { Link, type LinkOptions } from "@tiptap/extension-link"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Strike } from "@tiptap/extension-strike"
import { Text } from "@tiptap/extension-text"
import TextAlign from "@tiptap/extension-text-align"
import { Underline } from "@tiptap/extension-underline"
import type { Extensions } from "@tiptap/core"

/**
 * Tiptap's Link defaults `HTMLAttributes.target` to `"_blank"` (and `rel` to a fixed string), and
 * `Link.configure(...)` deep-merges onto that default rather than replacing it — passing `HTMLAttributes:
 * { href: ... }` would not clear `target`. Left in place, every link's HTML would carry
 * `target="_blank"`, and the save-path re-parse (`convert.ts`'s `editorToPortableText`) would read that
 * back as an explicit author choice, converting every link in the site to an explicit "New tab" the
 * moment it round-trips. `addOptions` must therefore replace the options object outright, not configure
 * it. `openOnClick: false` because the compositor's own link dialog owns editing a link; Tiptap's default
 * click-to-navigate would otherwise hijack a click meant to place the caret.
 *
 * The single source both the editor field (`catalog.tsx`) and this module's `generateJSON` re-parse are
 * given — see the file header.
 */
export const COMPOSITOR_LINK = Link.extend({
    addOptions(): LinkOptions {
        const base = this.parent?.() ?? ({} as LinkOptions)
        return { ...base, HTMLAttributes: {}, openOnClick: false }
    }
})

/** Matches Puck's `PuckRichText` default extension set, at its default options — except `Link`, which is
 *  {@link COMPOSITOR_LINK} (see its doc for why). */
export const RICH_TEXT_EXTENSIONS: Extensions = [
    Document,
    Paragraph,
    Text,
    Bold,
    Italic,
    Strike,
    Underline,
    Code,
    CodeBlock,
    Heading,
    Blockquote,
    HorizontalRule,
    HardBreak,
    COMPOSITOR_LINK,
    ListItem,
    BulletList,
    OrderedList,
    ListKeymap,
    TextAlign.configure({ types: ["heading", "paragraph"] })
]
