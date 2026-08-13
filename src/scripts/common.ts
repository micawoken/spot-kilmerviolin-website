/**
 *
 *
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

import type { FieldPair } from "./types"
import { custom_object_parsers } from "./types"
import { isValidCountryCode, normalizeCountryCode } from "../lib/api/validation"
import {
    classifyCitationValue,
    hasStrayCommaSegments,
    isDeathYearConsistent,
    isPositiveIntegerString,
    isValidEmail,
    isValidImageUrl,
    isValidPitchRange,
    isValidPosition,
    SUPPORTED_URI_TYPES,
    validateURIForType
} from "../lib/api/validation"
import { countryNameToCode } from "./format"
import { parseCitationsTextarea } from "./citations"

// PARSERS

/**
 * Parses a single integer field value, enforcing that it is a whole number.
 *
 * All numeric fields in the API (IDs, years, ratings, phase numbers) are integers, and ID fields in
 * particular must always be numbers. parseFloat/parseInt are too lenient for this (they accept inputs
 * like "12abc" or "1.5"), so this rejects anything that is not a bare integer.
 *
 * @param {string} raw the raw input value
 * @param {string} param the parameter name, used for error messages
 * @returns {number} the parsed integer
 * @throws {Error} if the input is not a valid integer
 */
export function parseIntegerStrict(raw: string, param: string): number {
    const trimmed = raw.trim()
    if (!/^-?\d+$/.test(trimmed)) {
        throw new Error(`Invalid integer input for parameter ${param}: "${raw}" (must be a whole number)`)
    }
    const num = Number(trimmed)
    if (!Number.isInteger(num)) {
        throw new Error(`Invalid integer input for parameter ${param}: "${raw}" (must be a whole number)`)
    }
    return num
}

export function argParse(
    param: string,
    type: string,
    raw_value: string
): string | string[] | number | number[] | boolean | Record<string, string> | undefined {
    switch (type) {
        case "string":
            return raw_value
        case "country": {
            // countries are standardized to ISO 3166-1 alpha-2 codes; normalize and reject anything the
            // runtime cannot resolve to a region (mirrored server-side in the composer type assertions)
            const normalized = normalizeCountryCode(raw_value)
            if (isValidCountryCode(normalized)) {
                return normalized
            }
            // as a convenience the field also accepts a country's common English name (e.g. "France"); it is
            // converted to the ISO code here so the request body still carries the code the API requires
            const from_name = countryNameToCode(raw_value)
            if (from_name) {
                return from_name
            }
            throw new Error(
                `Invalid country for parameter ${param}: "${raw_value}" (must be an ISO 3166-1 alpha-2 country code or a recognized country name)`
            )
        }
        case "number":
            // numeric fields (including all ID fields) are integers and are enforced as such
            return parseIntegerStrict(raw_value, param)
        case "boolean":
            return raw_value.toLowerCase() === "true"
        case "string[]":
            // empty segments (e.g. from a trailing comma) are dropped rather than sent as empty strings
            return raw_value
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s !== "")
        case "number[]":
        case "number[]?": // nullable array: parses like number[]; empty inputs become null instead of [] (handled in generateObjectForm)
            // number arrays (e.g. secondary author / additional contributor ID lists) are integer lists
            return raw_value
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s !== "")
                .map((s) => parseIntegerStrict(s, param))
        case "citations":
            // one entry per line, "Source Name: value"; see scripts/citations.ts's header
            return parseCitationsTextarea(raw_value)
        default:
            if (type.startsWith("X-")) {
                throw new Error(
                    `Custom object ${type} should be passed in the custom_objects parameter, not as a type in the type_data mapping`
                )
            }
            console.warn(`Unsupported type ${type} for parameter ${param}`)
            return
    }
}

export function customObjectParse(
    custom_object_type: keyof typeof custom_object_parsers,
    form_data: FormData,
    allow_omit: boolean,
    nullable: boolean
):
    | {
          output: any
          exclude: string
      }
    | undefined {
    const data = custom_object_parsers[custom_object_type]
    const type_name = data[0]
    const constructor = data[1]
    const params = data[2]
    // missing entries and empty inputs are both passed to the constructor as null,
    // letting constructors map blank inputs onto nullable columns
    const values = params.map((param) => {
        const raw = form_data.get(param)
        return raw === null || raw === "" ? null : raw
    })
    const output = constructor(...values)
    if (!output) {
        if (values.every((value) => value === null)) {
            // the whole group was left blank or is not rendered by this form
            if (!allow_omit && !nullable) {
                throw new Error(
                    `Form data is missing required parameters for custom object ${custom_object_type}: ${params.join(", ")}`
                )
            }
            return
        }
        // inputs were provided but rejected; surface the problem instead of silently dropping them
        throw new Error(
            `Invalid input for custom object ${custom_object_type}. Inputs: ${params.map((param, i) => `${param}=${values[i] ?? ""}`).join(", ")}`
        )
    }
    return {
        output: output,
        exclude: type_name
    }
}

/**
 * Given a FormData object and a type mapping, generates the object representation
 * (performs the same task as generateObject, but with a specified form object instead of DOM IDs)
 *
 */
export function generateObjectForm(
    form_data: FormData,
    type_data: Record<string, FieldPair>,
    allow_omit: boolean = false,
    custom_objects: (keyof typeof custom_object_parsers)[] = [],
    patch: boolean = false
): Record<string, any> {
    let result: Record<string, any> = {}
    let exclude = new Set<string>() // excludes type_data properties that were created by the custom object constructor
    // manage custom objects
    for (const custom_object of custom_objects) {
        const field_name = custom_object_parsers[custom_object][0]
        // always exclude the constructed field from the main loop, so it is not overwritten
        exclude.add(field_name)
        if (patch) {
            // in patch mode, only include the custom object if its group-level checkbox is checked
            const editable = form_data.get(`${field_name}-edittarget`)
            if (editable !== "on") {
                continue
            }
        }
        const parsed = customObjectParse(custom_object, form_data, allow_omit, type_data[field_name][1])
        // invalid (non-blank) input throws inside customObjectParse; a falsy return means the group was left blank
        if (!parsed) {
            // blank nullable groups are sent as null in full mode and skipped in patch mode
            if (!patch) {
                result[field_name] = null
            }
            continue
        }
        result[field_name] = parsed.output
    }

    const remaining = Object.entries(type_data).filter(([param, _]) => !exclude.has(param))

    for (const [param, [type, is_optional]] of remaining) {
        if (!form_data.has(param)) {
            if (patch) {
                // a patch form may legitimately not render every interface field
                continue
            }
            if (!allow_omit && !is_optional) {
                throw new Error(`Form data is missing required parameter ${param}`)
            }
            // array-typed fields must be sent as empty arrays; the API requires Array values for them
            result[param] = type.endsWith("[]") ? [] : null
            continue
        }
        if (patch) {
            // check if the associated checkbox element is checked; if not, continue
            const editable = form_data.get(`${param}-edittarget`)
            if (editable !== "on") {
                continue
            }
            // proceed
        }
        const raw_value = form_data.get(param)
        if (typeof raw_value !== "string") {
            if (!allow_omit && !is_optional) {
                throw new Error(`Form data for parameter ${param} is not a string`)
            }
            console.warn(
                `Form data for parameter ${param} is not a string, ignoring parameter.`,
                `allow_omit is ${allow_omit}.`
            )
            continue
        }
        if (raw_value === "") {
            // empty inputs are nulls (an empty optional number would otherwise fail to parse)
            if (!patch && !allow_omit && !is_optional) {
                throw new Error(`Form data is missing required parameter ${param}`)
            }
            // array-typed fields must be sent as empty arrays; the API requires Array values for them
            result[param] = type.endsWith("[]") ? [] : null
            continue
        }
        const parsed_value = argParse(param, type, raw_value)
        if (parsed_value === undefined) {
            throw new Error(`Failed to parse form data for parameter ${param} with value ${raw_value} and type ${type}`)
        }
        // nullable arrays that parse to no elements (e.g. an input of only commas) are sent as null, not []
        result[param] =
            type === "number[]?" && Array.isArray(parsed_value) && parsed_value.length === 0 ? null : parsed_value
    }
    return result
}

export function singleParse(form_data: FormData): string {
    if (!form_data.has("id")) {
        throw new Error(`Form data is missing required parameter id for this operation`)
    }
    const id = form_data.get("id")!
    if (typeof id !== "string") {
        throw new Error(`Form data for parameter id is not a string`)
    }
    return id
}

// VALIDATORS

// ---------------------------------------------------------------------------
// Client-side field validation
//
// Each validator inspects a single field's raw (string) value and returns a short, specific hint about
// what is wrong, or null when the value is acceptable. A blank value is always acceptable here: optional
// fields submit blank, and required fields are enforced separately by generateObjectForm. Validators
// therefore police only the *format* of a non-blank entry. Hints are surfaced inline (showFieldError),
// to the right of the field, mirroring the format-hint tokens.
// ---------------------------------------------------------------------------

export type FieldValidator = (raw: string, form: HTMLFormElement) => string | null

// the editable form controls validation operates on (typed as a union rather than HTMLElement because
// HTMLSelectElement.remove(index) gives selects an incompatible signature under HTMLElement)
export type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

// custom-object group members share one group-level edit-target checkbox (mirrors enableEditTargetOnChange),
// so in patch mode validation keys off the group's checkbox to decide whether to validate the member
export const VALIDATION_GROUP_MAP: Record<string, string> = {
    rating_suzuki: "rating",
    rating_nyssma: "rating",
    publish_name: "publication_info",
    publish_location: "publication_info",
    publish_year: "publication_info",
    uri_type: "publication_info",
    uri: "publication_info"
}

/** Validates a comma-separated list: no stray (empty) entries, and — when numeric — positive integers. */
export function validateList(numeric: boolean): FieldValidator {
    return (raw) => {
        if (raw.trim() === "") return null
        if (hasStrayCommaSegments(raw)) return "remove the empty entry (stray comma)"
        if (numeric) {
            const segments = raw
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s !== "")
            if (!segments.every(isPositiveIntegerString)) return "use positive whole numbers only"
        }
        return null
    }
}

/** Validates a year: a positive whole number, optionally allowing the -1 "still living" sentinel. */
export function validateYear(allow_living: boolean): FieldValidator {
    return (raw) => {
        const trimmed = raw.trim()
        if (trimmed === "") return null
        if (allow_living && trimmed === "-1") return null
        if (!isPositiveIntegerString(trimmed)) {
            return allow_living ? "enter a year, or -1 if living" : "enter a valid year"
        }
        return null
    }
}

/**
 * Validates a composer death year: blank, the -1 "still living" sentinel, or a positive whole-number year
 * that — when a birth year is also entered — falls on or after it. The birth-year cross-check mirrors the
 * server-side composer record validation (isDeathYearConsistent), so an out-of-order pair is flagged in
 * place before submission.
 */
export const validateDeathYear: FieldValidator = (raw, form) => {
    const trimmed = raw.trim()
    if (trimmed === "") return null
    if (trimmed === "-1") return null
    if (!isPositiveIntegerString(trimmed)) return "enter a year, or -1 if living"
    const birth = form.querySelector('[name="birth_year"]')
    if (birth instanceof HTMLInputElement && isPositiveIntegerString(birth.value)) {
        if (!isDeathYearConsistent(parseInt(birth.value, 10), parseInt(trimmed, 10))) {
            return "must be on or after the birth year"
        }
    }
    return null
}

/** Validates a rating level against an inclusive range. */
export function validateRatingLevel(min: number, max: number): FieldValidator {
    return (raw) => {
        if (raw.trim() === "") return null
        if (!isPositiveIntegerString(raw)) return `whole number ${min}–${max}`
        const value = parseInt(raw.trim(), 10)
        return value >= min && value <= max ? null : `must be ${min}–${max}`
    }
}

/** Validates a single positive-integer id reference. */
export const validateIdField: FieldValidator = (raw) =>
    raw.trim() === "" || isPositiveIntegerString(raw) ? null : "enter a numeric id"

export const validateEmailField: FieldValidator = (raw) =>
    raw.trim() === "" || isValidEmail(raw) ? null : "enter a valid email address"

export const validateImageField: FieldValidator = (raw) =>
    raw.trim() === "" || isValidImageUrl(raw) ? null : "enter a valid URL or pick an uploaded image"

export const validateRangeField: FieldValidator = (raw) =>
    raw.trim() === "" || isValidPitchRange(raw) ? null : "use note-note, e.g. G3-A5"

export const validatePositionField: FieldValidator = (raw) =>
    raw.trim() === "" || isValidPosition(raw) ? null : "use a Roman numeral or number, e.g. VII or 7"

// the URI's required shape depends on the selected URI Type (https/isbn/doi), so this reads the sibling selector
export const validateUriField: FieldValidator = (raw, form) => {
    if (raw.trim() === "") return null
    const type_elem = form.querySelector("#form-composition-uri_type")
    const uri_type = type_elem instanceof HTMLSelectElement ? type_elem.value : "https"
    if (!SUPPORTED_URI_TYPES.includes(uri_type)) return null
    return validateURIForType(uri_type, raw) ? null : `does not match the selected ${uri_type.toUpperCase()} format`
}

// unlike parseCitationsTextarea (scripts/citations.ts), which silently drops a malformed line for the
// form's convenience at submit time, this walks every non-blank raw line so a mistake is actually
// surfaced to the user instead of quietly vanishing from what gets saved
export const validateCitationsField: FieldValidator = (raw) => {
    const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
    for (const line of lines) {
        const separator = line.indexOf(":")
        if (separator === -1) return `each line must be "Source Name: value" (missing ":" in "${line}")`
        const key = line.slice(0, separator).trim()
        const value = line.slice(separator + 1).trim()
        if (key === "") return `missing source name in "${line}"`
        if (value === "" || classifyCitationValue(value) === null) {
            return `"${value}" must be an https link, a DOI, or an ISBN`
        }
    }
    return null
}

/** Maps a field's name (the input's name attribute) to its validator. Unlisted fields are not validated. */
export const FIELD_VALIDATORS: Record<string, FieldValidator> = {
    birth_year: validateYear(false),
    death_year: validateDeathYear,
    publish_year: validateYear(false),
    class_year: validateYear(false),
    public_email: validateEmailField,
    identity_email: validateEmailField,
    // IAM forms (add user, change login email, add/remove roles) reuse the entity-form validation layer
    email: validateEmailField,
    current_email: validateEmailField,
    new_email: validateEmailField,
    roles_add: validateList(false),
    roles_remove: validateList(false),
    image: validateImageField,
    range: validateRangeField,
    position_highest: validatePositionField,
    uri: validateUriField,
    rating_suzuki: validateRatingLevel(1, 10),
    rating_nyssma: validateRatingLevel(1, 6),
    composer_id: validateIdField,
    contrib_primary_1: validateIdField,
    contrib_primary_2: validateIdField,
    tags: validateList(false),
    roles: validateList(false),
    phases: validateList(true),
    author_secondary: validateList(true),
    contrib_addl: validateList(true),
    citations: validateCitationsField
}

/**
 * Client-side validation of whether the acting user may edit a given contributor record.
 *
 * Mirrors the server authorization in PATCH /api/v1/contributors/[id]: a user may edit their own
 * record freely, but editing another user's record — or any protected property — requires being an
 * administrator with elevation enabled. The server remains authoritative; this surfaces a clear error
 * before the request is sent. Identity context is read from the form's dataset (set by
 * ContributorForm.astro), with the protected-property list sourced from CONTRIBUTOR.protected.
 *
 * @param {HTMLFormElement} form the contributor form, carrying identity context in its dataset
 * @param {number} record_id the id of the contributor record being edited
 * @param {boolean} elevate whether administrator elevation is requested for this operation
 * @param {Record<string, any>} data the (partial) record being submitted
 * @throws {Error} if the acting user lacks permission for the requested edit
 */
export function assertCanEditContributor(
    form: HTMLFormElement,
    record_id: number,
    elevate: boolean,
    data: Record<string, any>
): void {
    const self_raw = form.dataset.selfId ?? ""
    const self_id = self_raw === "" ? null : parseInt(self_raw)
    const is_admin = form.dataset.isAdmin === "true"
    const protected_fields = (form.dataset.protectedFields ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "")
    // editing another record, or any protected property, both require an elevated (admin + elevate) request
    const elevated = is_admin && elevate
    const is_self = self_id !== null && !isNaN(self_id) && self_id === record_id

    if (!is_self && !elevated) {
        throw new Error(
            "You do not have permission to edit this contributor record. You may only edit your own record; editing another contributor requires administrator escalation."
        )
    }
    const edited_protected = protected_fields.filter((field) => field in data)
    if (edited_protected.length > 0 && !elevated) {
        throw new Error(
            `Editing protected ${edited_protected.length === 1 ? "property" : "properties"} (${edited_protected.join(", ")}) requires administrator escalation.`
        )
    }
}

//

/**
 * Sets the inner HTML of a result element by id, for fields rendered as markup-safe HTML the generic
 * populateInfo loop cannot produce (e.g. contributor/composer references rendered as info-page links).
 * The supplied HTML must already be escaped at its source (see scripts/references.ts), mirroring the SSR
 * `set:html` render in the entity Info components.
 *
 * @param {string} elem_id the id of the element to populate
 * @param {string} html the markup-safe HTML to set
 */
export function setInfoHtml(elem_id: string, html: string): void {
    const elem = document.getElementById(elem_id)
    if (!elem) {
        console.warn(`Element with id ${elem_id} not found in DOM for populating info`)
        return
    }
    elem.innerHTML = html
}

/**
 * Wires a search box's text input so that pressing Enter triggers its own search button instead of
 * submitting the surrounding form. The search helpers (name search, file picker, file search, keyword
 * search) sit inside the page's larger forms; without this, Enter would submit that broader form rather
 * than run the search the user is typing into. The keydown is canceled (and propagation stopped) so the
 * form's submit handler never sees it, and the search button's existing click handler runs instead.
 *
 * @param {HTMLInputElement} input the search query text input
 * @param {HTMLElement} button the search button whose click runs the search
 */
export function submitOnEnter(input: HTMLInputElement, button: HTMLElement): void {
    input.addEventListener("keydown", (evt: KeyboardEvent) => {
        if (evt.key !== "Enter") {
            return
        }
        // keep Enter from bubbling up to (and submitting) the enclosing form
        evt.preventDefault()
        evt.stopPropagation()
        button.click()
    })
}

/**
 * Normalizes a caught value into a displayable message string (Error.message, or String() of anything else).
 *
 * @param {unknown} error the caught value
 * @returns {string} the message to surface to the user
 */
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/**
 * Renders an animated "Searching" progress indicator into a results container.
 *
 * The trailing ellipsis cycles 1 → 2 → 3 dots via the `.search-progress` CSS animation (defined in
 * styles/admin-entities.css) to signal that a search is in flight. Replaces any existing content; it is
 * overwritten once results (or an error) arrive.
 *
 * @param {HTMLElement} target the results container to render the indicator into
 */
export function renderSearchProgress(target: HTMLElement): void {
    target.textContent = ""
    const indicator = document.createElement("span")
    indicator.className = "search-progress"
    indicator.textContent = "Searching"
    target.appendChild(indicator)
}

/**
 * Auto-checks the per-field "Edit this field" checkbox when its field is edited.
 *
 * The PATCH (partial edit) forms render an edit-target checkbox per field, and generateObjectForm only
 * sends fields whose checkbox is checked. To spare users from ticking each box by hand, this checks the
 * matching checkbox as soon as the user modifies a field. Programmatic prefill (prefillForm) sets .value
 * directly and dispatches no input event, so it does not trip these listeners.
 *
 * Most inputs map to a checkbox named `${input.name}-edittarget`. The composition custom-object groups
 * are the exception: their inputs (rating_suzuki/rating_nyssma and the publish_name, publish_location,
 * publish_year, uri and uri_type fields) share one group-level checkbox (rating-edittarget or
 * publication_info-edittarget), mapped explicitly.
 *
 * No-ops on forms without edit-target checkboxes (e.g. create and self-service profile forms).
 *
 * @param {HTMLFormElement} form the form whose inputs should auto-check their edit-target checkboxes
 */
export function enableEditTargetOnChange(form: HTMLFormElement): void {
    // custom-object group fields share a single group-level edit-target checkbox
    const group_map: Record<string, string> = {
        rating_suzuki: "rating",
        rating_nyssma: "rating",
        publish_name: "publication_info",
        publish_location: "publication_info",
        publish_year: "publication_info",
        uri_type: "publication_info",
        uri: "publication_info"
    }
    const inputs = form.querySelectorAll("input, textarea, select")
    inputs.forEach((input) => {
        if (!(
            input instanceof HTMLInputElement ||
            input instanceof HTMLTextAreaElement ||
            input instanceof HTMLSelectElement
        )) {
            return
        }
        const name = input.name
        // skip the edit-target checkboxes themselves and any unnamed control
        if (!name || name.endsWith("-edittarget")) {
            return
        }
        const target_param = group_map[name] ?? name
        const checkbox = form.querySelector(`[name="${target_param}-edittarget"]`)
        if (!(checkbox instanceof HTMLInputElement)) {
            return
        }
        const mark = () => {
            checkbox.checked = true
        }
        // "input" covers typing; "change" covers selects and other commit-style edits
        input.addEventListener("input", mark)
        input.addEventListener("change", mark)
    })
}
