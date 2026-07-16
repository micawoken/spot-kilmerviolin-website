/**
 * lib/compositor/richtext-extensions.ts
 *
 * The Tiptap extension set Puck's built-in `richtext` field edits with, reconstructed for use with
 * `@tiptap/html`'s `generateJSON` (impl §4.4 follow-up). Puck 0.22's richtext field hands `onChange` an
 * HTML string (`editor.getHTML()`), not a ProseMirror document, so converting that string back to
 * Portable Text on save requires parsing it with the *same* schema Puck edited it with — an extension
 * mismatch would silently drop or reinterpret marks/nodes the editor actually allowed.
 *
 * This list is not importable from `@puckeditor/core` (its internal `PuckRichText` bundle, in
 * `dist/chunk-2CNEFIQP.mjs`, is not part of the package's public `exports` map) so it is reconstructed
 * here from the same public `@tiptap/extension-*` packages, matching the internal bundle's default
 * options exactly (every extension enabled, `TextAlign` scoped to heading/paragraph). If a future
 * `@puckeditor/core` upgrade changes that default set, this list must be updated to match.
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
import { Link } from "@tiptap/extension-link"
import { Paragraph } from "@tiptap/extension-paragraph"
import { Strike } from "@tiptap/extension-strike"
import { Text } from "@tiptap/extension-text"
import TextAlign from "@tiptap/extension-text-align"
import { Underline } from "@tiptap/extension-underline"
import type { Extensions } from "@tiptap/core"

/** Matches Puck's `PuckRichText` default extension set, at its default options. */
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
    Link,
    ListItem,
    BulletList,
    OrderedList,
    ListKeymap,
    TextAlign.configure({ types: ["heading", "paragraph"] })
]
