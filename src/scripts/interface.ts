/**
 * scripts/interface.ts
 *
 * Provides high-level functions related to populating the user interface
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

import { interface_data } from "./types"
import { NOT_PROVIDED } from "../consts"
import { formatInfoValue } from "./format"
import { renderPublicationUri } from "./publication"
import {
    renderContributorRefLink,
    renderContributorRefLinks,
    renderComposerNameLink,
    renderComposerNameLinks
} from "./references"
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
    updateProfile
} from "./connector"
import { assertCanEditContributor, errorMessage, generateObjectForm, setInfoHtml, singleParse } from "./common"
import { validateFormFields } from "./form_validate"
import { _resetKeywordSearch } from "./keyword_search"

// DATA FETCHER

// INPUT CONTROL

/**
 * Sets the `disabled` state of every input-like control in a form (inputs, textareas, selects, buttons).
 * Shared by disableInput/enableInput so the form-locking logic lives in one place.
 *
 * @param {HTMLFormElement} form_elem the form whose controls should be toggled
 * @param {boolean} disabled the disabled state to apply
 */
function setInputsDisabled(form_elem: HTMLFormElement, disabled: boolean): void {
    const inputs = form_elem.querySelectorAll("input, textarea, select, button")
    inputs.forEach((input) => {
        if (
            input instanceof HTMLInputElement ||
            input instanceof HTMLTextAreaElement ||
            input instanceof HTMLSelectElement ||
            input instanceof HTMLButtonElement
        ) {
            input.disabled = disabled
        } else {
            console.warn(`Unsupported form element type for ${disabled ? "disabling" : "enabling"}: `, input)
        }
    })
}

export function disableInput(form_elem: HTMLFormElement): void {
    setInputsDisabled(form_elem, true)
}

export function enableInput(form_elem: HTMLFormElement): void {
    setInputsDisabled(form_elem, false)
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
    composer: "generic-form-composers",
    composition: "generic-form-composition",
    contributor_partial: "generic-form-contributors",
    contributor_full: "generic-form-contributors",
    contributor_profile: "generic-form-contributors"
}

const generic_read_code = "generic-form-id-entry"

export function getForm(noun: keyof typeof interface_data, exec_mode: APIOpCode): HTMLFormElement {
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
        const form_code = generic_form_codes[noun]
        const form = document.getElementById(form_code)
        if (!form) {
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
 * Hides the lookup dialogs (ID entry form and keyword search box) once a record has been loaded for
 * on-page viewing in the READ flow, so the rendered record stands alone. Shared by the per-noun READ
 * branches in processSubmit.
 */
function hideLookupForRecordView(): void {
    document.getElementById("generic-form-id-entry-container")?.classList.add("hidden")
    document.getElementById("entity-search-container")?.classList.add("hidden")
}

export async function populateInfo(
    noun: keyof typeof interface_data,
    data: object,
    force_prefix?: string
): Promise<void> {
    const type_name = interface_data[noun].name
    for (const [key, value] of Object.entries(data)) {
        const elem_id =
            force_prefix === undefined ? `${type_name}-${key}` : force_prefix === "" ? key : `${force_prefix}-${key}`
        if (value !== null && typeof value === "object" && !Array.isArray(value)) {
            // nested objects (rating, publication_info) populate elements prefixed with their own id
            await populateInfo(noun, value as object, elem_id)
            continue
        }
        // the publication URI type is intentionally not rendered as its own field on CompositionInfo (the
        // URI render conveys the type); skip it silently rather than warning about the absent element
        if (elem_id.endsWith("publication_info-uri_type")) {
            continue
        }
        const elem = document.getElementById(elem_id)
        if (!elem) {
            console.warn(`Element with id ${elem_id} not found in DOM for populating info`)
            continue
        }
        // image fields render into an <img> element, not text: set its src and toggle the sibling
        // "(no image)" placeholder (id `${elem_id}-missing`). The <img> is always present in the Info
        // components so this client-side READ path can fill it, mirroring the SSR view; the src is left
        // unset when there is no image to avoid a broken-image request.
        if (elem instanceof HTMLImageElement) {
            const missing = document.getElementById(`${elem_id}-missing`)
            const has_image = !(
                value === null ||
                value === undefined ||
                (typeof value === "string" && value.trim() === "")
            )
            if (has_image) {
                elem.src = String(value)
                // mirror the alt text into the hover tooltip (the SSR markup does the same)
                elem.title = elem.alt
                elem.classList.remove("hidden")
                missing?.classList.add("hidden")
            } else {
                elem.removeAttribute("src")
                elem.classList.add("hidden")
                missing?.classList.remove("hidden")
            }
            continue
        }
        // the publication URI renders according to its declared uri_type (a sibling field on the
        // publication_info object currently being populated): a clickable link for https/doi, the literal
        // "isbn:{value}" text for isbn. renderPublicationUri returns markup-safe HTML (every value is
        // escapeHtml-encoded), assigned via innerHTML, mirroring the set:html render in CompositionInfo.astro.
        // A blank/absent URI falls through to the shared "not provided" marker below.
        if (
            elem_id.endsWith("publication_info-uri") &&
            !(value === null || value === undefined || (typeof value === "string" && value.trim() === ""))
        ) {
            elem.innerHTML = renderPublicationUri((data as { uri_type?: string }).uri_type, String(value), NOT_PROVIDED)
            continue
        }
        // phases render with a "Phases" label and a "(no phases specified)" marker when empty (mirrors the
        // ContributorInfo SSR card). This must precede the generic null/array/blank branches below: phases
        // is a number[], so the Array.isArray branch would otherwise overwrite the label with a bare value,
        // and an empty/unset phases value would lose the label to the NOT_PROVIDED marker.
        if (key === "phases" && force_prefix === undefined) {
            const body =
                value === null || value === undefined
                    ? "(no phases specified)"
                    : Array.isArray(value)
                      ? value.length > 0
                          ? value.join(", ")
                          : "(no phases specified)"
                      : typeof value === "string" && value.trim() === ""
                        ? "(no phases specified)"
                        : String(value)
            elem.textContent = `Phases ${body}`
            continue
        }
        // mirror the SSR `disp` helper in the entity Info components: a null/undefined/blank/empty-array
        // value renders as a clear "not provided" marker, and the per-entity special cases (living-composer
        // death year, country code → name, top-level "ID #" prefix, contributor admin account type, plain
        // booleans) render as their human-readable forms (see scripts/format.ts).
        elem.textContent = formatInfoValue(type_name, key, value, force_prefix === undefined)
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
export async function retrieveObjectFromIDEntry(
    id_entry_form: HTMLFormElement,
    noun: keyof typeof interface_data
): Promise<ComposerRecord | Partial<ContributorRecord> | CompositionRecord | null> {
    // retrieve the ID entry value
    const form_data = new FormData(id_entry_form)
    const id = parseInt(singleParse(form_data))
    if (isNaN(id)) {
        throw new Error(`Parsed ID value is not a valid number: ${id}`)
    }
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
            // always request elevation for the prefill lookup: the edit form renders every protected
            // property for admins, so they should always be populated. The server only honors elevation
            // for admins (GET /contributors/[id]), so non-admins still receive the filtered record. The
            // elevation checkbox is reserved for the edit (write) operation, not this read.
            return await getContributor(id, true)
        default:
            throw new Error(`Unsupported noun ${interface_data[noun].name} for retrieval in retrieveObjectFromIDEntry`)
    }
}

/**
 * Parses a submitted form into the API payload for its operation: the record id for single-item
 * operations (READ/DELETE), the id plus a (partial) object for updates, or a freshly generated object
 * for creates. Contributor updates are additionally checked client-side for ownership and protected-property
 * authorization so the user receives an immediate, clear rejection before any request is sent.
 *
 * @param {FormData} formData the submitted form data
 * @param {APIOpCode} exec_mode the operation being performed
 * @param {keyof typeof interface_data} noun the interface noun being operated on
 * @param {HTMLFormElement} form the originating form (for the contributor edit-authorization check)
 * @param {boolean | undefined} elevate whether administrator escalation was requested
 * @returns {{ data: any, record_id?: number }} the generated object and/or target record id
 */
function buildSubmitPayload(
    formData: FormData,
    exec_mode: APIOpCode,
    noun: keyof typeof interface_data,
    form: HTMLFormElement,
    elevate: boolean | undefined
): { data: any; record_id?: number } {
    if (exec_mode === APIOpCode.READ || exec_mode === APIOpCode.DELETE) {
        // single-item exec mode - form is single-item (ID), so pull the single item
        const record_id = parseInt(singleParse(formData))
        if (isNaN(record_id)) {
            throw new Error(`Parsed ID value is not a valid number`)
        }
        return { data: null, record_id }
    } else if (exec_mode === APIOpCode.UPDATE || exec_mode === APIOpCode.UPDATE_PARTIAL) {
        // updates target an existing record via the form's hidden id input
        const record_id = parseInt(String(formData.get("id")))
        if (isNaN(record_id)) {
            throw new Error(`Form data is missing a valid record ID for this operation`)
        }
        const partial = exec_mode === APIOpCode.UPDATE_PARTIAL
        const data = generateObjectForm(
            formData,
            interface_data[noun].interface,
            partial,
            interface_data[noun].custom_objects,
            partial
        )
        // contributor edits are subject to ownership and protected-property authorization; validate
        // client-side before sending so the user receives an immediate, clear rejection
        if (interface_data[noun].name === "contributor") {
            assertCanEditContributor(form, record_id, elevate === true, data as Record<string, any>)
        }
        return { data, record_id }
    } else {
        // standard exec mode - pull form values
        const data = generateObjectForm(
            formData,
            interface_data[noun].interface,
            false,
            interface_data[noun].custom_objects
        )
        return { data }
    }
}

/**
 * Renders a loaded composition record into the info card. When the record carries resolved names, the
 * record is populated generically and then the composer/secondary-author/contributor references are
 * rendered as info-page links (set via innerHTML), mirroring the SSR CompositionInfo card; the *_name keys
 * are held back from the generic pass because they have no plain-text element and render as markup here.
 *
 * @param {Awaited<ReturnType<typeof getWork>>} rec the loaded composition record (possibly name-enhanced)
 * @param {keyof typeof interface_data} noun the composition interface noun
 */
async function displayCompositionRecord(
    rec: NonNullable<Awaited<ReturnType<typeof getWork>>>,
    noun: keyof typeof interface_data
): Promise<void> {
    if (isCompositionWithNames(rec)) {
        // composer_name and author_secondary_names are held back from the generic pass too: like the
        // contributor refs below, they render as info-page links (set:html) rather than the plain text
        // populateInfo would set.
        const {
            contrib_primary_1_name,
            contrib_primary_2_name,
            contrib_addl_names,
            composer_name,
            author_secondary_names,
            ...composer_names
        } = rec.names
        await populateInfo(noun, rec.object as any)
        await populateInfo(noun, composer_names as any)
        const obj = rec.object as CompositionRecord
        // composer and secondary authors link to their composer info pages (mirrors the SSR CompositionInfo card)
        setInfoHtml(
            "composition-composer_name",
            renderComposerNameLink(obj.composer_id, composer_name, "(error in composer name)")
        )
        setInfoHtml(
            "composition-author_secondary_names",
            renderComposerNameLinks(obj.author_secondary, author_secondary_names, "(no secondary authors)")
        )
        // contributor references render inline as "id (name)" links to each contributor info page
        setInfoHtml(
            "composition-contrib_primary_1",
            renderContributorRefLink(obj.contrib_primary_1, contrib_primary_1_name, NOT_PROVIDED)
        )
        setInfoHtml(
            "composition-contrib_primary_2",
            renderContributorRefLink(
                obj.contrib_primary_2,
                contrib_primary_2_name,
                "(no additional primary contributor specified)"
            )
        )
        setInfoHtml(
            "composition-contrib_addl",
            renderContributorRefLinks(obj.contrib_addl, contrib_addl_names, "(no additional contributors specified)")
        )
    } else {
        await populateInfo(noun, rec as any)
    }
}

/**
 * The execution context passed to each entity operation handler in ENTITY_OPS.
 */
interface OpContext {
    form: HTMLFormElement
    message: Element
    data: any
    record_id?: number
    elevate?: boolean
    direct?: boolean
    noun: keyof typeof interface_data
}

/**
 * Dispatch table mapping each API noun and operation to its handler. Each handler issues the connector
 * call, reports the result on the status element, and wires the post-submit next-task links — replacing
 * the per-noun switch that processSubmit previously carried inline. Adding an entity or operation is a
 * matter of adding an entry rather than another switch branch.
 */
const ENTITY_OPS: Record<string, Partial<Record<APIOpCode, (ctx: OpContext) => Promise<void>>>> = {
    composer: {
        [APIOpCode.CREATE]: async ({ form, message, data, noun }) => {
            const id = await createComposer(data as Composer)
            message.textContent = `Request succeeded: assigned composer ID ${id.toString()}`
            await attachNextTask(form, message, APIOpCode.CREATE, noun)
        },
        [APIOpCode.READ]: async ({ form, message, record_id, noun }) => {
            const rec = await getComposer(record_id!)
            if (rec) {
                hideLookupForRecordView()
                await populateInfo(noun, rec as any)
                message.textContent = "Request succeeded: composer loaded"
            } else {
                message.textContent = "No composer found for given ID"
            }
            // offer the edit link only when a record was actually loaded
            await attachNextTask(form, message, APIOpCode.READ, noun, false, rec ? record_id : undefined)
        },
        [APIOpCode.UPDATE]: async ({ form, message, record_id, data, noun }) => {
            await replaceComposer(record_id!, data as Composer)
            message.textContent = "Request succeeded: updated composer record"
            await attachNextTask(form, message, APIOpCode.UPDATE, noun)
        },
        [APIOpCode.UPDATE_PARTIAL]: async ({ form, message, record_id, data, noun }) => {
            await updateComposer(record_id!, data as Partial<Composer>)
            message.textContent = "Request succeeded: updated composer record"
            await attachNextTask(form, message, APIOpCode.UPDATE_PARTIAL, noun)
        },
        [APIOpCode.DELETE]: async ({ form, message, record_id, noun }) => {
            await deleteComposer(record_id!)
            message.textContent = "Request succeeded: deleted composer record"
            await attachNextTask(form, message, APIOpCode.DELETE, noun)
        },
        [APIOpCode.LIST]: async ({ message }) => {
            await listComposer()
            message.textContent = "Request succeeded: list retrieved"
        }
    },
    composition: {
        [APIOpCode.CREATE]: async ({ form, message, data, noun }) => {
            const id = await createWork(data as Composition)
            message.textContent = `Request succeeded: assigned composition ID ${id.toString()}`
            await attachNextTask(form, message, APIOpCode.CREATE, noun)
        },
        [APIOpCode.READ]: async ({ form, message, record_id, noun }) => {
            // request resolved composer and contributor names so the view can show them alongside the numeric ids
            const rec = await getWork(record_id!, true)
            if (rec) {
                hideLookupForRecordView()
                await displayCompositionRecord(rec, noun)
                message.textContent = "Request succeeded: composition loaded"
            } else {
                message.textContent = "No composition found for given ID"
            }
            // offer the edit link only when a record was actually loaded
            await attachNextTask(form, message, APIOpCode.READ, noun, false, rec ? record_id : undefined)
        },
        [APIOpCode.UPDATE]: async ({ form, message, record_id, data, elevate, direct, noun }) => {
            await replaceWork(record_id!, data as Composition, elevate, direct)
            message.textContent = "Request succeeded: updated composition record"
            await attachNextTask(form, message, APIOpCode.UPDATE, noun)
        },
        [APIOpCode.UPDATE_PARTIAL]: async ({ form, message, record_id, data, elevate, direct, noun }) => {
            await updateWork(record_id!, data as Partial<Composition>, elevate, direct)
            message.textContent = "Request succeeded: updated composition record"
            await attachNextTask(form, message, APIOpCode.UPDATE_PARTIAL, noun)
        },
        [APIOpCode.DELETE]: async ({ form, message, record_id, elevate, noun }) => {
            await deleteWork(record_id!, elevate)
            message.textContent = "Request succeeded: deleted composition record"
            await attachNextTask(form, message, APIOpCode.DELETE, noun)
        },
        [APIOpCode.LIST]: async ({ message }) => {
            await listWork()
            message.textContent = "Request succeeded: list retrieved"
        }
    },
    contributor: {
        [APIOpCode.CREATE]: async ({ form, message, data, noun }) => {
            const id = await createContributor(data as Contributor)
            message.textContent = `Request succeeded: assigned contributor ID ${id.toString()}`
            await attachNextTask(form, message, APIOpCode.CREATE, noun)
        },
        [APIOpCode.READ]: async ({ form, message, record_id, noun }) => {
            // always request elevation for the view lookup: the info card shows protected properties for
            // admins, so they should always be populated. The server only honors elevation for admins
            // (GET /contributors/[id]), so non-admins still receive the filtered record.
            const rec = await getContributor(record_id!, true)
            if (rec) {
                hideLookupForRecordView()
                await populateInfo(noun, rec as any)
                message.textContent = "Request succeeded: contributor loaded"
            } else {
                message.textContent = "No contributor found for given ID"
            }
            // offer the edit link only when a record was actually loaded
            await attachNextTask(form, message, APIOpCode.READ, noun, false, rec ? record_id : undefined)
        },
        [APIOpCode.UPDATE]: async ({ form, message, record_id, data, noun }) => {
            await replaceContributor(record_id!, data as Contributor)
            message.textContent = "Request succeeded: updated contributor record"
            await attachNextTask(form, message, APIOpCode.UPDATE, noun)
        },
        [APIOpCode.UPDATE_PARTIAL]: async ({ form, message, record_id, data, elevate, noun }) => {
            await updateContributor(record_id!, data as Partial<Contributor>, elevate)
            message.textContent = "Request succeeded: updated contributor record"
            await attachNextTask(form, message, APIOpCode.UPDATE_PARTIAL, noun)
        },
        [APIOpCode.DELETE]: async ({ form, message, record_id, noun }) => {
            await deleteContributor(record_id!)
            message.textContent = "Request succeeded: deleted contributor record"
            await attachNextTask(form, message, APIOpCode.DELETE, noun)
        },
        [APIOpCode.LIST]: async ({ message }) => {
            await listContributor()
            message.textContent = "Request succeeded: list retrieved"
        }
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
export async function processSubmit(
    submit_event: SubmitEvent | PointerEvent,
    form: HTMLFormElement,
    message: Element,
    exec_mode: APIOpCode,
    noun: keyof typeof interface_data
) {
    submit_event.preventDefault()
    message.textContent = "Processing request..."
    if (!(form instanceof HTMLFormElement)) {
        throw new Error(`Invalid form input for processSubmit: expected HTMLFormElement, got ${typeof form}`)
    }
    const formData = new FormData(form)
    disableInput(form)
    // client-side format validation with inline hints; the ID-entry form used by READ/DELETE has no
    // validated fields, so it is skipped. A failure aborts before any request, leaving the field hints up.
    if (exec_mode !== APIOpCode.READ && exec_mode !== APIOpCode.DELETE) {
        if (!validateFormFields(form, exec_mode === APIOpCode.UPDATE_PARTIAL)) {
            message.textContent = "Please correct the highlighted fields and try again."
            enableInput(form)
            return
        }
    }
    // optional elevation/escalation checkbox rendered on some admin forms (ignored by generateObjectForm)
    const elevate = formData.get("elevate") === "on" ? true : undefined
    // optional direct-contributor-management toggle (composition admin forms); signals the server not to auto-add the editor
    const direct = formData.get("contrib_direct") === "on" ? true : undefined

    try {
        const { data, record_id } = buildSubmitPayload(formData, exec_mode, noun, form, elevate)
        // route to the connector call for this entity and operation (see ENTITY_OPS)
        const api_noun = interface_data[noun].name
        const handler = ENTITY_OPS[api_noun]?.[exec_mode]
        if (!handler) {
            throw new Error(`Unsupported API noun ${api_noun}`)
        }
        await handler({ form, message, data, record_id, elevate, direct, noun })
    } catch (error) {
        message.textContent = `Error: ${errorMessage(error)}`
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
export function genHandler(
    form: HTMLFormElement,
    message: Element,
    exec_mode: APIOpCode,
    noun: keyof typeof interface_data
): EventListener {
    return (evt: Event) => {
        if (!(evt instanceof SubmitEvent) && !(evt instanceof PointerEvent)) {
            throw new Error(`Unsupported event type ${evt.type} in event handler`)
        }
        processSubmit(evt, form, message, exec_mode, noun)
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
    try {
        // client-side format validation with inline hints, before generating and sending the update
        if (!validateFormFields(form, false)) {
            message.textContent = "Please correct the highlighted fields and try again."
            return
        }
        // snapshot the form values before disabling its inputs: disabled controls are omitted from
        // FormData, so disabling first would drop every field (the required `name` throws first)
        const form_data = new FormData(form)
        disableInput(form)
        // generate in non-patch mode: every profile field is present in the form and is sent on save
        const data = generateObjectForm(form_data, interface_data["contributor_profile"].interface, false, [], false)
        // fold a changed self-service github_username into the same PATCH; the server treats it as a
        // conditionally protected field (freely editable until the link is authorized) and applies it through
        // the GitHub binding. A null value unlinks; an omitted/locked/unchanged field leaves the link alone.
        const github_change = readProfileGithubChange(form, form_data)
        if (github_change !== null) {
            ;(data as Record<string, unknown>)["github_username"] = github_change.username
        }
        const github_failure = await updateProfile(self_id, data as Partial<Contributor>)
        if (github_failure !== null) {
            // the profile fields saved but the github link did not; the entered value is left in place so the
            // user can see what was rejected, alongside the reason
            message.textContent = `Your profile was updated, but your GitHub username was not changed: ${github_failure.github_error}`
        } else {
            // keep the tracked original in sync so a later save in the same session does not re-apply
            if (github_change !== null) {
                const input = form.querySelector("#form-contributors-github_username")
                if (input instanceof HTMLInputElement) {
                    input.dataset.original = github_change.username ?? ""
                }
            }
            message.textContent = "Request succeeded: your profile has been updated."
        }
        enableInput(form)
        restoreGithubLock(form)
    } catch (error) {
        message.textContent = `Error: ${errorMessage(error)}`
        console.error(error)
        // allow the user to correct their input and retry
        enableInput(form)
        restoreGithubLock(form)
    }
}

/**
 * Reads a changed self-service GitHub username from the profile editor, for folding into the profile PATCH.
 *
 * Returns { username } (a non-empty login, or null to unlink) only when the field is rendered and its value
 * differs from the currently linked username (tracked in data-original). Returns null — leaving the link
 * untouched — when the field is absent, locked (disabled, so omitted from the snapshot), or unchanged. The
 * snapshot is read rather than the live input because submit disables the form's controls before this runs.
 *
 * @param {HTMLFormElement} form the profile editor form
 * @param {FormData} form_data the snapshot taken before the form's inputs were disabled
 * @returns {{ username: string | null } | null} the change to apply, or null when nothing changed
 */
function readProfileGithubChange(form: HTMLFormElement, form_data: FormData): { username: string | null } | null {
    if (!form_data.has("github_username")) {
        return null
    }
    const input = form.querySelector("#form-contributors-github_username")
    const original = (input instanceof HTMLInputElement ? (input.dataset.original ?? "") : "").trim()
    const next = String(form_data.get("github_username") ?? "").trim()
    if (next === original) {
        return null
    }
    return { username: next === "" ? null : next }
}

/**
 * Re-disables the self-service GitHub field after a submit if it was locked (authorized for repository
 * access). enableInput re-enables every control indiscriminately, so this restores the lock that the
 * profile page applies client-side once the account is authorized (marked with data-locked). No-op when
 * the field is absent or unlocked.
 *
 * @param {HTMLFormElement} form the profile editor form
 */
function restoreGithubLock(form: HTMLFormElement): void {
    const input = form.querySelector("#form-contributors-github_username")
    if (input instanceof HTMLInputElement && input.dataset.locked === "true") {
        input.disabled = true
    }
}

/**
 * Restores the record-lookup view that the edit pages hide once a record is loaded into the edit form.
 *
 * The edit pages (contributors/works/composers) hide the ID entry form, the keyword search box, and — on
 * the contributor page — the standalone elevation box when a record is loaded for editing. After a
 * successful edit, the "Edit another" next task calls this to re-reveal and reset those lookup dialogs so
 * the user can pull up another record. Resetting the ID entry form also clears the elevation checkbox
 * bound to it via its `form` attribute. No-ops on any element that is absent, so it is safe to call generally.
 */
function _resetLookup(): void {
    document.getElementById("generic-form-id-entry-container")?.classList.remove("hidden")
    const id_entry_form = document.getElementById("generic-form-id-entry")
    if (id_entry_form instanceof HTMLFormElement) {
        id_entry_form.reset()
    }
    // the contributor edit page renders the elevation control as a standalone box placed after the lookups
    document.getElementById("generic-form-id-entry-elevate-container")?.classList.remove("hidden")
    // the keyword search box is shared with the info pages
    _resetKeywordSearch()
}

function _nextTaskEventListener(
    form: HTMLFormElement,
    message: Element,
    action: Element,
    clear_state?: keyof typeof interface_data,
    reveal_search: boolean = false,
    relookup: boolean = false
): (e: Event) => void {
    return (e: Event) => {
        e.preventDefault()
        form.reset()
        enableInput(form)
        if (relookup) {
            // edit pages: the submitted form is the prefilled edit form (not a lookup form), and it carries
            // the hidden class on the form element itself. Hide it again and restore the ID-entry/keyword-
            // search/elevation lookup dialogs so the user can pull up another record to edit.
            form.classList.add("hidden")
            _resetLookup()
        } else {
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
        }
        message.textContent = 'Your request status will show here after you press "Submit".'
        if (clear_state) {
            clearInfo(clear_state)
        }
        message.removeChild(action)
    }
}

/**
 * Maps each interface noun's canonical name to its admin URL path segment.
 *
 * The admin CRUD pages live under /admin/{segment}/...; the segment matches the canonical name for
 * composers and contributors, but compositions are served under "works" (see the ListResults note in
 * admin/works/list.astro), so the mapping is explicit rather than a naive pluralization.
 */
const admin_path_segment: Record<string, string> = {
    composer: "composers",
    composition: "works",
    contributor: "contributors"
}

/**
 * Maps interface nouns to the DOM id prefix used by their form inputs
 */
const form_input_prefix: Record<keyof typeof interface_data, string> = {
    composer: "form-composers",
    composition: "form-composition",
    contributor_partial: "form-contributors",
    contributor_full: "form-contributors",
    contributor_profile: "form-contributors"
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
        const display =
            value === null || value === undefined ? "" : Array.isArray(value) ? value.join(",") : String(value)
        if (
            elem instanceof HTMLInputElement ||
            elem instanceof HTMLTextAreaElement ||
            elem instanceof HTMLSelectElement
        ) {
            elem.value = display
        } else {
            console.warn(`Element with id ${prefix}-${key} is not a form input, skipping prefill`)
        }
    }
}

// COMPONENT ATTACH FUNCTIONS

function _attachNextTask(
    form: HTMLFormElement,
    message: Element,
    noun: keyof typeof interface_data,
    action_text: string,
    try_again: boolean,
    clear_state: boolean,
    reveal_search: boolean = false,
    relookup: boolean = false,
    edit_link?: { href: string; label: string }
): void {
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
    next_task_link_object.textContent = try_again
        ? `Try again >`
        : `${action_text} another ${interface_data[noun].name} >`
    next_task_link_object.addEventListener(
        "click",
        _nextTaskEventListener(
            form,
            message,
            next_task_link_text,
            clear_state ? noun : undefined,
            reveal_search,
            relookup
        )
    )
    next_task_link_text.appendChild(next_task_link_object)
    message.appendChild(next_task_link_text)
}

export async function attachNextTask(
    form: HTMLFormElement,
    message: Element,
    exec_mode: APIOpCode,
    noun: keyof typeof interface_data,
    try_again: boolean = false,
    record_id?: number
): Promise<void> {
    switch (exec_mode) {
        case APIOpCode.READ: {
            // after viewing a record, offer a direct edit link to the left of the next-task ("View another") link
            const segment = admin_path_segment[interface_data[noun].name]
            const edit_link =
                segment && record_id !== undefined && !try_again
                    ? {
                          href: `/admin/${segment}/edit?id=${record_id}`,
                          label: `Edit this ${interface_data[noun].name} >`
                      }
                    : undefined
            // info pages also reveal/clear the keyword search box so the next task can search again
            _attachNextTask(form, message, noun, "View", try_again, true, true, false, edit_link)
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
            // the edit pages hide their lookup dialogs when a record loads; relookup restores them for the next edit
            _attachNextTask(form, message, noun, "Edit", try_again, false, false, true)
            break
        case APIOpCode.DELETE:
            _attachNextTask(form, message, noun, "Delete", try_again, false)
            break
        default:
            console.warn(`Unsupported operation code ${exec_mode} for next task attachment`)
    }
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
