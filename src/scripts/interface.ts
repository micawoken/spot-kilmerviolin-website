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
    replaceWork,
    updateWork,
    deleteWork,
    listWork,
    createContributor,
    getContributor,
    replaceContributor,
    updateContributor,
    deleteContributor,
    listContributor
} from "./connector"

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

function argParse(param: string, type: string, raw_value: string): string | string[] | number | number[] | boolean | undefined {
    switch (type) {
        case "string":
            return raw_value
        case "number":
            const value_num = parseFloat(raw_value)
            if (isNaN(value_num)) {
                throw new Error(`Invalid number input for parameter ${param}`)
            }
            return value_num
        case "boolean":
            return raw_value.toLowerCase() === "true"
        case "string[]":
            return raw_value.split(",").map(s => s.trim())
        case "number[]":
            const value_num_a = raw_value.split(",").map(s => {
                const num = parseFloat(s.trim())
                if (isNaN(num)) {
                    throw new Error(`Invalid number input in array for parameter ${param}`)
                }
                return num
            })
            return value_num_a
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
    if (!params.every(param => form_data.has(param))) {
        if (!allow_omit && !nullable) {
            throw new Error(`Form data is missing required parameters for custom object ${custom_object_type}: ${params.filter(param => !form_data.has(param)).join(", ")}`)
        }
        return;
    }
    const output = constructor(...params.map(param => form_data.get(param)))
    if (!output) {
        if (!allow_omit && !nullable) {
            throw new Error(`Constructor for custom object ${custom_object_type} returned null or undefined, likely due to invalid input parameters. Constructor parameters: ${params.map(param => `${param}=${form_data.get(param)}`).join(", ")}`)
        }
        console.log("Constructor failed, ignoring inputs: ", params.map(param => `${param}=${form_data.get(param)}`).join(", "))
        return;
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
        if (!parsed) {
            // a parsing error is not caught and will follow up the call stack if the arg is not required
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
        result[param] = parsed_value
    }
    return result
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
        elem.textContent = (value === null || value === undefined) ? "" : (Array.isArray(value) ? value.join(", ") : String(value))
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
        case "composition":
            return await getWork(id)
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
                        await populateInfo(noun, rec as any)
                        message.textContent = "Request succeeded: composer loaded"
                    } else {
                        message.textContent = "No composer found for given ID"
                    }
                    await attachNextTask(form, message, exec_mode, noun)
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
                    const rec = await getWork(record_id!)
                    if (rec) {
                        document.getElementById("generic-form-id-entry-container")?.classList.add("hidden")
                        await populateInfo(noun, rec as any)
                        message.textContent = "Request succeeded: composition loaded"
                    } else {
                        message.textContent = "No composition found for given ID"
                    }
                    await attachNextTask(form, message, exec_mode, noun)
                    break
                }
                case APIOpCode.UPDATE: {
                    await replaceWork(record_id!, data as Composition, elevate)
                    message.textContent = "Request succeeded: updated composition record"
                    await attachNextTask(form, message, exec_mode, noun)
                    break
                }
                case APIOpCode.UPDATE_PARTIAL: {
                    await updateWork(record_id!, data as Partial<Composition>, elevate)
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
                        await populateInfo(noun, rec as any)
                        message.textContent = "Request succeeded: contributor loaded"
                    } else {
                        message.textContent = "No contributor found for given ID"
                    }
                    await attachNextTask(form, message, exec_mode, noun)
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

function _nextTaskEventListener(form: HTMLFormElement, message: Element, action: Element, clear_state?: keyof typeof interface_data): (e: Event) => void {
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
        message.textContent = "Your request status will show here after you press \"Submit\"."
        if (clear_state) {
            clearInfo(clear_state)
        }
        message.removeChild(action)
    }
}

function _attachNextTask(form: HTMLFormElement, message: Element, noun: keyof typeof interface_data, action_text: string, try_again: boolean, clear_state: boolean): void {
    const next_task_link_text = document.createElement("p")
    const next_task_link_object = document.createElement("a")
    next_task_link_object.href = "#"
    next_task_link_object.textContent = try_again ? `Try again >` : `${action_text} another ${interface_data[noun].name} >`
    next_task_link_object.addEventListener("click", _nextTaskEventListener(form, message, next_task_link_text, clear_state ? noun : undefined))
    next_task_link_text.appendChild(next_task_link_object)
    message.appendChild(next_task_link_text)
}

/**
 * Maps interface nouns to the DOM id prefix used by their form inputs
 */
const form_input_prefix: Record<keyof typeof interface_data, string> = {
    "composer": "form-composers",
    "composition": "form-composition",
    "contributor_partial": "form-contributors",
    "contributor_full": "form-contributors",
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
        results_div.textContent = "Searching..."
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
                link.textContent = `#${match.id} - ${match.name}`
                link.addEventListener("click", (e: Event) => {
                    e.preventDefault()
                    target_input.value = String(match.id)
                    results_div.textContent = `Selected #${match.id} - ${match.name}`
                })
                entry.appendChild(link)
                results_div.appendChild(entry)
            }
        } catch (error) {
            // a 403 is expected for non-admins searching contributors
            results_div.textContent = `Search unavailable: ${error instanceof Error ? error.message : String(error)}`
            console.error(error)
        }
    })
}

export async function attachNextTask(form: HTMLFormElement, message: Element, exec_mode: APIOpCode, noun: keyof typeof interface_data, try_again: boolean = false): Promise<void> {
    switch (exec_mode) {
        case APIOpCode.READ:
            _attachNextTask(form, message, noun, "View", try_again, true)
            break
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
