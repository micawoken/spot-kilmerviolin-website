/**
 * lib/compositor/catalog.tsx
 *
 * The single, frozen component catalog (impl §4.5 / §6.3). `buildConfig(theme, target)` is a factory
 * — select options depend on the live theme — producing the Puck `Config` that drives BOTH the editor
 * island and the static build renderer. Component render functions are pure (catalog purity rule,
 * §4.5): no hooks, no state, no browser APIs, no data fetching; every visual control stores a token
 * *name* resolved to `var(--dtk-…)` at render (decision 4), and all real styling lives in the
 * co-located `compositor.css` (class-per-component, consuming only `--dtk-*` and local `--cmp-*` vars).
 * Inline styles carry token-var lookups only — they map a chosen token into a local custom property
 * that `compositor.css` then applies. No freeform CSS is generated at render.
 *
 * Editor vs build target (deliberate deviation from "one config feeds both"): Puck's `useRichtextProps`
 * intercepts every `richtext`-typed field in the RSC render path as well as the editor, and its
 * renderer normalizes a stored Portable Text array to an *empty* ProseMirror doc — so a `richtext`
 * field would silently blank every design page at build. The build target therefore exposes RichText's
 * `body` as a plain passthrough field: the render receives the raw Portable Text array and routes it
 * through `richtext.tsx` for `pages`-parity output (§6.4). The editor target uses the real `richtext`
 * field (value is the ProseMirror working form produced by `convert.ts`) and Puck renders it natively.
 * `RichText.render` distinguishes the two by `Array.isArray(body)` (§6.3). The media picker is likewise
 * editor-only and attached only in the editor target, keeping its browser code off the build path.
 *
 * Button `variant` (§4.5 gap): §4.5 describes `variant` as "select from theme button variants
 * (color+radius+space token bundle)", but the §4.3 TokenCatalog defines no button-variant registry.
 * Phase 1 ships `variant` as a fixed select (primary/secondary/ghost) styled in `compositor.css`
 * against conventional `--dtk-*` tokens; a theme-defined variant bundle is a change request against
 * `plan-visual-compositor.md`, not a catalog expansion (contributor rule 3).
 *
 * Known canvas-vs-build diffs (accepted, §8): canvas shows unoptimized R2 originals (identical URL in
 * Phase 1); site chrome (header/footer) is absent in the canvas; fonts may load differently.
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

import { useState } from "react"
import type { ComponentType, CSSProperties, ReactNode } from "react"
import type { Config, CustomFieldRender } from "@puckeditor/core"
import type { PortableTextBlock } from "emdash"

import { RichTextView, sanitizeHref } from "./richtext"
import { tokenSelectOptions, tokenVar, type TokenCatalog, type TokenKind } from "./tokens"

/** Which config a `buildConfig` call produces: the editor island's or the static build renderer's. */
export type CatalogTarget = "editor" | "build"

/**
 * Component type → the names of its rich-text props (§4.4). Drives `convert.ts`'s PT ↔ ProseMirror
 * walks; a component absent here has no rich-text props. Phase 1 has exactly `RichText.body`.
 * Contributor rule 5: a new rich-text prop MUST be registered here.
 */
export const RICH_TEXT_PROPS: Record<string, readonly string[]> = { RichText: ["body"] }

/** The media object an Image stores (§4.5). `url` is the same-origin EmDash file endpoint. */
export interface MediaValue {
    mediaId: string
    url: string
    alt: string
    width: number
    height: number
}

/** A slot prop's value in render: a Puck-supplied component that renders the slot's contents. */
type SlotRender = ComponentType

/** Casts a token-var map to CSSProperties (React types omit custom-property keys). */
function vars(map: Record<string, string | number>): CSSProperties {
    return map as CSSProperties
}

/**
 * A token select field. Optional selects prepend a "None" option (value ""), letting the render skip
 * the local var so `compositor.css`'s fallback applies. Options come from the live theme.
 */
function tokenSelect(theme: TokenCatalog, kind: TokenKind, label: string, optional = false) {
    const options = tokenSelectOptions(theme, kind)
    return {
        type: "select" as const,
        label,
        options: optional ? [{ label: "None", value: "" }, ...options] : options
    }
}

// --- Media picker (editor-only custom field) -------------------------------------------------------
// Lives entirely inside the field render so its browser code (fetch + modal state) never runs on the
// build path; attached only in the editor target. Lists images from GET /_emdash/api/media, same-origin.

/** A media list row from GET /_emdash/api/media (subset of EmDash's MediaItem). */
interface MediaListItem {
    id: string
    filename: string
    alt: string | null
    width: number | null
    height: number | null
    mimeType: string
}

/** Builds the same-origin file URL EmDash serves a media item from (resolved to R2 on read). */
function mediaFileUrl(id: string): string {
    return `/_emdash/api/media/file/${id}`
}

// Rendered by Puck as a React component (AutoField mounts `<FieldComponent />`), so hooks are valid.
// Never invoked by the static RSC renderer, and attached only in the editor target, so its browser
// code (fetch + modal state) stays off the build path.
const mediaPickerRender: CustomFieldRender<MediaValue | undefined> = ({ value, onChange }) => {
    const [open, setOpen] = useState(false)
    const [items, setItems] = useState<MediaListItem[]>([])
    const [query, setQuery] = useState("")
    const [error, setError] = useState<string | null>(null)

    const load = async (q: string) => {
        setError(null)
        const params = new URLSearchParams({ mimeType: "image/", limit: "50" })
        if (q) params.set("q", q)
        try {
            const res = await fetch(`/_emdash/api/media?${params.toString()}`, {
                headers: { Accept: "application/json" },
                credentials: "same-origin"
            })
            if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
            const body = (await res.json()) as { data?: { items?: MediaListItem[] } }
            setItems(body.data?.items ?? [])
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to load media")
        }
    }

    const pick = (item: MediaListItem) => {
        onChange({
            mediaId: item.id,
            url: mediaFileUrl(item.id),
            alt: item.alt ?? "",
            width: item.width ?? 0,
            height: item.height ?? 0
        })
        setOpen(false)
    }

    return (
        <div>
            <button
                type="button"
                onClick={() => {
                    setOpen(true)
                    void load(query)
                }}
                style={{ display: "block", width: "100%", padding: "0.5rem", cursor: "pointer" }}
            >
                {value ? `Change image (${value.alt || value.mediaId})` : "Choose image…"}
            </button>
            {value?.url && (
                <img
                    src={value.url}
                    alt={value.alt}
                    style={{ marginTop: "0.5rem", maxWidth: "100%", height: "auto", display: "block" }}
                />
            )}
            {open && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.5)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        zIndex: 1000
                    }}
                    onClick={() => setOpen(false)}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: "#fff",
                            color: "#111",
                            width: "min(720px, 90vw)",
                            maxHeight: "80vh",
                            overflow: "auto",
                            padding: "1rem",
                            borderRadius: "0.5rem"
                        }}
                    >
                        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
                            <input
                                type="search"
                                placeholder="Search media…"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") void load(query)
                                }}
                                style={{ flex: 1, padding: "0.4rem" }}
                            />
                            <button type="button" onClick={() => void load(query)}>
                                Search
                            </button>
                            <button type="button" onClick={() => setOpen(false)}>
                                Close
                            </button>
                        </div>
                        {error && <p style={{ color: "#b00" }}>{error}</p>}
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                                gap: "0.5rem"
                            }}
                        >
                            {items.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => pick(item)}
                                    title={item.filename}
                                    style={{ padding: 0, border: "1px solid #ddd", cursor: "pointer", background: "none" }}
                                >
                                    <img
                                        src={mediaFileUrl(item.id)}
                                        alt={item.alt ?? item.filename}
                                        style={{ width: "100%", height: "90px", objectFit: "cover", display: "block" }}
                                    />
                                </button>
                            ))}
                        </div>
                        {items.length === 0 && !error && <p>No images found.</p>}
                    </div>
                </div>
            )}
        </div>
    )
}

// --- Component render props -----------------------------------------------------------------------

interface SectionProps {
    background: string
    paddingY: string
    content: SlotRender
}
interface ColumnsProps {
    count: number
    gap: string
    col1: SlotRender
    col2: SlotRender
    col3: SlotRender
    col4: SlotRender
}
interface HeadingProps {
    text: string
    level: "h1" | "h2" | "h3" | "h4"
    typography: string
    align: "start" | "center" | "end"
}
interface RichTextProps {
    /** PT block array on the build path (stored form); a Puck-rendered ReactNode in the editor canvas. */
    body: PortableTextBlock[] | ReactNode
}
interface ImageProps {
    media?: MediaValue
    alt: string
    aspect: "original" | "landscape" | "portrait"
}
interface ButtonProps {
    label: string
    href: string
    variant: "primary" | "secondary" | "ghost"
}
interface SpacerProps {
    size: string
}
interface DividerProps {
    spaceAround: string
    color: string
}

/**
 * Builds the Puck config for the given theme and target (§6.3). The component set and props are the
 * frozen §4.5 catalog v1; select options are drawn from `theme`. `target` governs only the two
 * editor-only fields (RichText `body`, Image `media`) per this module's header.
 *
 * @param {TokenCatalog} theme - the live theme whose tokens populate the select fields
 * @param {CatalogTarget} target - "editor" (rich editing fields) or "build" (passthrough fields)
 * @returns {Config} - the Puck config feeding the editor island or the static renderer
 */
export function buildConfig(theme: TokenCatalog, target: CatalogTarget): Config {
    const isEditor = target === "editor"

    const components = {
        Section: {
            label: "Section",
            fields: {
                background: tokenSelect(theme, "colors", "Background", true),
                paddingY: tokenSelect(theme, "space", "Vertical padding"),
                content: { type: "slot" as const }
            },
            defaultProps: { background: "", paddingY: "md", content: [] },
            render: ({ background, paddingY, content: Content }: SectionProps) => (
                <section
                    className="cmp-section"
                    style={vars({
                        ...(background ? { "--cmp-section-bg": tokenVar("colors", background) } : {}),
                        "--cmp-section-py": tokenVar("space", paddingY)
                    })}
                >
                    <Content />
                </section>
            )
        },
        Columns: {
            label: "Columns",
            fields: {
                count: {
                    type: "select" as const,
                    label: "Columns",
                    options: [
                        { label: "2", value: 2 },
                        { label: "3", value: 3 },
                        { label: "4", value: 4 }
                    ]
                },
                gap: tokenSelect(theme, "space", "Gap"),
                col1: { type: "slot" as const },
                col2: { type: "slot" as const },
                col3: { type: "slot" as const },
                col4: { type: "slot" as const }
            },
            defaultProps: { count: 2, gap: "md", col1: [], col2: [], col3: [], col4: [] },
            render: ({ count, gap, col1: Col1, col2: Col2, col3: Col3, col4: Col4 }: ColumnsProps) => {
                const cols = [Col1, Col2, Col3, Col4].slice(0, count)
                return (
                    <div
                        className="cmp-columns"
                        style={vars({ "--cmp-columns-count": String(count), "--cmp-columns-gap": tokenVar("space", gap) })}
                    >
                        {cols.map((Col, i) => (
                            <div className="cmp-columns__col" key={i}>
                                <Col />
                            </div>
                        ))}
                    </div>
                )
            }
        },
        Heading: {
            label: "Heading",
            fields: {
                text: { type: "text" as const, label: "Text" },
                level: {
                    type: "select" as const,
                    label: "Level",
                    options: [
                        { label: "H1", value: "h1" },
                        { label: "H2", value: "h2" },
                        { label: "H3", value: "h3" },
                        { label: "H4", value: "h4" }
                    ]
                },
                typography: tokenSelect(theme, "typography", "Typography"),
                align: {
                    type: "select" as const,
                    label: "Alignment",
                    options: [
                        { label: "Start", value: "start" },
                        { label: "Center", value: "center" },
                        { label: "End", value: "end" }
                    ]
                }
            },
            defaultProps: { text: "Heading", level: "h2", typography: "display", align: "start" },
            render: ({ text, level, typography, align }: HeadingProps) => {
                const Tag = level
                return (
                    <Tag
                        className="cmp-heading"
                        style={vars({
                            "--cmp-heading-family": tokenVar("typography", typography, "family"),
                            "--cmp-heading-size": tokenVar("typography", typography, "size"),
                            "--cmp-heading-weight": tokenVar("typography", typography, "weight"),
                            "--cmp-heading-line-height": tokenVar("typography", typography, "line-height"),
                            "--cmp-heading-letter-spacing": tokenVar("typography", typography, "letter-spacing"),
                            "--cmp-heading-align": align
                        })}
                    >
                        {text}
                    </Tag>
                )
            }
        },
        RichText: {
            label: "Rich text",
            fields: {
                // Editor: the native richtext field (ProseMirror working value). Build: a passthrough so the
                // render receives the raw PT array (see header — Puck would otherwise blank it at build).
                body: isEditor ? { type: "richtext" as const, label: "Body" } : { type: "text" as const, label: "Body" }
            },
            defaultProps: { body: [] },
            render: ({ body }: RichTextProps) => (
                <div className="cmp-richtext">
                    {Array.isArray(body) ? <RichTextView value={body as PortableTextBlock[]} /> : (body as ReactNode)}
                </div>
            )
        },
        Image: {
            label: "Image",
            fields: {
                media: isEditor
                    ? { type: "custom" as const, label: "Image", render: mediaPickerRender }
                    : { type: "text" as const, label: "Image" },
                alt: { type: "text" as const, label: "Alt text (required)" },
                aspect: {
                    type: "select" as const,
                    label: "Aspect",
                    options: [
                        { label: "Original", value: "original" },
                        { label: "Landscape", value: "landscape" },
                        { label: "Portrait", value: "portrait" }
                    ]
                }
            },
            defaultProps: { alt: "", aspect: "original" },
            render: ({ media, alt, aspect }: ImageProps) => {
                if (!media?.url) return null
                return (
                    <img
                        className="cmp-image"
                        data-aspect={aspect}
                        src={media.url}
                        alt={alt}
                        width={media.width || undefined}
                        height={media.height || undefined}
                    />
                )
            }
        },
        Button: {
            label: "Button",
            fields: {
                label: { type: "text" as const, label: "Label" },
                href: { type: "text" as const, label: "Link URL" },
                variant: {
                    type: "select" as const,
                    label: "Variant",
                    options: [
                        { label: "Primary", value: "primary" },
                        { label: "Secondary", value: "secondary" },
                        { label: "Ghost", value: "ghost" }
                    ]
                }
            },
            defaultProps: { label: "Button", href: "#", variant: "primary" },
            render: ({ label, href, variant }: ButtonProps) => (
                <a className={`cmp-button cmp-button--${variant}`} href={sanitizeHref(href)}>
                    {label}
                </a>
            )
        },
        Spacer: {
            label: "Spacer",
            fields: { size: tokenSelect(theme, "space", "Size") },
            defaultProps: { size: "md" },
            render: ({ size }: SpacerProps) => (
                <div className="cmp-spacer" aria-hidden="true" style={vars({ "--cmp-spacer-size": tokenVar("space", size) })} />
            )
        },
        Divider: {
            label: "Divider",
            fields: {
                spaceAround: tokenSelect(theme, "space", "Space around"),
                color: tokenSelect(theme, "colors", "Color", true)
            },
            defaultProps: { spaceAround: "md", color: "" },
            render: ({ spaceAround, color }: DividerProps) => (
                <hr
                    className="cmp-divider"
                    style={vars({
                        "--cmp-divider-space": tokenVar("space", spaceAround),
                        ...(color ? { "--cmp-divider-color": tokenVar("colors", color) } : {})
                    })}
                />
            )
        }
    }

    return { components } as unknown as Config
}
