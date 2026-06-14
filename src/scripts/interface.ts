/**
 * scripts/interface.ts
 * 
 * Provides high-level functions related to calling the API
 * 
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

import type { FieldPair } from "./types"
import { constructRating, constructPubInfo, custom_object_parsers, interface_data } from "./types"
import { NOT_PROVIDED } from "../consts"
import { isValidCountryCode, normalizeCountryCode, countryCodeName } from "../lib/api/country"
import {
    APIOpCode,
    createComposer,
    getComposer,
    replaceComposer,
    updateComposer,
    deleteComposer,
    listComposer,
    createWork,
    getWork,
    isCompositionWithNames,
    replaceWork,
    updateWork,
    deleteWork,
    listWork,
    createContributor,
    getContributor,
    replaceContributor,
    updateContributor,
    deleteContributor,
    listContributor,
    searchDatabase
} from "./connector"

/**
 * Renders an animated "Searching" progress indicator into a results container.
 *
 * The trailing ellipsis cycles 1 → 2 → 3 dots via the `.search-progress` CSS animation (defined in
 * styles/admin-entities.css) to signal that a search is in flight. Replaces any existing content; it is
 * overwritten once results (or an error) arrive.
 *
 * @param {HTMLElement} target the results container to render the indicator into
 */
function renderSearchProgress(target: HTMLElement): void {
    target.textContent = ""
    const indicator = document.createElement("span")
    indicator.className = "search-progress"
    indicator.textContent = "Searching"
    target.appendChild(indicator)
}

export function disableInput(form_elem: HTMLFormElement): void {
    const inputs = form_elem.querySelectorAll("input, textarea, select, button")
    inputs.forEach(input => {
        if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement || input instanceof HTMLButtonElement) {
            input.disabled = true
        } else {
            console.warn("Unsupported form element type for disabling: ", input)
        }
    })
}

export function enableInput(form_elem: HTMLFormElement): void {
    const inputs = form_elem.querySelectorAll("input, textarea, select, button")
    inputs.forEach(input => {
        if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement || input instanceof HTMLButtonElement) {
            input.disabled = false
        } else {
            console.warn("Unsupported form element type for enabling: ", input)
        }
    })
}

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
function parseIntegerStrict(raw: string, param: string): number {
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

function argParse(param: string, type: string, raw_value: string): string | string[] | number | number[] | boolean | undefined {
    switch (type) {
        case "string":
            return raw_value
        case "country": {
            // countries are standardized to ISO 3166-1 alpha-2 codes; normalize and reject anything the
            // runtime cannot resolve to a region (mirrored server-side in the composer type assertions)
            const normalized = normalizeCountryCode(raw_value)
            if (!isValidCountryCode(normalized)) {
                throw new Error(`Invalid country for parameter ${param}: "${raw_value}" (must be an ISO 3166-1 alpha-2 country code)`)
            }
            return normalized
        }
        case "number":
            // numeric fields (including all ID fields) are integers and are enforced as such
            return parseIntegerStrict(raw_value, param)
        case "boolean":
            return raw_value.toLowerCase() === "true"
        case "string[]":
            // empty segments (e.g. from a trailing comma) are dropped rather than sent as empty strings
            return raw_value.split(",").map(s => s.trim()).filter(s => s !== "")
        case "number[]":
        case "number[]?": // nullable array: parses like number[]; empty inputs become null instead of [] (handled in generateObjectForm)
            // number arrays (e.g. secondary author / additional contributor ID lists) are integer lists
            return raw_value.split(",").map(s => s.trim()).filter(s => s !== "").map(s => parseIntegerStrict(s, param))
        default:
            if (type.startsWith("X-")) {
                throw new Error(`Custom object ${type} should be passed in the custom_objects parameter, not as a type in the type_data mapping`)
            }
            console.warn(`Unsupported type ${type} for parameter ${param}`)
            return;
    }
}

function customObjectParse(custom_object_type: keyof typeof custom_object_parsers, form_data: FormData, allow_omit: boolean, nullable: boolean): {
    output: any,
    exclude: string
} | undefined {
    const data = custom_object_parsers[custom_object_type]
    const type_name = data[0]
    const constructor = data[1]
    const params = data[2]
    // missing entries and empty inputs are both passed to the constructor as null,
    // letting constructors map blank inputs onto nullable columns
    const values = params.map(param => {
        const raw = form_data.get(param)
        return (raw === null || raw === "") ? null : raw
    })
    const output = constructor(...values)
    if (!output) {
        if (values.every(value => value === null)) {
            // the whole group was left blank or is not rendered by this form
            if (!allow_omit && !nullable) {
                throw new Error(`Form data is missing required parameters for custom object ${custom_object_type}: ${params.join(", ")}`)
            }
            console.log(`Custom object ${custom_object_type} left blank, emitting as omitted.`)
            return;
        }
        // inputs were provided but rejected; surface the problem instead of silently dropping them
        throw new Error(`Invalid input for custom object ${custom_object_type}. Inputs: ${params.map((param, i) => `${param}=${values[i] ?? ""}`).join(", ")}`)
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
export function generateObjectForm(form_data: FormData, type_data: Record<string, FieldPair>, allow_omit: boolean = false, custom_objects: (keyof typeof custom_object_parsers)[] = [], patch: boolean = false): Record<string, any> {
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
                console.log(`Custom object ${field_name} is not marked for editing, skipping.`)
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
                console.log(`Form data is missing parameter ${param} in patch mode, skipping parameter.`)
                continue
            }
            if (!allow_omit && !is_optional) {
                throw new Error(`Form data is missing required parameter ${param}`)
            }
            // array-typed fields must be sent as empty arrays; the API requires Array values for them
            result[param] = type.endsWith("[]") ? [] : null
            console.log(`Form data is missing parameter ${param}, which is ${is_optional ? "optional" : "required"}.`, `allow_omit is ${allow_omit}.`)
            continue
        }
        if (patch) {
            // check if the associated checkbox element is checked; if not, continue
            const editable = form_data.get(`${param}-edittarget`)
            if (editable !== "on") {
                console.log(`Parameter ${param} is not marked for editing, skipping parameter.`, `allow_omit is ${allow_omit}.`)
                continue
            }
            // proceed
        }
        const raw_value = form_data.get(param)
        if (typeof raw_value !== "string") {
            if (!allow_omit && !is_optional) {
                throw new Error(`Form data for parameter ${param} is not a string`)
            }
            console.warn(`Form data for parameter ${param} is not a string, ignoring parameter.`, `allow_omit is ${allow_omit}.`)
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
        result[param] = (type === "number[]?" && Array.isArray(parsed_value) && parsed_value.length === 0) ? null : parsed_value
    }
    return result
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
function assertCanEditContributor(form: HTMLFormElement, record_id: number, elevate: boolean, data: Record<string, any>): void {
    const self_raw = form.dataset.selfId ?? ""
    const self_id = self_raw === "" ? null : parseInt(self_raw)
    const is_admin = form.dataset.isAdmin === "true"
    const protected_fields = (form.dataset.protectedFields ?? "").split(",").map(s => s.trim()).filter(s => s !== "")
    // editing another record, or any protected property, both require an elevated (admin + elevate) request
    const elevated = is_admin && elevate
    const is_self = self_id !== null && !isNaN(self_id) && self_id === record_id

    if (!is_self && !elevated) {
        throw new Error("You do not have permission to edit this contributor record. You may only edit your own record; editing another contributor requires administrator escalation.")
    }
    const edited_protected = protected_fields.filter(field => field in data)
    if (edited_protected.length > 0 && !elevated) {
        throw new Error(`Editing protected ${edited_protected.length === 1 ? "property" : "properties"} (${edited_protected.join(", ")}) requires administrator escalation.`)
    }
}

function singleParse(form_data: FormData): string {
    if (!form_data.has("id")) {
        throw new Error(`Form data is missing required parameter id for this operation`)
    }
    const id = form_data.get("id")!
    if (typeof id !== "string") {
        throw new Error(`Form data for parameter id is not a string`)
    }
    return id
}

/**
 * Emits catched errors onto a status element
 * 
 * @param {Error} error the error to display
 * @param {string} target_id the DOM id of the element on which to display the error message
 * @returns {void}
 */
export function emitError(error: Error, target_id: string): void {
    const target = document.getElementById(target_id)
    if (!target) {
        console.warn(`Target element with id ${target_id} not found for error display`)
        return
    }
    target.textContent = `Error: ${error.message}`
}

const generic_form_codes: Record<keyof typeof interface_data, string> = {
    "composer": "generic-form-composers",
    "composition": "generic-form-composition",
    "contributor_partial": "generic-form-contributors",
    "contributor_full": "generic-form-contributors",
    "contributor_profile": "generic-form-contributors",
}

const generic_read_code = "generic-form-id-entry"

export function getForm(noun: keyof typeof interface_data, exec_mode: APIOpCode): HTMLFormElement {
    console.log(`Getting form for noun ${noun} and operation ${APIOpCode[exec_mode]}`)
    if (exec_mode === APIOpCode.LIST) {
        throw new Error("List operation is SSR, no form is allowed")
    } else if (exec_mode === APIOpCode.READ || exec_mode === APIOpCode.DELETE) {
        // both READ and DELETE operate on a single ID supplied via the ID entry form
        const form = document.getElementById(generic_read_code)
        if (!form) {
            throw new Error(`Read form with id ${generic_read_code} not found in DOM`)
        }
        if (!(form instanceof HTMLFormElement)) {
            throw new Error(`Element with id ${generic_read_code} is not a form`)
        }
        return form
    } else {
        console.log(generic_form_codes, noun)
        const form_code = generic_form_codes[noun]
        const form = document.getElementById(form_code)
        if (!form) {
            console.log(`Form with id ${form_code} not found in DOM for noun ${noun} and operation ${exec_mode}`)
            throw new Error(`Form with id ${form_code} not found in DOM for noun ${noun} and operation ${exec_mode}`)
        }
        if (!(form instanceof HTMLFormElement)) {
            throw new Error(`Element with id ${form_code} is not a form`)
        }
        return form
    }
}

export function getTransactionElem(): Element {
    const elem = document.getElementById("transaction-status")
    if (!elem) {
        throw new Error(`Transaction status element with id transaction-status not found in DOM`)
    }
    return elem
}


/**
 * Common function to send API requests for composers, compositions, and contributors
 * 
 * Returns the API response payload
 * 
 * @param {APIOpCode} exec_mode the type of operation being performed
 * @param {object} spec the specification from connector.ts
 * @param {any} data the data to send in the request body, if applicable
 * @param {Record<string, any>} meta the meta parameters to include in the request, if applicable
 * @param {number} id the ID of the record being updated or deleted, if applicable
 * @returns {Promise<any>} the interpreted response payload
 * @throws {Error} if pre-request processing fails, the call fails, or call processing fails
 */
// NOTE: The previous abstraction `_commonCall`/`commonCall` has been removed
// in favor of directly calling the concrete connector functions exported
// from `connector.ts`. This reduces indirection and makes event handlers
// call the intended API functions explicitly.

export async function populateInfo(noun: keyof typeof interface_data, data: object, force_prefix?: string): Promise<void> {
    const type_name = interface_data[noun].name
    for (const [key, value] of Object.entries(data)) {
        const elem_id = (force_prefix === undefined) ? `${type_name}-${key}` : (force_prefix === "" ? key : `${force_prefix}-${key}`)
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            // nested objects (rating, publication_info) populate elements prefixed with their own id
            await populateInfo(noun, value as object, elem_id)
            continue
        }
        const elem = document.getElementById(elem_id)
        if (!elem) {
            console.warn(`Element with id ${elem_id} not found in DOM for populating info`)
            continue
        }
        console.log(`Populating element with id ${elem_id} with value:`, value)
        // image fields render into an <img> element, not text: set its src and toggle the sibling
        // "(no image)" placeholder (id `${elem_id}-missing`). The <img> is always present in the Info
        // components so this client-side READ path can fill it, mirroring the SSR view; the src is left
        // unset when there is no image to avoid a broken-image request.
        if (elem instanceof HTMLImageElement) {
            const missing = document.getElementById(`${elem_id}-missing`)
            const has_image = !(value === null || value === undefined || (typeof value === "string" && value.trim() === ""))
            if (has_image) {
                elem.src = String(value)
                elem.classList.remove("hidden")
                missing?.classList.add("hidden")
            } else {
                elem.removeAttribute("src")
                elem.classList.add("hidden")
                missing?.classList.remove("hidden")
            }
            continue
        }
        // mirror the SSR `disp` helper in the entity Info components: a null/undefined/blank/empty-array
        // value renders as a clear "not provided" marker so it is distinct from an unset/blank field
        if (value === null || value === undefined) {
            elem.textContent = NOT_PROVIDED
        } else if (Array.isArray(value)) {
            elem.textContent = value.length > 0 ? value.join(", ") : NOT_PROVIDED
        } else if (typeof value === "string" && value.trim() === "") {
            elem.textContent = NOT_PROVIDED
        } else if (type_name === "composer" && key === "death_year" && value === -1) {
            // a composer death_year of -1 denotes a living composer (mirrors the ComposerInfo SSR view)
            elem.textContent = "Present"
        } else if (type_name === "composer" && key === "country" && typeof value === "string") {
            // composer countries are stored as ISO 3166-1 alpha-2 codes; render the English name (mirrors the ComposerInfo SSR view)
            elem.textContent = countryCodeName(value)
        } else if (key === "id" && force_prefix === undefined) {
            // the SSR Info components render the id element as "ID #<n>"; mirror that here so the client-side
            // READ flow does not overwrite the "ID #" prefix with a bare number (the id element is top-level only)
            elem.textContent = `ID #${String(value)}`
        } else {
            elem.textContent = String(value)
        }
    }
    // unhide table
    document.getElementById(`generic-result-${type_name}`)?.classList.remove("hidden")
}

export async function clearInfo(noun: keyof typeof interface_data): Promise<void> {
    const type_name = interface_data[noun].name
    const table = document.getElementById(`generic-result-${type_name}`)
    if (table) {
        // without data, we can't generate the field id's; need to investigate if an error in the fetch process could leave stale data
        table.classList.add("hidden")
    } else {
        console.warn(`Table element with id generic-result-${type_name} not found in DOM for clearing info`)
    }
}

/**
 * Retrieves an object from the API based on the ID entry form supplied
 * 
 * Intended for use for the edit (UPDATE) pages, which require entry of an ID and retrieval of the corresponding record
 * 
 */
export async function retrieveObjectFromIDEntry(id_entry_form: HTMLFormElement, noun: keyof typeof interface_data): Promise<ComposerRecord | Partial<ContributorRecord> | CompositionRecord | null> {
    // retrieve the ID entry value
    const form_data = new FormData(id_entry_form)
    const id = parseInt(singleParse(form_data))
    if (isNaN(id)) {
        throw new Error(`Parsed ID value is not a valid number: ${id}`)
    }
    // optional escalation checkbox (admin retrieval of protected contributor properties)
    const elevate = form_data.get("elevate") === "on" ? true : undefined
    // retrieve the record from the API
    switch (interface_data[noun].name) {
        case "composer":
            return await getComposer(id)
        case "composition": {
            // the edit flow needs only the plain record for prefilling; names are not requested here, but
            // the result is unwrapped through the type guard so an enhanced shape is handled defensively
            const work = await getWork(id)
            return (isCompositionWithNames(work) ? work.object : work) as CompositionRecord | null
        }
        case "contributor":
            return await getContributor(id, elevate)
        default:
            throw new Error(`Unsupported noun ${interface_data[noun].name} for retrieval in retrieveObjectFromIDEntry`)
    }
}

/**
 * Common event listener code for responding to composer, composition, and contributor form submissions
 * 
 * @param {SubmitEvent} submit_event the form submission event
 * @param {HTMLFormElement | string | null} form the form element, the content of a single-element form, or null
 * @param {Element} message the DOM element on which to display status messages
 * @param {APIOpCode} exec_mode the type of operation being performed
 * 
 * 
 */
export async function processSubmit(submit_event: SubmitEvent | PointerEvent, form: HTMLFormElement, message: Element, exec_mode: APIOpCode, noun: keyof typeof interface_data) {
    submit_event.preventDefault();
    message.textContent = "Processing request..."
    console.log("Form element received in processSubmit: ", form)
    if (!(form instanceof HTMLFormElement)) {
        throw new Error(`Invalid form input for processSubmit: expected HTMLFormElement, got ${typeof form}`)
    }
    const formData = new FormData(form)
    disableInput(form)
    // optional elevation/escalation checkbox rendered on some admin forms (ignored by generateObjectForm)
    const elevate = formData.get("elevate") === "on" ? true : undefined
    // optional direct-contributor-management toggle (composition admin forms); signals the server not to auto-add the editor
    const direct = formData.get("contrib_direct") === "on" ? true : undefined
    let data: any = null
    let record_id: number | undefined = undefined

    try {
        if (exec_mode === APIOpCode.READ || exec_mode === APIOpCode.DELETE) {
            // single-item exec mode - form is single-item (ID), so pull the single item
            record_id = parseInt(singleParse(formData))
            if (isNaN(record_id)) {
                throw new Error(`Parsed ID value is not a valid number`)
            }
        } else if (exec_mode === APIOpCode.UPDATE || exec_mode === APIOpCode.UPDATE_PARTIAL) {
            // updates target an existing record via the form's hidden id input
            record_id = parseInt(String(formData.get("id")))
            if (isNaN(record_id)) {
                throw new Error(`Form data is missing a valid record ID for this operation`)
            }
            const partial = (exec_mode === APIOpCode.UPDATE_PARTIAL)
            data = generateObjectForm(formData, interface_data[noun].interface, partial, interface_data[noun].custom_objects, partial)
            // contributor edits are subject to ownership and protected-property authorization; validate
            // client-side before sending so the user receives an immediate, clear rejection
            if (interface_data[noun].name === "contributor") {
                assertCanEditContributor(form, record_id, elevate === true, data as Record<string, any>)
            }
        } else {
            // standard exec mode - pull form values
            data = generateObjectForm(formData, interface_data[noun].interface, false, interface_data[noun].custom_objects)
        }

        const api_noun = interface_data[noun].name
        // Direct, explicit calls to connector functions based on noun and operation
        if (api_noun === "composer") {
            switch (exec_mode) {
                case APIOpCode.CREATE: {
                    const id = await createComposer(data as Composer)
                    message.textContent = `Request succeeded: assigned composer ID ${id.toString()}`
                    if (form instanceof HTMLFormElement) await attachNextTask(form, message, exec_mode, noun)
                    break
                }
                case APIOpCode.READ: {
                    const rec = await getComposer(record_id!)
                    console.log("Record retrieved from API: ", rec)
                    if (rec) {
                        document.getElementById("generic-form-id-entry-container")?.classList.add("hidden")
                        document.getElementById("entity-search-container")?.classList.add("hidden")
                        await populateInfo(noun, rec as any)
                        message.textContent = "Request succeeded: composer loaded"
                    } else {
                        message.textContent = "No composer found for given ID"
                    }
                    // offer the edit link only when a record was actually loaded
                    await attachNextTask(form, message, exec_mode, noun, false, rec ? record_id : undefined)
                    break
                }
                case APIOpCode.UPDATE: {
                    await replaceComposer(record_id!, data as Composer)
                    message.textContent = "Request succeeded: updated composer record"
                    await attachNextTask(form, message, exec_mode, noun)
                    break
                }
                case APIOpCode.UPDATE_PARTIAL: {
                    await updateComposer(record_id!, data as Partial<Composer>)
                    message.textContent = "Request succeeded: updated composer record"
                    await attachNextTask(form, message, exec_mode, noun)
                    break
                }
                case APIOpCode.DELETE: {
                    await deleteComposer(record_id!)
                    message.textContent = "Request succeeded: deleted composer record"
                    await attachNextTask(form, message, exec_mode, noun)
                    break
                }
                case APIOpCode.LIST: {
                    const list = await listComposer()
                    console.log(list)
                    message.textContent = "Request succeeded: list retrieved"
                    break
                }
            }
        } else if (api_noun === "composition") {
            switch (exec_mode) {
                case APIOpCode.CREATE: {
                    const id = await createWork(data as Composition)
                    message.textContent = `Request succeeded: assigned composition ID ${id.toString()}`
                    if (form instanceof HTMLFormElement) await attachNextTask(form, message, exec_mode, noun)
                    break
                }
                case APIOpCode.READ: {
                    // request resolved composer names so the view can show them alongside the numeric ids
                    const rec = await getWork(record_id!, true)
                    if (rec) {
                        document.getElementById("generic-form-id-entry-container")?.classList.add("hidden")
                        document.getElementById("entity-search-container")?.classList.add("hidden")
                        if (isCompositionWithNames(rec)) {
                            // populate the record, then the resolved names (composer_name / author_secondary_names)
                            await populateInfo(noun, rec.object as any)
                            await populateInfo(noun, rec.names as any)
                        } else {
                            await populateInfo(noun, rec as any)
                        }
                        message.textContent = "Request succeeded: composition loaded"
                    } else {
                        message.textContent = "No composition found for given ID"
                    }
                    // offer the edit link only when a record was actually loaded
                    await attachNextTask(form, message, exec_mode, noun, false, rec ? record_id : undefined)
                    break
                }
                case APIOpCode.UPDATE: {
                    await replaceWork(record_id!, data as Composition, elevate, direct)
                    message.textContent = "Request succeeded: updated composition record"
                    await attachNextTask(form, message, exec_mode, noun)
                    break
                }
                case APIOpCode.UPDATE_PARTIAL: {
                    await updateWork(record_id!, data as Partial<Composition>, elevate, direct)
                    message.textContent = "Request succeeded: updated composition record"
                    await attachNextTask(form, message, exec_mode, noun)
                    break
                }
                case APIOpCode.DELETE: {
                    await deleteWork(record_id!, elevate)
                    message.textContent = "Request succeeded: deleted composition record"
                    await attachNextTask(form, message, exec_mode, noun)
                    break
                }
                case APIOpCode.LIST: {
                    const list = await listWork()
                    console.log(list)
                    message.textContent = "Request succeeded: list retrieved"
                    break
                }
            }
        } else if (api_noun === "contributor") {
            switch (exec_mode) {
                case APIOpCode.CREATE: {
                    const id = await createContributor(data as Contributor)
                    message.textContent = `Request succeeded: assigned contributor ID ${id.toString()}`
                    if (form instanceof HTMLFormElement) await attachNextTask(form, message, exec_mode, noun)
                    break
                }
                case APIOpCode.READ: {
                    const rec = await getContributor(record_id!, elevate)
                    if (rec) {
                        document.getElementById("generic-form-id-entry-container")?.classList.add("hidden")
                        document.getElementById("entity-search-container")?.classList.add("hidden")
                        await populateInfo(noun, rec as any)
                        message.textContent = "Request succeeded: contributor loaded"
                    } else {
                        message.textContent = "No contributor found for given ID"
                    }
                    // offer the edit link only when a record was actually loaded
                    await attachNextTask(form, message, exec_mode, noun, false, rec ? record_id : undefined)
                    break
                }
                case APIOpCode.UPDATE: {
                    await replaceContributor(record_id!, data as Contributor)
                    message.textContent = "Request succeeded: updated contributor record"
                    await attachNextTask(form, message, exec_mode, noun)
                    break
                }
                case APIOpCode.UPDATE_PARTIAL: {
                    await updateContributor(record_id!, data as Partial<Contributor>, elevate)
                    message.textContent = "Request succeeded: updated contributor record"
                    await attachNextTask(form, message, exec_mode, noun)
                    break
                }
                case APIOpCode.DELETE: {
                    await deleteContributor(record_id!)
                    message.textContent = "Request succeeded: deleted contributor record"
                    await attachNextTask(form, message, exec_mode, noun)
                    break
                }
                case APIOpCode.LIST: {
                    const list = await listContributor()
                    console.log(list)
                    message.textContent = "Request succeeded: list retrieved"
                    break
                }
            }
        } else {
            throw new Error(`Unsupported API noun ${api_noun}`)
        }
    } catch (error) {
        message.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`
        console.error(error)
        // allow the user to correct their input and retry
        enableInput(form)
    }
}

/**
 * Submits the self-service profile editor as a partial (PATCH) update to the caller's own contributor
 * record.
 *
 * Unlike the admin edit page, the profile editor renders every editable field at once and has no
 * per-field edit-target checkboxes, so the object is generated in non-patch mode (every rendered field
 * is sent on each save, replacing its stored value). The field set (contributor_profile) excludes the
 * identity email, roles, admin, and active, so no protected property is ever sent and the edit needs no
 * administrator escalation — the server authorizes it purely as a self-edit. The record id is taken from
 * the caller's identity (self_id), not from form input, so the form can only ever update its own record.
 *
 * @param {HTMLFormElement} form the profile editor form
 * @param {Element} message the status element on which to report progress and errors
 * @param {number} self_id the acting user's own contributor id (the PATCH target)
 */
export async function submitProfileEdit(form: HTMLFormElement, message: Element, self_id: number): Promise<void> {
    message.textContent = "Processing request..."
    disableInput(form)
    try {
        const form_data = new FormData(form)
        // generate in non-patch mode: every profile field is present in the form and is sent on save
        const data = generateObjectForm(form_data, interface_data["contributor_profile"].interface, false, [], false)
        await updateContributor(self_id, data as Partial<Contributor>)
        message.textContent = "Request succeeded: your profile has been updated."
        enableInput(form)
    } catch (error) {
        message.textContent = `Error: ${error instanceof Error ? error.message : String(error)}`
        console.error(error)
        // allow the user to correct their input and retry
        enableInput(form)
    }
}

/**
 * Generates a callable for an event listener argument
 *
 * @param {HTMLFormElement} form the element containing the data form
 * @param {"create" | "replace" | "update" | "delete"} exec_mode
 *
 */
export function genHandler(form: HTMLFormElement, message: Element, exec_mode: APIOpCode, noun: keyof typeof interface_data): EventListener {
    return (evt: Event) => {
        if (!(evt instanceof SubmitEvent) && !(evt instanceof PointerEvent)) {
            throw new Error(`Unsupported event type ${evt.type} in event handler`)
        }
        processSubmit(evt, form, message, exec_mode, noun)
    }
}

/**
 * Resets and re-reveals the keyword search box that the info pages pair with the ID entry form.
 *
 * The on-page READ flow (processSubmit) hides both the ID entry form and the keyword search box when a
 * record is loaded; this restores the keyword box (clearing its input and results) so the next task can
 * search again. No-ops on pages without a keyword box (e.g. create/delete), so it is safe to call generally.
 */
function _resetKeywordSearch(): void {
    const search_container = document.getElementById("entity-search-container")
    if (!search_container) {
        return
    }
    search_container.classList.remove("hidden")
    const search_input = document.getElementById("entity-search-input")
    if (search_input instanceof HTMLInputElement) {
        search_input.value = ""
    }
    const search_results = document.getElementById("entity-search-results")
    if (search_results) {
        search_results.replaceChildren()
        const placeholder = document.createElement("p")
        placeholder.textContent = "Results will display here when searched."
        search_results.appendChild(placeholder)
    }
}

function _nextTaskEventListener(form: HTMLFormElement, message: Element, action: Element, clear_state?: keyof typeof interface_data, reveal_search: boolean = false): (e: Event) => void {
    return (e: Event) => {
        e.preventDefault()
        form.reset()
        enableInput(form)
        try {
            form.parentElement?.classList.remove("hidden")
        } catch (e) {
            console.warn("Failed to unhide form for next task: ", e)
            form.classList.remove("hidden")
        }
        // info pages also pair the ID entry form with a keyword search box; restore it for the next search
        if (reveal_search) {
            _resetKeywordSearch()
        }
        message.textContent = "Your request status will show here after you press \"Submit\"."
        if (clear_state) {
            clearInfo(clear_state)
        }
        message.removeChild(action)
    }
}

function _attachNextTask(form: HTMLFormElement, message: Element, noun: keyof typeof interface_data, action_text: string, try_again: boolean, clear_state: boolean, reveal_search: boolean = false, edit_link?: { href: string, label: string }): void {
    const next_task_link_text = document.createElement("p")
    // an optional edit link sits to the left of the next-task link on the same line (used after a READ so
    // the just-viewed record can be edited directly); it navigates normally, so it needs no click handler
    if (edit_link) {
        const edit_link_object = document.createElement("a")
        edit_link_object.href = edit_link.href
        edit_link_object.textContent = edit_link.label
        next_task_link_text.appendChild(edit_link_object)
        next_task_link_text.appendChild(document.createTextNode(" | "))
    }
    const next_task_link_object = document.createElement("a")
    next_task_link_object.href = "#"
    next_task_link_object.textContent = try_again ? `Try again >` : `${action_text} another ${interface_data[noun].name} >`
    next_task_link_object.addEventListener("click", _nextTaskEventListener(form, message, next_task_link_text, clear_state ? noun : undefined, reveal_search))
    next_task_link_text.appendChild(next_task_link_object)
    message.appendChild(next_task_link_text)
}

/**
 * Maps each interface noun's canonical name to its admin URL path segment.
 *
 * The admin CRUD pages live under /admin/{segment}/...; the segment matches the canonical name for
 * composers and contributors, but compositions are served under "works" (see the ListResults note in
 * admin/works/list.astro), so the mapping is explicit rather than a naive pluralization.
 */
const admin_path_segment: Record<string, string> = {
    "composer": "composers",
    "composition": "works",
    "contributor": "contributors",
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
        "rating_suzuki": "rating",
        "rating_nyssma": "rating",
        "publish_name": "publication_info",
        "publish_location": "publication_info",
        "publish_year": "publication_info",
        "uri_type": "publication_info",
        "uri": "publication_info",
    }
    const inputs = form.querySelectorAll("input, textarea, select")
    inputs.forEach(input => {
        if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) {
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
        const mark = () => { checkbox.checked = true }
        // "input" covers typing; "change" covers selects and other commit-style edits
        input.addEventListener("input", mark)
        input.addEventListener("change", mark)
    })
}

/**
 * Maps interface nouns to the DOM id prefix used by their form inputs
 */
const form_input_prefix: Record<keyof typeof interface_data, string> = {
    "composer": "form-composers",
    "composition": "form-composition",
    "contributor_partial": "form-contributors",
    "contributor_full": "form-contributors",
    "contributor_profile": "form-contributors",
}

/**
 * Prefills a data-entry form's inputs with the values of an existing record
 *
 * Intended for the edit (UPDATE_PARTIAL) pages after the record is retrieved via the ID entry form
 * (populateInfo cannot be used: it sets textContent, which does not affect input values)
 *
 * @param {keyof typeof interface_data} noun the interface noun whose form should be prefilled
 * @param {Record<string, any>} record the record data to prefill with
 */
export function prefillForm(noun: keyof typeof interface_data, record: Record<string, any>): void {
    const prefix = form_input_prefix[noun]
    // flatten nested custom objects to their form parameter names
    const flat: Record<string, any> = {}
    for (const [key, value] of Object.entries(record)) {
        if (key === "rating" && value && typeof value === "object") {
            flat["rating_suzuki"] = (value as any).suzuki
            flat["rating_nyssma"] = (value as any).nyssma
            continue
        }
        if (key === "publication_info" && value && typeof value === "object") {
            flat["publish_name"] = (value as any).name
            flat["publish_location"] = (value as any).location
            flat["publish_year"] = (value as any).year
            flat["uri_type"] = (value as any).uri_type
            flat["uri"] = (value as any).uri
            continue
        }
        flat[key] = value
    }
    for (const [key, value] of Object.entries(flat)) {
        const elem = document.getElementById(`${prefix}-${key}`)
        if (!elem) {
            console.warn(`Element with id ${prefix}-${key} not found in DOM for form prefill`)
            continue
        }
        const display = (value === null || value === undefined) ? "" : (Array.isArray(value) ? value.join(",") : String(value))
        if (elem instanceof HTMLInputElement || elem instanceof HTMLTextAreaElement || elem instanceof HTMLSelectElement) {
            elem.value = display
        } else {
            console.warn(`Element with id ${prefix}-${key} is not a form input, skipping prefill`)
        }
    }
}

/**
 * Attaches a name-search helper to an entity ID input
 *
 * On button click, fetches the full record list, filters by name (case-insensitive substring),
 * and renders clickable results which fill the target ID input when selected
 *
 * @param {"composer" | "contributor"} kind which record list to search
 * @param {string} input_id DOM id of the search text input
 * @param {string} button_id DOM id of the search button
 * @param {string} results_div_id DOM id of the element in which to render results
 * @param {string} target_input_id DOM id of the ID input to fill upon selection
 */
export function attachSearchHelper(kind: "composer" | "contributor", input_id: string, button_id: string, results_div_id: string, target_input_id: string): void {
    const button = document.getElementById(button_id)
    const input = document.getElementById(input_id)
    const results_div = document.getElementById(results_div_id)
    const target_input = document.getElementById(target_input_id)
    if (!button || !(input instanceof HTMLInputElement) || !results_div || !(target_input instanceof HTMLInputElement)) {
        console.warn(`Search helper elements not found or invalid for ${kind}: `, { input_id, button_id, results_div_id, target_input_id })
        return
    }
    button.addEventListener("click", async (evt: Event) => {
        evt.preventDefault()
        renderSearchProgress(results_div as HTMLElement)
        try {
            const records = (kind === "composer") ? await listComposer(true) : await listContributor(true)
            if (!Array.isArray(records)) {
                throw new Error("No records returned from search")
            }
            const query = input.value.trim().toLowerCase()
            const matches = records.filter((rec: any) => typeof rec?.name === "string" && rec.name.toLowerCase().includes(query))
            results_div.textContent = ""
            if (matches.length === 0) {
                results_div.textContent = "No matches found."
                return
            }
            for (const match of matches) {
                const entry = document.createElement("p")
                const link = document.createElement("a")
                link.href = "#"
                link.textContent = `ID #${match.id} - ${match.name}`
                link.addEventListener("click", (e: Event) => {
                    e.preventDefault()
                    target_input.value = String(match.id)
                    results_div.textContent = `Selected ID #${match.id} - ${match.name}`
                })
                entry.appendChild(link)
                results_div.appendChild(entry)
            }
        } catch (error) {
            // any viewer may list contributors; non-self records come back with protected properties
            // redacted, but the name used for searching is not protected, so search still works
            results_div.textContent = `Search unavailable: ${error instanceof Error ? error.message : String(error)}`
            console.error(error)
        }
    })
}

/**
 * Internal: wires a keyword-search box, delegating per-result link setup to `bindResult`.
 *
 * On button click, sends the keyword (and the database returned by getDatabase) to /api/v1/search and
 * renders each hit as a link. Callers control what selecting a hit does via `bindResult`, which receives
 * the freshly created anchor and its result so it can either set an href (navigation) or attach an
 * on-page click handler.
 *
 * @param {string} input_id DOM id of the keyword text input
 * @param {string} button_id DOM id of the search button
 * @param {string} results_div_id DOM id of the element in which to render results
 * @param {() => SearchDatabase | null} getDatabase returns the database to scope to, or null for all three
 * @param {(link: HTMLAnchorElement, result: SearchResult) => void} bindResult configures each result link
 */
function _attachKeywordSearch(input_id: string, button_id: string, results_div_id: string, getDatabase: () => SearchDatabase | null, bindResult: (link: HTMLAnchorElement, result: SearchResult) => void): void {
    const button = document.getElementById(button_id)
    const input = document.getElementById(input_id)
    const results_div = document.getElementById(results_div_id)
    if (!button || !(input instanceof HTMLInputElement) || !results_div) {
        console.warn("Keyword search elements not found or invalid: ", { input_id, button_id, results_div_id })
        return
    }
    button.addEventListener("click", async (evt: Event) => {
        evt.preventDefault()
        const keyword = input.value.trim()
        if (keyword === "") {
            results_div.textContent = "Enter a keyword to search."
            return
        }
        if (keyword.length < 3) {
            results_div.textContent = "Please enter at least 3 characters for the search."
            return
        }
        renderSearchProgress(results_div as HTMLElement)
        try {
            const results = await searchDatabase(keyword, getDatabase())
            results_div.textContent = ""
            if (!Array.isArray(results) || results.length === 0) {
                results_div.textContent = "No matches found."
                return
            }
            for (const result of results) {
                const entry = document.createElement("p")
                const link = document.createElement("a")
                link.textContent = `ID #${result.id} - ${result.name}`
                bindResult(link, result)
                entry.appendChild(link)
                results_div.appendChild(entry)
            }
        } catch (error) {
            results_div.textContent = `Search unavailable: ${error instanceof Error ? error.message : String(error)}`
            console.error(error)
        }
    })
}

/**
 * Attaches a navigating keyword-search box (used by the standalone search page and the edit pages).
 *
 * Each hit becomes a link whose target is produced by getHref: the standalone search page routes each
 * hit to its entity's info page, while the edit pages route to the current page's "?id=" SSR flow (which
 * prefills the edit form).
 *
 * @param {string} input_id DOM id of the keyword text input
 * @param {string} button_id DOM id of the search button
 * @param {string} results_div_id DOM id of the element in which to render results
 * @param {() => SearchDatabase | null} getDatabase returns the database to scope to, or null for all three
 * @param {(result: SearchResult) => string} getHref builds the href for a given hit
 */
export function attachKeywordSearch(input_id: string, button_id: string, results_div_id: string, getDatabase: () => SearchDatabase | null, getHref: (result: SearchResult) => string): void {
    _attachKeywordSearch(input_id, button_id, results_div_id, getDatabase, (link, result) => {
        link.href = getHref(result)
    })
}

/**
 * Attaches an on-page (non-navigating) keyword-search box, used by the entity info (view) pages.
 *
 * Selecting a hit invokes `onSelect` instead of navigating, so the info pages can load the record in
 * place via the same READ flow used by the ID entry form (which hides both search boxes and renders the
 * record), keeping ID search and keyword search behaviorally identical.
 *
 * @param {string} input_id DOM id of the keyword text input
 * @param {string} button_id DOM id of the search button
 * @param {string} results_div_id DOM id of the element in which to render results
 * @param {() => SearchDatabase | null} getDatabase returns the database to scope to, or null for all three
 * @param {(result: SearchResult) => void} onSelect handles a selected hit (e.g. loads it on-page)
 */
export function attachKeywordSearchInline(input_id: string, button_id: string, results_div_id: string, getDatabase: () => SearchDatabase | null, onSelect: (result: SearchResult) => void): void {
    _attachKeywordSearch(input_id, button_id, results_div_id, getDatabase, (link, result) => {
        link.href = "#"
        link.addEventListener("click", (e: Event) => {
            e.preventDefault()
            onSelect(result)
        })
    })
}

/**
 * Wires the managed-contributor behavior on a composition form
 *
 * contrib_primary_1 and contrib_addl live in a container that is hidden by default: in the managed
 * flow the acting user is recorded automatically (their id is set as the primary contributor on
 * create, and the server records them as an additional contributor on edit). When an administrator is
 * present, a "direct contributor management" toggle reveals these fields for manual editing; toggling
 * it back off restores the managed defaults so nothing the admin typed leaks into a managed submission.
 *
 * The additional-primary slot (contrib_primary_2) is addable by anyone, so it lives in its own
 * container and is shown on create, shown on edit only when the slot is empty (a filled non-self
 * co-primary is protected server-side by canAct), and always shown when an admin edits directly.
 *
 * Reads the acting user's contributor id and admin availability from the form's dataset attributes
 * (data-self-id / data-contrib-direct-available, set by CompositionForm.astro). On the edit page the
 * form may be prefilled client-side after load, so the additional-primary visibility is re-evaluated
 * on the "composition:prefilled" event dispatched by the edit page.
 *
 * @param {HTMLFormElement} form the composition data-entry form
 * @param {boolean} patch whether the form submits a partial (PATCH) edit rather than a create
 */
export function attachContributorManagement(form: HTMLFormElement, patch: boolean): void {
    const container = document.getElementById("form-composition-contributor-fields")
    if (!container) {
        console.warn("Contributor fields container not found; managed-contributor behavior not attached")
        return
    }
    const self_id = form.dataset.selfId ?? ""
    const direct_available = form.dataset.contribDirectAvailable === "true"
    const primary_1 = document.getElementById("form-composition-contrib_primary_1")
    const primary_2 = document.getElementById("form-composition-contrib_primary_2")
    const primary_2_container = document.getElementById("form-composition-primary-2-field")
    const addl = document.getElementById("form-composition-contrib_addl")

    const toggle = document.getElementById("form-composition-contrib_direct")
    const directOn = () => direct_available && toggle instanceof HTMLInputElement && toggle.checked

    // the additional-primary slot is addable by anyone: shown on create, shown on edit only when the
    // slot is empty, and always shown when an admin edits directly
    const applyPrimary2Visibility = () => {
        if (!primary_2_container) return
        let show: boolean
        if (directOn() || !patch) {
            show = true
        } else {
            const current = primary_2 instanceof HTMLInputElement ? primary_2.value.trim() : ""
            show = current === ""
        }
        primary_2_container.classList.toggle("hidden", !show)
        // when hidden on an edit, ensure the slot is not marked for editing so it is not sent
        if (!show && patch) {
            const checkbox = document.getElementById("form-composition-contrib_primary_2-edittarget")
            if (checkbox instanceof HTMLInputElement) checkbox.checked = false
        }
    }

    // managed defaults: the admin-only fields are hidden, and on create the primary contributor is the acting user
    const applyManagedDefaults = () => {
        container.classList.add("hidden")
        if (!patch) {
            // create: the acting user is the primary contributor (the additional-primary slot stays addable)
            if (primary_1 instanceof HTMLInputElement) primary_1.value = self_id
            if (addl instanceof HTMLInputElement) addl.value = ""
        } else {
            // edit: ensure the admin-only fields are not marked for editing, so they are not sent
            for (const param of ["contrib_primary_1", "contrib_addl"]) {
                const checkbox = document.getElementById(`form-composition-${param}-edittarget`)
                if (checkbox instanceof HTMLInputElement) checkbox.checked = false
            }
        }
        applyPrimary2Visibility()
    }

    applyManagedDefaults()

    // re-evaluate the additional-primary visibility once the edit page prefills the form client-side
    form.addEventListener("composition:prefilled", () => applyPrimary2Visibility())

    if (!direct_available || !(toggle instanceof HTMLInputElement)) {
        // no admin toggle on this form; the managed flow is the only option
        return
    }
    toggle.addEventListener("change", () => {
        if (toggle.checked) {
            // reveal the admin-only fields (and the additional-primary slot even if filled) for direct editing
            container.classList.remove("hidden")
            applyPrimary2Visibility()
        } else {
            // restore managed defaults
            applyManagedDefaults()
        }
    })
}

export async function attachNextTask(form: HTMLFormElement, message: Element, exec_mode: APIOpCode, noun: keyof typeof interface_data, try_again: boolean = false, record_id?: number): Promise<void> {
    switch (exec_mode) {
        case APIOpCode.READ: {
            // after viewing a record, offer a direct edit link to the left of the next-task ("View another") link
            const segment = admin_path_segment[interface_data[noun].name]
            const edit_link = (segment && record_id !== undefined && !try_again)
                ? { href: `/admin/${segment}/edit?id=${record_id}`, label: `Edit this ${interface_data[noun].name} >` }
                : undefined
            // info pages also reveal/clear the keyword search box so the next task can search again
            _attachNextTask(form, message, noun, "View", try_again, true, true, edit_link)
            break
        }
        case APIOpCode.LIST:
            console.error("List operation does not have a next task to attach")
            break
        case APIOpCode.CREATE:
            _attachNextTask(form, message, noun, "Create", try_again, false)
            break
        case APIOpCode.UPDATE:
        case APIOpCode.UPDATE_PARTIAL:
            _attachNextTask(form, message, noun, "Edit", try_again, false)
            break
        case APIOpCode.DELETE:
            _attachNextTask(form, message, noun, "Delete", try_again, false)
            break
        default:
            console.warn(`Unsupported operation code ${exec_mode} for next task attachment`)
    }
} 
