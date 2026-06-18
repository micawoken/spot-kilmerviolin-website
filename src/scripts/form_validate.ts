/**
 * 
 * 
 */

import { FIELD_VALIDATORS, validateUriField, VALIDATION_GROUP_MAP, type FormControl } from "./common"



/**
 * Format guidance shown under the composition URI input, keyed by the selected uri_type. Mirrors the
 * per-type rendering in CompositionInfo (renderPublicationUri) and the server-side validation that
 * enforces the type/URI pairing in lib/api/d1.ts.
 */
export const uri_type_help: Record<string, string> = {
    "https": "Enter a full link beginning with https://",
    "isbn": "Enter the ISBN number only, without dashes or spaces.",
    "doi": "Enter the DOI number (beginning with 10.), not a full URL."
}

/**
 * Keeps the composition form's URI help text in sync with the selected URI Type: the help text under the
 * URI input is set from uri_type_help for the current uri_type, updating whenever the selector changes.
 *
 * No-ops if either the URI Type selector or the help element is absent.
 *
 * @param {HTMLFormElement} form the composition form whose URI help text should track its URI Type selector
 */
export function attachUriTypeHelp(form: HTMLFormElement): void {
    const select = form.querySelector("#form-composition-uri_type")
    const help = form.querySelector("#form-composition-uri-help")
    if (!(select instanceof HTMLSelectElement) || !(help instanceof HTMLElement)) {
        return
    }
    const update = () => { help.textContent = uri_type_help[select.value] ?? "" }
    update()
    select.addEventListener("change", update)
}


/**
 * Surfaces a validation hint inline, to the right of (or under) the offending control. The hint reuses
 * the format-token slot: an existing format hint (.field-inline-help) is hidden while the error shows.
 * A .field-error element is created next to the control if one is not already present.
 */
export function showFieldError(control: FormControl, message: string): void {
    const container = control.closest(".field-row") ?? control.parentElement
    if (container) {
        const hint = container.querySelector(":scope > .field-inline-help")
        if (hint instanceof HTMLElement) hint.classList.add("field-hidden")
    }
    let error = control.nextElementSibling
    if (!(error instanceof HTMLElement && error.classList.contains("field-error"))) {
        error = document.createElement("small")
        error.className = "field-error"
        error.setAttribute("role", "alert")
        control.insertAdjacentElement("afterend", error)
    }
    error.textContent = message
    control.classList.add("field-invalid")
}

/** Clears any validation hint on a control, restoring its hidden format token. */
export function clearFieldError(control: FormControl): void {
    const sibling = control.nextElementSibling
    if (sibling instanceof HTMLElement && sibling.classList.contains("field-error")) {
        sibling.remove()
    }
    const container = control.closest(".field-row") ?? control.parentElement
    if (container) {
        const hint = container.querySelector(":scope > .field-inline-help")
        if (hint instanceof HTMLElement) hint.classList.remove("field-hidden")
    }
    control.classList.remove("field-invalid")
}

/**
 * Attaches live per-field validation to a form: each validated field is checked when the user leaves it
 * (blur) and re-checked on every keystroke, so the visual state updates immediately in both directions —
 * a field that becomes invalid is flagged at once (not only on blur), and a corrected field clears
 * promptly. The composition URI is additionally re-validated when its URI Type selector changes.
 *
 * No-ops on fields without a validator. Safe to call on any entity form (create, edit, or profile).
 *
 * @param {HTMLFormElement} form the form whose fields should validate live
 */
export function attachFormValidation(form: HTMLFormElement): void {
    form.querySelectorAll("input, select, textarea").forEach(control => {
        if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) return
        const validator = FIELD_VALIDATORS[control.name]
        if (!validator) return
        const run = () => {
            const message = validator(control.value, form)
            if (message) showFieldError(control, message)
            else clearFieldError(control)
        }
        control.addEventListener("blur", run)
        // re-validate on every keystroke so the invalid state appears immediately, not only once the field
        // is blurred (a corrected field already cleared live; this makes the invalid direction symmetric)
        control.addEventListener("input", run)
    })
    // a URI Type change can change whether the current URI is valid; re-check the URI field
    const uri_type = form.querySelector("#form-composition-uri_type")
    const uri = form.querySelector("#form-composition-uri")
    if (uri_type instanceof HTMLSelectElement && uri instanceof HTMLInputElement) {
        uri_type.addEventListener("change", () => {
            if (uri.value.trim() === "") {
                clearFieldError(uri)
                return
            }
            const message = validateUriField(uri.value, form)
            if (message) showFieldError(uri, message)
            else clearFieldError(uri)
        })
    }
}

/**
 * Validates every applicable field of a form, surfacing inline hints, and reports whether all are valid.
 * Used as a submit gate so a malformed entry is rejected with a specific, in-place message before any
 * request is sent. In patch (partial-edit) mode only fields marked for editing are validated, matching
 * which fields generateObjectForm will actually submit.
 *
 * @param {HTMLFormElement} form the form to validate
 * @param {boolean} patch whether the form is a partial (PATCH) edit
 * @returns {boolean} true if every validated field is acceptable
 */
export function validateFormFields(form: HTMLFormElement, patch: boolean = false): boolean {
    let valid = true
    form.querySelectorAll("input, select, textarea").forEach(control => {
        if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) return
        const validator = FIELD_VALIDATORS[control.name]
        if (!validator) return
        if (patch) {
            // only validate fields that are actually marked for editing (and will be submitted)
            const target = VALIDATION_GROUP_MAP[control.name] ?? control.name
            const checkbox = form.querySelector(`[name="${target}-edittarget"]`)
            if (checkbox instanceof HTMLInputElement && !checkbox.checked) {
                clearFieldError(control)
                return
            }
        }
        const message = validator(control.value, form)
        if (message) {
            showFieldError(control, message)
            valid = false
        } else {
            clearFieldError(control)
        }
    })
    return valid
}