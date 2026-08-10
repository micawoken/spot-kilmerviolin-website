/**
 * lib/api/contributor.ts
 *
 * Everything specific to a Contributor record shape: field sanitization, the field spec, and the assert
 * wrappers the /api/v1/contributors and identity routes call.
 *
 * Built on record_spec.ts. d1.ts owns the CONTRIBUTOR schema constant and the D1 execution around it.
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

import { isValidEmail, isValidYear } from "./validation.ts"
import { cleanText, normalizeUnicodeForm, sanitizeTags } from "./sanitize.ts"
import { MAX_LONG_TEXT_LENGTH, MAX_NAME_LENGTH, MAX_TAG_LENGTH, MAX_TAGS_PER_RECORD } from "../../consts.ts"
import {
    assertRecordBySpec,
    cleanStringField,
    isPlainObject,
    _allPositiveIntegers,
    _invalidBoolean,
    _invalidNullableEmail,
    _invalidNullableImage,
    _invalidNullableStringMaxLen,
    _invalidStringMaxLen,
    _tagsRule,
    type RecordSpec
} from "./record_spec.ts"

/** Same purpose as {@link sanitizeComposerFields}, for a contributor record. `roles` is a
 *  permission-adjacent field (see database.ts's authorization note), so only whitespace/control-character
 *  cleanup is applied to it — no dedup or case change, to avoid altering its semantics. */
function sanitizeContributorFields(record: Record<string, any>): void {
    if (typeof record.name === "string") {
        record.name = normalizeUnicodeForm(cleanText(record.name))
    }
    cleanStringField(record, "major")
    cleanStringField(record, "bio")
    cleanStringField(record, "public_email")
    cleanStringField(record, "identity_email")
    cleanStringField(record, "image")
    if (record.tags instanceof Array) {
        record.tags = sanitizeTags(record.tags, MAX_TAG_LENGTH, MAX_TAGS_PER_RECORD).tags
    }
    if (record.roles instanceof Array) {
        record.roles = record.roles.map((role: any) => (typeof role === "string" ? cleanText(role) : role))
    }
}

/** Field spec for Contributor records. */
const CONTRIBUTOR_SPEC: RecordSpec = {
    name: { invalid: _invalidStringMaxLen(MAX_NAME_LENGTH) },
    // class_year, major, and phases are nullable columns, so null is accepted alongside their base types
    // class_year, when present, is a positive (4-digit) year
    class_year: { invalid: (v) => v !== null && (typeof v !== "number" || !isValidYear(v)) },
    major: { invalid: _invalidNullableStringMaxLen(MAX_NAME_LENGTH) },
    phases: {
        invalid: (v) => !(v instanceof Array) && v !== null,
        // phase numbers must be positive integers
        elementCheck: (v) =>
            v !== null && v.length > 0 && !_allPositiveIntegers(v)
                ? "Record has invalid value for phases parameter (expected positive integers)"
                : null
    },
    bio: { invalid: _invalidNullableStringMaxLen(MAX_LONG_TEXT_LENGTH) },
    public_email: { invalid: _invalidNullableEmail },
    // identity_email is filled with a generated fallback address before validation when blank, so by the
    // time it reaches here it is always a present, non-blank string and must be a valid email
    identity_email: { invalid: (v) => typeof v !== "string" || !isValidEmail(v) },
    active: { invalid: _invalidBoolean },
    roles: {
        invalid: (v) => !(v instanceof Array),
        elementCheck: (v) =>
            !v.every((role: any) => typeof role === "string") && v.length > 0
                ? "Record has invalid type for roles parameter"
                : null
    },
    admin: { invalid: _invalidBoolean },
    image: { invalid: _invalidNullableImage },
    tags: _tagsRule
}

/**
 * Given an unknown object from JSON, determine if it is a complete Contributor record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a Contributor type if valid, or a string error message if invalid
 */
export function _stateTypeAssertCompleteContributor(record: unknown, expect_id: boolean = true): Contributor | string {
    if (isPlainObject(record)) {
        sanitizeContributorFields(record)
    }
    const result = assertRecordBySpec(record, CONTRIBUTOR_SPEC, false, expect_id)
    return result === true ? (record as Contributor) : result
}

/**
 * Given an unknown object from JSON, determine if it is a valid partial Contributor record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a partial Contributor type if valid, or a string error message if invalid
 */
export function _stateTypeAssertPartialContributor(
    record: unknown,
    expect_id: boolean = true
): Partial<Contributor> | string {
    if (isPlainObject(record)) {
        sanitizeContributorFields(record)
    }
    const result = assertRecordBySpec(record, CONTRIBUTOR_SPEC, true, expect_id)
    return result === true ? (record as Partial<Contributor>) : result
}
