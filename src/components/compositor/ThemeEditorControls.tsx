/**
 * components/compositor/ThemeEditorControls.tsx
 *
 * Provides user-friendly controls for the theme editor (not raw CSS editing)
 * 
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

import { TEXT_TRANSFORMS, type TokenKind } from "../../lib/compositor/tokens"
import {
    LENGTH_UNITS,
    formatClamp,
    formatLength,
    formatLightDark,
    formatShadow,
    isHexColor,
    parseClamp,
    parseLength,
    parseLightDark,
    parseShadow,
    type ShadowLayer
} from "../../lib/compositor/theme-controls"

/**
 * Type of friendly control used
 */
export type ControlKind = "text" | "color" | "length" | "clamp" | "shadow" | "family" | "weight" | "style" | "checkbox" | "transform"

/** One editable field within a token kind's row. `color` adds a swatch preview. */
export interface FieldSpec {
    key: string
    label: string
    color?: boolean
    optional?: boolean
    /** The friendly control for this field (see `ControlKind`); defaults to the raw text input. */
    control?: ControlKind
    /**
     * Field holds a JS boolean, not a CSS value string
     */
    valueType?: "boolean"
    /**
     * When set, field is a REFERENCE to another token (by name) of that kind — renders as a `<select>`
     * over that kind's names, not free text
     */
    refKind?: TokenKind
    /**
     * Allows use without unit specified, only meaningful if control is length
     */
    allowUnitless?: boolean
}

/**
 * A token-reference select: names available in the referenced kind, plus unset and now-missing states —
 * a stored value is never silently rewritten to the first option
 */
export function RefSelect({
    names,
    value,
    optional,
    onChange
}: {
    names: string[]
    value: string
    optional?: boolean
    onChange: (value: string) => void
}) {
    const available = names.filter((name) => name !== "")
    const missing = value !== "" && !available.includes(value)
    return (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
            {(optional || value === "") && <option value="">{optional ? "— none —" : "— choose —"}</option>}
            {missing && <option value={value}>{value} (missing)</option>}
            {available.map((name) => (
                <option key={name} value={name}>
                    {name}
                </option>
            ))}
        </select>
    )
}

/** A plain free-text token input — the raw view of any cell, and the fallback for a value no friendly
 * control can round-trip. */
export function TextControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return <input type="text" value={value} onChange={(event) => onChange(event.target.value)} />
}

/**
 * A boolean flag control (e.g. italic/bold/underline defaults). Always a checkbox in both views — no
 * "raw CSS string" form of a JS boolean to fall back to, unlike every other control here. Row storage:
 * checked = `"true"`, unchecked = `""`.
 */
export function CheckboxControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return <input type="checkbox" checked={value === "true"} onChange={(event) => onChange(event.target.checked ? "true" : "")} />
}

/**
 * A number field plus a unit dropdown - number is parsed, with fall-back to plain text if not
 * parseable
 */
export function LengthControl({
    value,
    onChange,
    allowUnitless = false
}: {
    value: string
    onChange: (value: string) => void
    allowUnitless?: boolean
}) {
    if (value.trim() !== "" && parseLength(value) === null) return <TextControl value={value} onChange={onChange} />
    const parts = parseLength(value) ?? { number: "", unit: "" as (typeof LENGTH_UNITS)[number] }
    const emit = (num: string, unit: (typeof LENGTH_UNITS)[number]) =>
        onChange(num === "" ? "" : formatLength({ number: num, unit: unit === "" && !allowUnitless ? "rem" : unit }))
    const units = allowUnitless || parts.unit === "" ? LENGTH_UNITS : LENGTH_UNITS.filter((unit) => unit !== "")
    return (
        <span className="theme-editor__length">
            <input
                type="number"
                step="any"
                value={parts.number}
                onChange={(event) => emit(event.target.value, parts.unit)}
            />
            <select value={parts.unit} onChange={(event) => emit(parts.number, event.target.value as typeof parts.unit)}>
                {units.map((unit) => (
                    <option key={unit} value={unit}>
                        {unit === "" ? "—" : unit}
                    </option>
                ))}
            </select>
        </span>
    )
}

/**
 * Coerces a hex color to `#rrggbb` for a native `<input type="color">` (can't show 3/4/8-digit hex or
 * alpha). Display only — the authored string stays source of truth in the paired text field.
 */
function toColorInputValue(hex: string): string {
    const match = /^#([0-9a-f]{3,8})$/i.exec(hex.trim())
    if (!match) return "#000000"
    const digits = match[1].toLowerCase()
    if (digits.length === 3 || digits.length === 4) {
        return "#" + [...digits.slice(0, 3)].map((digit) => digit + digit).join("")
    }
    return "#" + digits.slice(0, 6).padEnd(6, "0")
}

/**
 * One color channel: text field holding the exact CSS color, plus a native picker when the value is hex
 * (picker only round-trips `#rrggbb`)
 */
function ColorChannel({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return (
        <span className="theme-editor__channel">
            {isHexColor(value) && (
                <input
                    type="color"
                    value={toColorInputValue(value)}
                    onChange={(event) => onChange(event.target.value)}
                    aria-label="Color picker"
                />
            )}
            <input
                type="text"
                value={value}
                placeholder="#000000 or rgb(…)"
                onChange={(event) => onChange(event.target.value)}
            />
        </span>
    )
}

/** A color editor. `adaptive`: `light-dark(L, D)` as two channels (plain color seeds both; first edit
 * becomes a pair). `fixed`: single channel — a stored `light-dark()` there is out of step with the
 * scheme, falls back to raw text rather than dropping the dark channel. Emits a plain color when only
 * one channel is filled, so a half-authored pair never produces invalid `light-dark(x, )`. */
export function ColorControl({
    value,
    scheme,
    onChange
}: {
    value: string
    scheme: "adaptive" | "fixed"
    onChange: (value: string) => void
}) {
    if (scheme === "fixed") {
        if (value.trim() !== "" && parseLightDark(value) !== null) return <TextControl value={value} onChange={onChange} />
        return <ColorChannel value={value} onChange={onChange} />
    }
    const pair = parseLightDark(value) ?? { light: value, dark: value }
    const emit = (light: string, dark: string) => {
        if (light.trim() === "" && dark.trim() === "") onChange("")
        else if (dark.trim() === "") onChange(light)
        else if (light.trim() === "") onChange(dark)
        else onChange(formatLightDark({ light, dark }))
    }
    return (
        <span className="theme-editor__color">
            <label className="theme-editor__channel-label">
                Light
                <ColorChannel value={pair.light} onChange={(light) => emit(light, pair.dark)} />
            </label>
            <label className="theme-editor__channel-label">
                Dark
                <ColorChannel value={pair.dark} onChange={(dark) => emit(pair.light, dark)} />
            </label>
        </span>
    )
}

/** A size editor with two modes. `clamp(min, preferred, max)`: three length sub-controls plus a button
 * to collapse to the ideal value. Otherwise: fixed size, one length control, button to make it
 * responsive. Neither falls back to raw text for a bare `calc()`; each sub-control is its own
 * `LengthControl`, so a `calc()` inside a clamp stays raw. */
export function ClampControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    const clamp = parseClamp(value)
    if (clamp) {
        return (
            <span className="theme-editor__clamp">
                <label className="theme-editor__sub-label">
                    Min
                    <LengthControl value={clamp.min} onChange={(min) => onChange(formatClamp({ ...clamp, min }))} />
                </label>
                <label className="theme-editor__sub-label">
                    Ideal
                    <LengthControl
                        value={clamp.preferred}
                        onChange={(preferred) => onChange(formatClamp({ ...clamp, preferred }))}
                    />
                </label>
                <label className="theme-editor__sub-label">
                    Max
                    <LengthControl value={clamp.max} onChange={(max) => onChange(formatClamp({ ...clamp, max }))} />
                </label>
                <button type="button" className="theme-editor__linkbtn" onClick={() => onChange(clamp.preferred)}>
                    Use a fixed size
                </button>
            </span>
        )
    }
    if (value.trim() !== "" && parseLength(value) === null) return <TextControl value={value} onChange={onChange} />
    const base = value.trim() !== "" ? value : "1rem"
    return (
        <span className="theme-editor__clamp theme-editor__clamp--fixed">
            <LengthControl value={value} onChange={onChange} />
            <button
                type="button"
                className="theme-editor__linkbtn"
                onClick={() => onChange(formatClamp({ min: base, preferred: base, max: base }))}
            >
                Make responsive
            </button>
        </span>
    )
}

/** A blank shadow layer seeded with a soft drop shadow, so a new layer is immediately visible. */
const NEW_SHADOW_LAYER: ShadowLayer = { inset: false, x: "0", y: "1px", blur: "2px", spread: "", color: "#00000040" }

/** A `box-shadow` builder: one row per layer (inset toggle, x/y/blur/spread, color), plus add/remove.
 * Empty or `none` starts with no layers; a value the parser can't round-trip falls back to raw text.
 * Removing every layer emits `none`. */
export function ShadowControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    let layers: ShadowLayer[]
    if (value.trim() === "") {
        layers = []
    } else {
        const parsed = parseShadow(value)
        if (parsed === null) return <TextControl value={value} onChange={onChange} />
        layers = parsed
    }
    const update = (next: ShadowLayer[]) => onChange(formatShadow(next))
    const setLayer = (index: number, patch: Partial<ShadowLayer>) =>
        update(layers.map((layer, position) => (position === index ? { ...layer, ...patch } : layer)))
    return (
        <span className="theme-editor__shadow">
            {layers.map((layer, index) => (
                <span key={index} className="theme-editor__shadow-layer">
                    <label className="theme-editor__sub-label">
                        <input
                            type="checkbox"
                            checked={layer.inset}
                            onChange={(event) => setLayer(index, { inset: event.target.checked })}
                        />
                        Inset
                    </label>
                    <label className="theme-editor__sub-label">
                        X
                        <LengthControl value={layer.x} onChange={(x) => setLayer(index, { x })} />
                    </label>
                    <label className="theme-editor__sub-label">
                        Y
                        <LengthControl value={layer.y} onChange={(y) => setLayer(index, { y })} />
                    </label>
                    <label className="theme-editor__sub-label">
                        Blur
                        <LengthControl value={layer.blur} onChange={(blur) => setLayer(index, { blur })} />
                    </label>
                    <label className="theme-editor__sub-label">
                        Spread
                        <LengthControl value={layer.spread} onChange={(spread) => setLayer(index, { spread })} />
                    </label>
                    <label className="theme-editor__sub-label">
                        Color
                        <ColorChannel value={layer.color} onChange={(color) => setLayer(index, { color })} />
                    </label>
                    <button
                        type="button"
                        className="theme-editor__linkbtn"
                        onClick={() => update(layers.filter((_, position) => position !== index))}
                    >
                        Remove layer
                    </button>
                </span>
            ))}
            <button type="button" className="theme-editor__linkbtn" onClick={() => update([...layers, NEW_SHADOW_LAYER])}>
                Add layer
            </button>
        </span>
    )
}

/** The font weights the dropdown offers; a value outside this set is preserved as a custom option. */
const FONT_WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"] as const

/** The border-style keywords the dropdown offers; a value outside this set is preserved as a custom option. */
const BORDER_STYLES = ["none", "solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset"] as const

/** A few system font stacks offered by `FamilySelect` alongside the theme's declared web fonts. */
const SYSTEM_STACKS: { label: string; value: string }[] = [
    { label: "System sans-serif", value: "system-ui, sans-serif" },
    { label: "System serif", value: "Georgia, 'Times New Roman', serif" },
    { label: "Monospace", value: "ui-monospace, SFMono-Regular, Menlo, monospace" }
]

/** A `<select>` over a fixed keyword set that never rewrites an unrecognized value: out-of-set shows as
 * "(custom)" and is preserved; empty shows "— choose —". Editing an unusual value needs raw mode — the
 * dropdown covers common cases without ever clobbering one. */
export function KeywordSelect({
    value,
    options,
    onChange
}: {
    value: string
    options: readonly string[]
    onChange: (value: string) => void
}) {
    const known = options.includes(value)
    return (
        <select value={value} onChange={(event) => onChange(event.target.value)}>
            {value === "" && <option value="">— choose —</option>}
            {!known && value !== "" && <option value={value}>{value} (custom)</option>}
            {options.map((option) => (
                <option key={option} value={option}>
                    {option}
                </option>
            ))}
        </select>
    )
}

/** A font-family picker: theme's web fonts + a few system stacks, plus a "Custom…" escape to a text
 * field. Stored value is the full CSS font stack; picking a web font composes `"Family", sans-serif`,
 * an unrecognized stack opens in the custom field, preserved exactly. */
export function FamilySelect({
    value,
    families,
    onChange
}: {
    value: string
    families: string[]
    onChange: (value: string) => void
}) {
    const options = [
        ...SYSTEM_STACKS,
        ...families
            .filter((family) => family.trim() !== "")
            .map((family) => ({ label: `${family} (web font)`, value: `"${family}", sans-serif` }))
    ]
    const matched = options.some((option) => option.value === value)
    const [custom, setCustom] = useState(value !== "" && !matched)
    const showCustom = custom || (value !== "" && !matched)
    return (
        <span className="theme-editor__family">
            <select
                value={showCustom ? "__custom__" : value}
                onChange={(event) => {
                    if (event.target.value === "__custom__") {
                        setCustom(true)
                    } else {
                        setCustom(false)
                        onChange(event.target.value)
                    }
                }}
            >
                {value === "" && !showCustom && <option value="">— choose —</option>}
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
                <option value="__custom__">Custom…</option>
            </select>
            {showCustom && (
                <input
                    type="text"
                    value={value}
                    placeholder="e.g. Spectral, serif"
                    onChange={(event) => onChange(event.target.value)}
                />
            )}
        </span>
    )
}

/** Renders the right editor for one token cell. A reference field is always `RefSelect` (both views).
 * Raw mode: everything else is plain text. Friendly mode: `control` selects a friendly editor,
 * unannotated falls through to text. Both views always edit the same stored string — the raw toggle
 * can never disagree. */
export function CellControl({
    field,
    value,
    rawMode,
    colorScheme,
    refNames,
    fontFamilies,
    onChange
}: {
    field: FieldSpec
    value: string
    rawMode: boolean
    colorScheme: "adaptive" | "fixed"
    refNames: string[]
    fontFamilies: string[]
    onChange: (value: string) => void
}) {
    if (field.refKind) {
        return <RefSelect names={refNames} value={value} optional={field.optional} onChange={onChange} />
    }
    if (field.valueType === "boolean") {
        return <CheckboxControl value={value} onChange={onChange} />
    }
    if (!rawMode) {
        switch (field.control) {
            case "length":
                return <LengthControl value={value} onChange={onChange} allowUnitless={field.allowUnitless} />
            case "color":
                return <ColorControl value={value} scheme={colorScheme} onChange={onChange} />
            case "clamp":
                return <ClampControl value={value} onChange={onChange} />
            case "shadow":
                return <ShadowControl value={value} onChange={onChange} />
            case "weight":
                return <KeywordSelect value={value} options={FONT_WEIGHTS} onChange={onChange} />
            case "style":
                return <KeywordSelect value={value} options={BORDER_STYLES} onChange={onChange} />
            case "transform":
                return <KeywordSelect value={value} options={TEXT_TRANSFORMS} onChange={onChange} />
            case "family":
                return <FamilySelect value={value} families={fontFamilies} onChange={onChange} />
        }
    }
    return <TextControl value={value} onChange={onChange} />
}
