/**
 * 
 * 
 */

import { FIELD_VALIDATORS, validateUriField, VALIDATION_GROUP_MAP, type FormControl } from "./common"
import { isValidCountryCode, normalizeCountryCode } from "../lib/api/validation"
import { countryCodeName, countryNameToCode } from "./format"



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


// the ISO 3166-1 reference, surfaced in the country field's validation hint so the user can look up a
// code when their entry is not recognised
const COUNTRY_ISO_URL = "https://www.iso.org/obp/ui"
const COUNTRY_ISO_LABEL = "ISO 3166-1 alpha-2"

/**
 * Builds the unrecognised-country error ("Enter a valid <ISO 3166-1 alpha-2 link> code") as a DOM
 * subtree rather than an HTML string. The link is constructed element-by-element so no markup is ever
 * parsed from a string here — keeping this off the innerHTML path so the error slot can never become an
 * injection sink if the surrounding text is later changed to include a dynamic value.
 */
function buildCountryError(): HTMLElement {
    const error = document.createElement("small")
    error.className = "field-error"
    error.setAttribute("role", "alert")
    error.appendChild(document.createTextNode("Enter a valid "))
    const link = document.createElement("a")
    link.href = COUNTRY_ISO_URL
    link.target = "_blank"
    link.rel = "noopener"
    link.textContent = COUNTRY_ISO_LABEL
    error.appendChild(link)
    error.appendChild(document.createTextNode(" code"))
    return error
}

/**
 * Renders the composer country field's feedback and reports whether the current value is acceptable.
 * Unlike the generic format-hint fields, the country input resolves the entered code to a country name: a
 * recognised code shows its determined country name in the inline help (e.g. "FR" -> "France"), a blank
 * field shows neutral guidance, and an unrecognised entry is flagged with an error carrying the ISO 3166-1
 * reference link. Shared by the live listeners (attachCountryFeedback) and the submit gate
 * (validateCountryFeedback) so both render identically.
 *
 * @param {HTMLInputElement} input the country input
 * @param {HTMLElement} help the inline help element to repurpose for the resolved name / guidance
 * @returns {boolean} true if the value is blank or a recognised code, false if it is unrecognised
 */
function renderCountryFeedback(input: HTMLInputElement, help: HTMLElement): boolean {
    // drop any error left from a previous (invalid) state before re-deciding
    const prior = input.nextElementSibling
    if (prior instanceof HTMLElement && prior.classList.contains("field-error")) {
        prior.remove()
    }
    const raw = input.value.trim()
    if (raw === "") {
        // neutral guidance: no resolved name yet, and the reference link now lives in the error state
        input.classList.remove("field-invalid")
        help.classList.remove("field-hidden")
        help.textContent = "ISO 3166-1 alpha-2 code or country name"
        return true
    }
    if (isValidCountryCode(normalizeCountryCode(raw))) {
        // recognised code: show the determined country name in place of the reference link
        input.classList.remove("field-invalid")
        help.classList.remove("field-hidden")
        help.textContent = countryCodeName(raw)
        return true
    }
    const from_name = countryNameToCode(raw)
    if (from_name) {
        // recognised common English name: accept it and show the country with the code it resolves to, so the
        // user sees it will be stored as that code (the name is converted to the code on submit, in argParse)
        input.classList.remove("field-invalid")
        help.classList.remove("field-hidden")
        help.textContent = `${countryCodeName(from_name)} (${from_name})`
        return true
    }
    // unrecognised: hide the help token and flag the field, carrying the ISO link in the error text
    help.classList.add("field-hidden")
    input.classList.add("field-invalid")
    input.insertAdjacentElement("afterend", buildCountryError())
    return false
}

/**
 * Live feedback for the composer country field, resolving the entered code to a country name on every
 * keystroke and on blur (see renderCountryFeedback). This replaces the static code link the field
 * previously displayed, so the country field is handled here rather than through FIELD_VALIDATORS.
 *
 * No-ops if the country input or its help element is absent (so it is safe to call on any form).
 *
 * @param {HTMLFormElement} form the composer form whose country field should show resolved feedback
 */
export function attachCountryFeedback(form: HTMLFormElement): void {
    const input = form.querySelector("#form-composers-country")
    const help = form.querySelector("#form-composers-country-help")
    if (!(input instanceof HTMLInputElement) || !(help instanceof HTMLElement)) {
        return
    }
    const update = () => { renderCountryFeedback(input, help) }
    update()
    input.addEventListener("input", update)
    input.addEventListener("blur", update)
}

/**
 * Submit-time gate for the composer country field, complementing its live feedback. Returns true when the
 * field is absent, blank, or holds a recognised code; otherwise it renders the country error (with the ISO
 * link) through the same feedback path used live and returns false. In patch mode an unchecked edit target
 * skips the check, matching which fields generateObjectForm actually submits.
 *
 * @param {HTMLFormElement} form the form being submitted
 * @param {boolean} patch whether the form is a partial (PATCH) edit
 * @returns {boolean} true if the country field is acceptable (or not present / not being edited)
 */
function validateCountryFeedback(form: HTMLFormElement, patch: boolean): boolean {
    const input = form.querySelector("#form-composers-country")
    const help = form.querySelector("#form-composers-country-help")
    if (!(input instanceof HTMLInputElement) || !(help instanceof HTMLElement)) {
        return true
    }
    if (patch) {
        const checkbox = form.querySelector('[name="country-edittarget"]')
        if (checkbox instanceof HTMLInputElement && !checkbox.checked) {
            return true
        }
    }
    return renderCountryFeedback(input, help)
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

/**
 * Surfaces a non-blocking caution beside a control, in the same inline slot as showFieldError but styled
 * as a colored warning (.field-warning) rather than a hard error. Unlike an error it does not flag the
 * control invalid or block submission; it draws attention to something the operator should know (e.g. an
 * image that will be upscaled). A prior warning element is reused/updated rather than duplicated.
 */
export function showFieldWarning(control: FormControl, message: string): void {
    let warning = control.nextElementSibling
    if (!(warning instanceof HTMLElement && warning.classList.contains("field-warning"))) {
        warning = document.createElement("small")
        warning.className = "field-warning"
        warning.setAttribute("role", "status")
        control.insertAdjacentElement("afterend", warning)
    }
    warning.textContent = message
}

/** Clears any non-blocking warning previously shown on a control by showFieldWarning. */
export function clearFieldWarning(control: FormControl): void {
    const sibling = control.nextElementSibling
    if (sibling instanceof HTMLElement && sibling.classList.contains("field-warning")) {
        sibling.remove()
    }
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
    // a birth-year change can flip whether the death year is consistent with it; re-check the death year
    // so the cross-field hint appears/clears immediately rather than only when the death field is touched
    const birth_year = form.querySelector('[name="birth_year"]')
    const death_year = form.querySelector('[name="death_year"]')
    if (birth_year instanceof HTMLInputElement && death_year instanceof HTMLInputElement) {
        birth_year.addEventListener("input", () => {
            const validator = FIELD_VALIDATORS[death_year.name]
            if (!validator) return
            const message = validator(death_year.value, form)
            if (message) showFieldError(death_year, message)
            else clearFieldError(death_year)
        })
    }
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
    // the composer country field is validated through its own resolved-name feedback path rather than
    // FIELD_VALIDATORS; gate it here too so an unrecognised code blocks submission (no-op on other forms)
    if (!validateCountryFeedback(form, patch)) {
        valid = false
    }
    return valid
}