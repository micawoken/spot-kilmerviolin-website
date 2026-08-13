/**
 * lib/api/record_spec.ts
 *
 * The declarative record-validation engine shared by the three entity record modules (composer.ts,
 * composition.ts, contributor.ts): the per-field rule shape, the spec walker that applies it, and the
 * field predicates every spec is assembled from.
 *
 * Split out of d1.ts, which keeps the D1 execution primitives and the schema-level type assertions. The
 * dependency runs one way — the entity modules import this, this imports neither of them — so the specs
 * can name their own validators without a cycle.
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

import { isValidEmail, isValidImageUrl } from "./validation.ts"
import { cleanText } from "./sanitize.ts"
import { MAX_TAG_LENGTH, MAX_TAGS_PER_RECORD } from "../../consts.ts"

/**
 * A per-field validation rule consumed by {@link assertRecordBySpec}.
 *   - `invalid` returns true when a present (non-undefined) value is invalid for the field; it
 *     receives the `partial` flag for the few fields whose rule depends on it (rating/pub info).
 *   - `elementCheck` performs a secondary array-element validation, returning a field-specific
 *     error message or null. It only runs after every base check has passed.
 */
export type FieldRule = {
    invalid: (value: any, partial: boolean) => boolean
    elementCheck?: (value: any, partial: boolean) => string | null
}

export type RecordSpec = { [field: string]: FieldRule }

/**
 * Shared, declarative implementation of the per-type record validators below. It reproduces the
 * checks the hand-written validators previously inlined, in the same order and with identical error
 * strings:
 *   - the id column keeps its special rule (a number, or absent/undefined when expect_id is false)
 *   - in partial mode an undefined field is skipped; in complete mode an absent field fails its own
 *     base check (typeof undefined never matches a base type), so presence is enforced implicitly
 *   - base type checks run first (any failure yields the generic message); array-element checks run
 *     afterwards in spec order so their field-specific messages are preserved
 *
 * @returns true if the record satisfies the spec, otherwise a string error message
 */
export function assertRecordBySpec(
    record: unknown,
    spec: RecordSpec,
    partial: boolean,
    expect_id: boolean
): true | string {
    // type guard
    if (typeof record !== "object" || record === null) {
        return "Record is not an object"
    }
    const r = record as { [key: string]: any }
    // collect every field that fails its base check so the caller can report exactly what is invalid,
    // rather than a single generic message. In complete mode an absent field fails its own base check
    // (typeof undefined never matches a base type), so a missing required field is named here too.
    const invalid_fields: string[] = []
    // id is nullable on inbound records: it must be a number, or absent (undefined) when not expected
    if (typeof r.id !== "number" && (typeof r.id !== "undefined" || expect_id)) {
        invalid_fields.push("id")
    }
    for (const field in spec) {
        const value = r[field]
        if (partial && value === undefined) {
            continue
        }
        if (spec[field].invalid(value, partial)) {
            invalid_fields.push(field)
        }
    }
    if (invalid_fields.length > 0) {
        return `Record has invalid or missing values for parameter(s): ${invalid_fields.join(", ")}`
    }
    // validate arrays are of correct type, once all base checks have passed; these carry their own
    // field-specific messages describing the expected element type
    for (const field in spec) {
        const elementCheck = spec[field].elementCheck
        if (!elementCheck) {
            continue
        }
        const value = r[field]
        if (partial && value === undefined) {
            continue
        }
        const error = elementCheck(value, partial)
        if (error) {
            return error
        }
    }
    return true
}

// shared field predicates: each returns true when the value is invalid for that field
export const _invalidBoolean = (v: any) => typeof v !== "boolean"
// nullable variants accept null alongside the base type
// a nullable image field: null, or a string that (when non-blank) is a valid image URL or internal path
export const _invalidNullableImage = (v: any) =>
    v !== null && (typeof v !== "string" || (v.trim() !== "" && !isValidImageUrl(v)))
// a nullable email field: null, or a string that (when non-blank) is a valid email address
export const _invalidNullableEmail = (v: any) =>
    v !== null && (typeof v !== "string" || (v.trim() !== "" && !isValidEmail(v)))
// an optional key-value object field (citations): undefined/null is valid (the field is optional); a
// present value must be a non-array object, with per-entry format errors surfaced via elementCheck
export const _invalidOptionalObject = (v: any) =>
    v !== undefined && v !== null && (typeof v !== "object" || Array.isArray(v))
// every element of an array is a positive integer (used for id and phase-number lists)
export const _allPositiveIntegers = (v: any[]) =>
    v.every((item: any) => typeof item === "number" && Number.isInteger(item) && item >= 1)
// membership in a string enum's VALUES (string enums have no reverse key mapping, so `v in Enum` would
// wrongly test the enum's keys); used to enforce the closed option sets for a composition's type and key
export const _isEnumValue = (v: any, members: Record<string, string>) =>
    typeof v === "string" && (Object.values(members) as string[]).includes(v)
// a required string field additionally bounded by a max length (block, not silently truncate, on overflow)
export const _invalidStringMaxLen = (maxLen: number) => (v: any) => typeof v !== "string" || v.length > maxLen
// a nullable string field additionally bounded by a max length
export const _invalidNullableStringMaxLen = (maxLen: number) => (v: any) =>
    (typeof v !== "string" && v !== null) || (typeof v === "string" && v.length > maxLen)
// tags is optional (mirrors citations/_invalidOptionalObject — every existing caller either omits it or
// supplies []) and, when present, must be an array of strings; length/count hygiene is enforced in
// elementCheck. The array itself is already deduplicated/trimmed by the sanitize* functions below before
// validation runs, so a violation reported here reflects the post-hygiene (deduplicated) list.
export const _tagsRule: FieldRule = {
    invalid: (v) => v !== undefined && v !== null && !(v instanceof Array),
    elementCheck: (v) => {
        if (v === undefined || v === null) {
            return null
        }
        if (!v.every((tag: any) => typeof tag === "string")) {
            return "Record has invalid type for tags parameter"
        }
        const overLong = v.find((tag: string) => tag.length > MAX_TAG_LENGTH)
        if (overLong !== undefined) {
            return `Record has a tag exceeding ${MAX_TAG_LENGTH} characters`
        }
        if (v.length > MAX_TAGS_PER_RECORD) {
            return `Record has too many tags (${v.length}); at most ${MAX_TAGS_PER_RECORD} are allowed`
        }
        return null
    }
}

/** Trims and control-character-strips a present string field in place; an absent or non-string value is
 *  left untouched so the field's own base type check still reports it accurately. */
export function cleanStringField(record: Record<string, any>, field: string): void {
    if (typeof record[field] === "string") {
        record[field] = cleanText(record[field])
    }
}

export const isPlainObject = (v: unknown): v is Record<string, any> =>
    typeof v === "object" && v !== null && !Array.isArray(v)
