/**
 * lib/api/composer.ts
 *
 * Performs operations related to composers
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

import { AuthorRole } from "./common.ts"
import { isDeathYearConsistent, isValidCountryCode, isValidYear, validateCitations } from "./validation.ts"
import { canonicalEnumValue, cleanText, normalizeUnicodeForm, preferIsbn13, sanitizeTags } from "./sanitize.ts"
import { MAX_LONG_TEXT_LENGTH, MAX_NAME_LENGTH, MAX_TAG_LENGTH, MAX_TAGS_PER_RECORD } from "../../consts.ts"
import {
    assertRecordBySpec,
    cleanStringField,
    isPlainObject,
    _invalidNullableImage,
    _invalidNullableStringMaxLen,
    _invalidOptionalObject,
    _invalidStringMaxLen,
    _tagsRule,
    type RecordSpec
} from "./record_spec.ts"

/**
 * Applies general clean-up of data
 */
function sanitizeComposerFields(record: Record<string, any>): void {
    if (typeof record.name === "string") {
        record.name = normalizeUnicodeForm(cleanText(record.name))
    }
    cleanStringField(record, "role")
    if (typeof record.role === "string") {
        record.role = canonicalEnumValue(record.role, Object.values(AuthorRole)) ?? record.role
    }
    cleanStringField(record, "bio")
    cleanStringField(record, "image")
    if (record.tags instanceof Array) {
        record.tags = sanitizeTags(record.tags, MAX_TAG_LENGTH, MAX_TAGS_PER_RECORD).tags
    }
    if (isPlainObject(record.citations)) {
        for (const key of Object.keys(record.citations)) {
            if (typeof record.citations[key] === "string") {
                record.citations[key] = preferIsbn13(record.citations[key])
            }
        }
    }
}

/** Field spec for Composer records. */
const COMPOSER_SPEC: RecordSpec = {
    name: { invalid: _invalidStringMaxLen(MAX_NAME_LENGTH) },
    role: { invalid: _invalidStringMaxLen(MAX_NAME_LENGTH) },
    // birth_year is a positive (4-digit) year; death_year additionally permits the -1 "living" sentinel
    birth_year: { invalid: (v) => typeof v !== "number" || !isValidYear(v) },
    death_year: { invalid: (v) => typeof v !== "number" || !isValidYear(v, true) },
    // country is standardized to an ISO 3166-1 alpha-2 code (mirrors the client-side argParse check)
    country: { invalid: (v) => typeof v !== "string" || !isValidCountryCode(v) },
    image: { invalid: _invalidNullableImage },
    bio: { invalid: _invalidNullableStringMaxLen(MAX_LONG_TEXT_LENGTH) },
    // citations is optional; when present, every entry must be a non-blank source name mapped to an
    // https link, DOI, or ISBN (validateCitations)
    citations: {
        invalid: _invalidOptionalObject,
        elementCheck: (v) => (v === undefined || v === null ? null : validateCitations(v))
    },
    tags: _tagsRule
}

/**
 * Verifies the composer birth and death years make sense
 *
 * @param record the (already per-field validated) composer record or partial record
 * @returns true if the years are consistent, otherwise a string error message
 */
function composerYearsConsistent(record: { [key: string]: any }): true | string {
    const birth = record.birth_year
    const death = record.death_year
    if (typeof birth === "number" && typeof death === "number" && !isDeathYearConsistent(birth, death)) {
        return "Record has invalid death_year (must be greater than or equal to birth_year, or -1 if living)"
    }
    return true
}

/**
 * Given an unknown object from JSON, determine if it is a complete Composer record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a Composer type if valid, or a string error message if invalid
 */
export function _stateTypeAssertCompleteComposer(record: unknown, expect_id: boolean = true): Composer | string {
    if (isPlainObject(record)) {
        sanitizeComposerFields(record)
    }
    const result = assertRecordBySpec(record, COMPOSER_SPEC, false, expect_id)
    if (result !== true) {
        return result
    }
    const consistency = composerYearsConsistent(record as { [key: string]: any })
    return consistency === true ? (record as Composer) : consistency
}

/**
 * Given an unknown object from JSON, determine if it is a valid partial Composer record and perform a type assertion
 *
 * @param record the record to check and assert
 * @returns the record as a partial Composer type if valid, or a string error message if invalid
 */
export function _stateTypeAssertPartialComposer(
    record: unknown,
    expect_id: boolean = true
): Partial<Composer> | string {
    if (isPlainObject(record)) {
        sanitizeComposerFields(record)
    }
    const result = assertRecordBySpec(record, COMPOSER_SPEC, true, expect_id)
    if (result !== true) {
        return result
    }
    const consistency = composerYearsConsistent(record as { [key: string]: any })
    return consistency === true ? (record as Partial<Composer>) : consistency
}
