/**
 * lib/api/composition.ts
 *
 * Everything specific to a Composition record shape: field sanitization, the nested rating and
 * publication-info validators, the field spec, and the assert wrappers the /api/v1/works routes call.
 *
 * Built on record_spec.ts. d1.ts owns the COMPOSITION schema constant and the D1 execution around it.
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

import { Key, WorkType } from "./common.ts"
import {
    isValidPitchRange,
    isValidPosition,
    isValidYear,
    SUPPORTED_URI_TYPES,
    validateCitations,
    validateURIForType
} from "./validation.ts"
import { canonicalEnumValue, cleanText, preferIsbn13, sanitizeTags } from "./sanitize.ts"
import { MAX_LONG_TEXT_LENGTH, MAX_NAME_LENGTH, MAX_TAG_LENGTH, MAX_TAGS_PER_RECORD } from "../../consts.ts"
import {
    assertRecordBySpec,
    cleanStringField,
    isPlainObject,
    _allPositiveIntegers,
    _isEnumValue,
    _invalidNullableImage,
    _invalidNullableStringMaxLen,
    _invalidOptionalObject,
    _invalidStringMaxLen,
    _tagsRule,
    type RecordSpec
} from "./record_spec.ts"

/** Same purpose as {@link sanitizeComposerFields}, for a composition record: also case-unifies `type`/`key`
 *  against their closed option sets and prefers ISBN-13 in `publication_info.uri` and `citations`. */
function sanitizeCompositionFields(record: Record<string, any>): void {
    cleanStringField(record, "name")
    cleanStringField(record, "part")
    cleanStringField(record, "notes_pedagogical")
    cleanStringField(record, "notes_historical")
    cleanStringField(record, "notes_other")
    cleanStringField(record, "image")
    if (typeof record.type === "string") {
        const trimmed = cleanText(record.type)
        record.type = canonicalEnumValue(trimmed, Object.values(WorkType)) ?? trimmed
    }
    if (typeof record.key === "string") {
        const trimmed = cleanText(record.key)
        record.key = trimmed === "" ? trimmed : (canonicalEnumValue(trimmed, Object.values(Key)) ?? trimmed)
    }
    if (record.tags instanceof Array) {
        record.tags = sanitizeTags(record.tags, MAX_TAG_LENGTH, MAX_TAGS_PER_RECORD).tags
    }
    if (isPlainObject(record.publication_info)) {
        cleanStringField(record.publication_info, "name")
        cleanStringField(record.publication_info, "location")
        if (typeof record.publication_info.uri === "string") {
            record.publication_info.uri = preferIsbn13(record.publication_info.uri.trim())
        }
    }
    if (isPlainObject(record.citations)) {
        for (const key of Object.keys(record.citations)) {
            if (typeof record.citations[key] === "string") {
                record.citations[key] = preferIsbn13(record.citations[key])
            }
        }
    }
}

/**
 * Validates a single rating member (Suzuki or NYSSMA level). Each member is independently nullable: a
 * null is accepted (an unrated level), otherwise the value must be an integer within the member's range.
 *
 * @param value the rating member value
 * @param min the inclusive lower bound for a present (non-null) level
 * @param max the inclusive upper bound for a present (non-null) level
 * @returns true if the member is null or an in-range integer
 */
function validateRatingMember(value: any, min: number, max: number): boolean {
    if (value === null) {
        return true
    }
    return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
}

/**
 * Given an unknown object from JSON, determine if it is a valid CompositionRating. The suzuki and nyssma
 * members are independently nullable; when present, suzuki must be an integer in 1–10 and nyssma in 1–6
 * (mirrors the client-side constructRating bounds). In complete mode both members must be present and
 * valid; in partial mode at least one must be present and valid.
 *
 * @param record the record to check
 * @param partial whether a partial rating (a single member) is acceptable
 * @returns true if the record is a valid rating
 */
function validateCompRating(record: unknown, partial: boolean = false): boolean {
    if (typeof record !== "object" || record === null) {
        return false
    }
    const r = record as { [key: string]: any }

    const tests: boolean[] = [
        "suzuki" in r ? validateRatingMember(r.suzuki, 1, 10) : false,
        "nyssma" in r ? validateRatingMember(r.nyssma, 1, 6) : false
    ]
    return partial ? tests.some((test) => test) : tests.every((test) => test)
}

/** * Given an unknown object from JSON, determine if it is a complete PublicationInfo record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a PublicationInfo type if valid, or a string error message if invalid
 */
function validatePubInfo(record: unknown, partial: boolean = false): boolean {
    if (typeof record !== "object" || record === null) {
        return false
    }
    const r = record as { [key: string]: any }
    const tests: boolean[] = [
        "location" in r ? typeof r.location === "string" && r.location.length <= MAX_NAME_LENGTH : false,
        "name" in r ? typeof r.name === "string" && r.name.length <= MAX_NAME_LENGTH : false,
        // the publication year must be a positive integer (a 4-digit year is the expected form)
        "year" in r ? isValidYear(r.year) : false,
        "uri_type" in r ? typeof r.uri_type === "string" : false,
        "uri" in r ? typeof r.uri === "string" : false
    ]
    // The uri_type is authoritative: when present it must be a supported type, and a non-empty uri must
    // match that type's shape. This is enforced regardless of partial/complete so an inconsistent
    // type/URI pairing is always rejected (a blank uri carries nothing to validate against and is allowed,
    // since the uri column is nullable). A missing uri_type defers to the type checks above.
    if ("uri_type" in r && typeof r.uri_type === "string") {
        if (!SUPPORTED_URI_TYPES.includes(r.uri_type)) {
            return false
        }
        if ("uri" in r && typeof r.uri === "string" && r.uri.trim() !== "" && !validateURIForType(r.uri_type, r.uri)) {
            return false
        }
    }
    return partial ? tests.some((test) => test) : tests.every((test) => test)
}

/**
 * Produces a granular error message for an invalid publication_info, naming the exact offending subproperty
 * using its D1 column name (publish_location / publish_name / publish_year / uri_type / uri) so the import
 * preview can highlight the specific input. This never changes the accept/reject decision — it defers to
 * {@link validatePubInfo} for that and only computes a message when the value is already known to be invalid.
 *
 * @param record the publication_info value (already established to be an object by the field's base check)
 * @param partial whether a partial publication_info (at least one field) is acceptable
 * @returns a specific error message, or null when the value is valid
 */
function validatePubInfoDetail(record: unknown, partial: boolean): string | null {
    if (validatePubInfo(record, partial)) {
        return null
    }
    if (typeof record !== "object" || record === null) {
        return "Record has invalid value for publication_info (expected an object)"
    }
    const r = record as { [key: string]: any }
    // present-but-malformed subproperty (including the uri_type authority checks); report the first one
    if ("location" in r && (typeof r.location !== "string" || r.location.length > MAX_NAME_LENGTH)) {
        return `Record has invalid value for publish_location (expected text, ${MAX_NAME_LENGTH} characters or fewer)`
    }
    if ("name" in r && (typeof r.name !== "string" || r.name.length > MAX_NAME_LENGTH)) {
        return `Record has invalid value for publish_name (expected text, ${MAX_NAME_LENGTH} characters or fewer)`
    }
    if ("year" in r && !isValidYear(r.year)) {
        return "Record has invalid value for publish_year (expected a valid year)"
    }
    if ("uri_type" in r) {
        if (typeof r.uri_type !== "string" || !SUPPORTED_URI_TYPES.includes(r.uri_type)) {
            return `Record has invalid value for uri_type (expected one of: ${SUPPORTED_URI_TYPES.join(", ")})`
        }
        if ("uri" in r && typeof r.uri === "string" && r.uri.trim() !== "" && !validateURIForType(r.uri_type, r.uri)) {
            return "Record has invalid value for uri (does not match the selected uri_type)"
        }
    }
    if ("uri" in r && typeof r.uri !== "string") {
        return "Record has invalid value for uri (expected text)"
    }
    // otherwise the failure is a missing required subproperty (complete mode)
    const required: Array<[string, boolean]> = [
        ["publish_location", "location" in r],
        ["publish_name", "name" in r],
        ["publish_year", "year" in r],
        ["uri_type", "uri_type" in r],
        ["uri", "uri" in r]
    ]
    const missing = required.filter(([, present]) => !present).map(([column]) => column)
    if (missing.length > 0) {
        return `Record is missing required publication_info field(s): ${missing.join(", ")}`
    }
    return "Record has invalid value for publication_info"
}

/**
 * Produces a granular error message for an invalid rating, naming the offending member using its D1 column
 * name (rating_suzuki / rating_nyssma). Like {@link validatePubInfoDetail}, it defers the accept/reject
 * decision to {@link validateCompRating} and only computes a message for an already-invalid value.
 *
 * @param record the rating value (already established to be a non-null object by the field's base check)
 * @param partial whether a partial rating (a single member) is acceptable
 * @returns a specific error message, or null when the value is valid
 */
function validateCompRatingDetail(record: unknown, partial: boolean): string | null {
    if (validateCompRating(record, partial)) {
        return null
    }
    if (typeof record !== "object" || record === null) {
        return "Record has invalid value for rating (expected an object)"
    }
    const r = record as { [key: string]: any }
    if ("suzuki" in r && !validateRatingMember(r.suzuki, 1, 10)) {
        return "Record has invalid value for rating_suzuki (expected an integer 1–10, or null)"
    }
    if ("nyssma" in r && !validateRatingMember(r.nyssma, 1, 6)) {
        return "Record has invalid value for rating_nyssma (expected an integer 1–6, or null)"
    }
    return "Record has invalid value for rating"
}

/** Field spec for Composition records. */
const COMPOSITION_SPEC: RecordSpec = {
    name: { invalid: _invalidStringMaxLen(MAX_NAME_LENGTH) },
    // id references must be positive integers (1-based record ids)
    composer_id: { invalid: (v) => typeof v !== "number" || !Number.isInteger(v) || v < 1 },
    contrib_primary_1: { invalid: (v) => typeof v !== "number" || !Number.isInteger(v) || v < 1 },
    contrib_primary_2: { invalid: (v) => v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 1) },
    contrib_addl: {
        invalid: (v) => !(v instanceof Array),
        elementCheck: (v) =>
            v.length > 0 && !_allPositiveIntegers(v)
                ? "Record has invalid value for contrib_addl parameter (expected positive integer ids)"
                : null
    },
    author_secondary: {
        invalid: (v) => !(v instanceof Array),
        elementCheck: (v) =>
            v.length > 0 && !_allPositiveIntegers(v)
                ? "Record has invalid value for author_secondary parameter (expected positive integer ids)"
                : null
    },
    phases: {
        invalid: (v) => !(v instanceof Array),
        elementCheck: (v) =>
            v.length > 0 && !_allPositiveIntegers(v)
                ? "Record has invalid value for phases parameter (expected positive integers)"
                : null
    },
    // type is a required, closed option set: the value must be one of the WorkType enum values
    type: { invalid: (v) => !_isEnumValue(v, WorkType) },
    part: { invalid: _invalidNullableStringMaxLen(MAX_NAME_LENGTH) },
    // key is nullable and a blank string is tolerated (mapped to a cleared value); a non-blank value must
    // be one of the Key enum values
    key: { invalid: (v) => v !== null && (typeof v !== "string" || (v.trim() !== "" && !_isEnumValue(v, Key))) },
    // range: a two-note pitch range (e.g. G3-A5); position_highest: a Roman numeral or integer. Both are
    // nullable, and a blank string is tolerated (mapped to a cleared value); a non-blank value must match.
    range: { invalid: (v) => v !== null && (typeof v !== "string" || (v.trim() !== "" && !isValidPitchRange(v))) },
    position_highest: {
        invalid: (v) => v !== null && (typeof v !== "string" || (v.trim() !== "" && !isValidPosition(v)))
    },
    notes_pedagogical: { invalid: _invalidNullableStringMaxLen(MAX_LONG_TEXT_LENGTH) },
    notes_historical: { invalid: _invalidNullableStringMaxLen(MAX_LONG_TEXT_LENGTH) },
    notes_other: { invalid: _invalidNullableStringMaxLen(MAX_LONG_TEXT_LENGTH) },
    image: { invalid: _invalidNullableImage },
    // rating is nullable only in complete mode; in partial mode a present rating must validate. The base
    // check only rejects the hard cases (a non-object, or a null where null is not allowed); the granular
    // per-member validation runs in elementCheck so the offending member (rating_suzuki / rating_nyssma) can
    // be named. The union of the two reproduces the original accept/reject exactly.
    rating: {
        invalid: (v, partial) => (partial ? typeof v !== "object" || v === null : v !== null && typeof v !== "object"),
        elementCheck: (v, partial) => (v === null ? null : validateCompRatingDetail(v, partial))
    },
    // publication_info is required and non-null; the base check only rejects a non-object, and the granular
    // per-subproperty validation (naming publish_name/publish_year/uri_type/uri) runs in elementCheck.
    publication_info: {
        invalid: (v) => typeof v !== "object" || v === null,
        elementCheck: (v, partial) => validatePubInfoDetail(v, partial)
    },
    // citations is optional; when present, every entry must be a non-blank source name mapped to an
    // https link, DOI, or ISBN (validateCitations)
    citations: {
        invalid: _invalidOptionalObject,
        elementCheck: (v) => (v === undefined || v === null ? null : validateCitations(v))
    },
    tags: _tagsRule
}

/**
 * Given an unknown object from JSON, determine if it is a complete Composition record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a Composition type if valid, or a string error message if invalid
 */
export function _stateTypeAssertCompleteComposition(record: unknown, expect_id: boolean = true): Composition | string {
    if (isPlainObject(record)) {
        sanitizeCompositionFields(record)
    }
    const result = assertRecordBySpec(record, COMPOSITION_SPEC, false, expect_id)
    return result === true ? (record as Composition) : result
}

/**
 * Given an unknown object from JSON, determine if it is a valid partial Composition record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a partial Composition type if valid, or a string error message if invalid
 */
export function _stateTypeAssertPartialComposition(
    record: unknown,
    expect_id: boolean = true
): Partial<Composition> | string {
    if (isPlainObject(record)) {
        sanitizeCompositionFields(record)
    }
    const result = assertRecordBySpec(record, COMPOSITION_SPEC, true, expect_id)
    return result === true ? (record as Partial<Composition>) : result
}
