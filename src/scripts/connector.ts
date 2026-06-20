/**
 * scripts/connector.ts
 *
 * Performs low-level connection to the API and performs request and response processing
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

import type { CropSelection } from "./image_crop"

// API REQUEST GENERATION

/**
 * The API version for this connector file
 */
export const api_version = 1

/**
 * Internal function to generate endpoint
 *
 * @param noun the API object representation to access (ex. composers, contributors, etc.)
 * @param subject the specific instance, if any, of the object to access
 * @returns the generated API endpoint
 */
function composeUrl(noun: string, subject: string | null = null): string {
    if (subject) {
        return `/api/v${api_version.toString()}/${noun}/${subject}`
    }
    return `/api/v${api_version.toString()}/${noun}`
}

/**
 * Internal function to generate the X-MWMSC-Request-Meta header
 *
 * The X-MWMSC-Request-Meta header is used to pass optional request information to modify the server's output. Use cases include, but are not limited to, requesting full object records instead of just IDs and requesting elevation of the request operation. The header contents should be formatted as a simple JS object, serialized to a JSON string. The server-side API parser enforces a maximum length of 512 characters for the header.
 *
 * @param objects the object to be stringified and included in the header
 * @returns the stringified object, or undefined if the input is not an object
 */
function _constructMeta(objects: object | null | undefined): string | undefined {
    if (objects === undefined || objects === null) {
        return undefined
    }
    if (typeof objects !== "object") {
        return undefined
    }
    return JSON.stringify(objects)
}

/**
 * Wrapper around _constructMeta to enforce header length limit and handle undefined
 *
 * @param objects the object to be included in the header
 * @returns an object containing the X-MWMSC-Request-Meta header if the meta value is valid, or an empty object if the meta value is undefined or exceeds length limits
 */
function constructMeta(objects: object | null | undefined): Record<string, string> {
    const meta_value = _constructMeta(objects)
    if (meta_value && meta_value.length > 512) {
        console.warn("Meta header value exceeds maximum length of 512 characters and will be omitted: ", meta_value)
        return {}
    }
    return meta_value ? { "X-MWMSC-Request-Meta": meta_value } : {}
}

// API RESPONSE PROCESSING

/**
 * Converts a Location header into an ID number
 *
 * The expected location format is "/api/v{ver}/{noun}/{id}"
 *
 * @param location the Location header value to parse
 * @return the extracted ID as a number, or null if the format is invalid or the ID is not a valid number
 *
 */
function stripAPILocation(location: string): number | null {
    // a leading slash yields an empty first component, so "/api/v1/{noun}/{id}" splits into exactly five
    // segments: ["", "api", "v{ver}", "{noun}", "{id}"]. Require the id segment to be present (length >= 5,
    // not just >= 4 where components[4] is undefined) and validate the api/v# prefix by component.
    const components = location.split("/")
    const validate =
        components.length >= 5 &&
        components[1] === "api" &&
        /^v\d+$/.test(components[2]) &&
        components[3] !== "" &&
        components[4] !== ""
    if (!validate) {
        console.warn(`Invalid Location header format: ${location}`)
        return null
    }
    const id_component = parseInt(components[4], 10)
    if (isNaN(id_component)) {
        console.warn(`ID component of Location header is not a valid number: ${components[4]}`)
        return null
    }
    return id_component || null
}

/**
 * Internal function to parse API responses
 *
 * @param response the response object returned by the fetch call
 * @param null_request_header if the response body is null, attempt to fetch the content of the specified header and return as a string
 * @returns the parsed response body, or the raw text if parsing fails, or undefined if the response body is empty
 */
async function parser(response: Response, null_request_header?: string): Promise<APIResponse | string | undefined> {
    const text = await response.text()
    if (!response.ok) {
        // attempt to surface the server's error comment instead of a generic failure message
        try {
            const error_data = JSON.parse(text)
            if (
                error_data &&
                typeof error_data === "object" &&
                typeof error_data.comment === "string" &&
                error_data.comment !== ""
            ) {
                throw new Error(`API request failed with status ${response.status}: ${error_data.comment}`)
            }
        } catch (e) {
            if (e instanceof Error && e.message.startsWith("API request failed")) {
                throw e
            }
            // fall through to the generic error for unparseable bodies
        }
        throw new Error(`API request failed with status ${response.status}`)
    }
    if (text === "") {
        if (null_request_header) {
            const header_value = response.headers.get(null_request_header)
            if (header_value) {
                return {
                    success: response.ok,
                    payload: header_value,
                    comment: `API request succeeded with empty response body. Retrieved value from header ${null_request_header}.`
                }
            }
            throw new Error(`API response body is empty and header ${null_request_header} not found`)
        }
        return undefined
    }
    try {
        const data = JSON.parse(text)
        // successful responses (e.g. 201 Created) carry a JSON body whose payload may be null while the
        // requested value travels in a header (e.g. Location); substitute it so callers see the header value
        if (
            null_request_header &&
            data &&
            typeof data === "object" &&
            data.success === true &&
            (data.payload === null || data.payload === undefined)
        ) {
            const header_value = response.headers.get(null_request_header)
            if (header_value) {
                return {
                    success: true,
                    payload: header_value,
                    comment: `API request succeeded with empty payload. Retrieved value from header ${null_request_header}.`
                }
            }
            throw new Error(`API response payload is empty and header ${null_request_header} not found`)
        }
        return data
    } catch (e) {
        if (e instanceof Error && e.message.startsWith("API response payload is empty")) {
            throw e
        }
        console.error("Error parsing JSON response: ", e)
        return text
    }
}

/**
 * Internal function to interpret API response payloads
 *
 * @param data_response the response body returned by the parser function
 * @returns the interpreted payload, or null if the response indicates failure or if the payload is empty
 * @throws {Error} if the response indicates failure with an accompanying comment, or if the response format is unexpected
 */
function interpretPayload(data_response: APIResponse | string | undefined) {
    if (typeof data_response === "string") {
        throw new Error(`Unexpected response format: ${data_response}`)
    } else if (data_response === undefined) {
        return null
    }
    if (!data_response.success) {
        throw new Error(`API error: ${data_response.comment}`)
    }
    return data_response.payload
}

// API REQUEST HELPERS

/**
 * Builds a RequestInit for an API call.
 *
 * Request bodies follow the single-item array convention (see API contract): when `item` is provided it
 * is wrapped as `[item]`, JSON-serialized, and the JSON Content-Type header is set. Optional `meta` is
 * serialized into the X-MWMSC-Request-Meta header via constructMeta (omitted when empty/oversized).
 *
 * @param method the HTTP method
 * @param item the single body item to send, or undefined for a body-less request
 * @param meta optional request-meta object for the X-MWMSC-Request-Meta header
 * @returns the assembled fetch init
 */
function jsonInit(method: string, item?: unknown, meta?: object | null): RequestInit {
    const headers: Record<string, string> = { ...constructMeta(meta) }
    const init: RequestInit = { method, headers }
    if (item !== undefined) {
        headers["Content-Type"] = "application/json"
        init.body = JSON.stringify([item])
    }
    return init
}

/**
 * Issues a request and returns the interpreted response payload (or null).
 *
 * @param url the request URL
 * @param init the fetch init
 * @param null_request_header if the body is empty, the header to read the value from (see parser)
 * @returns the interpreted payload
 */
async function requestPayload(url: string, init: RequestInit, null_request_header?: string): Promise<any> {
    const response = await fetch(url, init)
    return interpretPayload(await parser(response, null_request_header))
}

/**
 * Issues a request that must not return a payload (the write/PUT/PATCH/DELETE convention), throwing if
 * the server unexpectedly returns one.
 *
 * @param operation the operation name, used in the mismatch error message
 * @param url the request URL
 * @param init the fetch init
 * @param null_request_header if the body is empty, the header to read the value from (see parser)
 */
async function requestVoid(
    operation: string,
    url: string,
    init: RequestInit,
    null_request_header?: string
): Promise<void> {
    const payload_data = await requestPayload(url, init, null_request_header)
    if (payload_data !== null) {
        throw new Error(`Unexpected response payload for ${operation} operation: ${JSON.stringify(payload_data)}`)
    }
}

// API REQUEST FUNCTIONS

// API definition
export enum APIOpCode {
    CREATE,
    READ,
    UPDATE,
    UPDATE_PARTIAL,
    DELETE,
    LIST
}

/**
 * GET /api/v1/composers
 *
 * @param full if true, returns full composer records; if false or not provided, returns only composer IDs
 * @returns a list of composer IDs, a list of Composer objects, or undefined
 */
export async function listComposer(full?: boolean): Promise<any | null> {
    return requestPayload(composeUrl("composers"), jsonInit("GET", undefined, { full: full }))
}

/**
 * GET /api/v1/composers/{id}
 *
 * @param id the composer ID to retrieve
 * @return the Composer object corresponding to the provided ID, or null if not found
 */
export async function getComposer(id: number): Promise<Composer | null> {
    return requestPayload(composeUrl("composers", id.toString()), jsonInit("GET"))
}

/**
 * POST /api/v1/composers
 *
 * @param data the composer data to create
 * @return the ID of the created composer
 */
export async function createComposer(data: Composer): Promise<number> {
    const payload_data = await requestPayload(composeUrl("composers"), jsonInit("POST", data), "Location")
    const id = stripAPILocation(payload_data as string)
    if (id !== null) {
        return id
    }
    throw new Error(`Unexpected response format: ${JSON.stringify(payload_data)}`)
}

/**
 * PUT /api/v1/composers/{id}
 *
 * @param id the composer ID to update
 * @param data the composer representation
 * @return
 */
export async function replaceComposer(id: number, data: Composer): Promise<void> {
    return requestVoid("update", composeUrl("composers", id.toString()), jsonInit("PUT", data))
}

/**
 * PATCH /api/v1/composers/{id}
 *
 * @param id the composer ID to update
 * @param data the composer data to update
 * @return
 */
export async function updateComposer(id: number, data: Partial<Composer>): Promise<void> {
    return requestVoid("update", composeUrl("composers", id.toString()), jsonInit("PATCH", data))
}

/**
 * DELETE /api/v1/composers/{id}
 *
 * @param id the composer ID to delete
 * @return
 */
export async function deleteComposer(id: number): Promise<void> {
    return requestVoid("delete", composeUrl("composers", id.toString()), jsonInit("DELETE"))
}

/**
 * Type guard distinguishing the enhanced composition response from a plain Composition API object.
 *
 * When the `names` flag is passed to getWork/listWork, the server resolves the composition's referenced
 * composer and contributor names and returns a CompositionWithNames ({ object, names }) instead of a bare Composition.
 * Consumers call this to branch on which shape they received before reading the data.
 *
 * @param value the value to test
 * @returns true if the value is a CompositionWithNames (carrying resolved names)
 */
export function isCompositionWithNames(
    value: Composition | CompositionWithNames | null | undefined
): value is CompositionWithNames {
    return value !== null && typeof value === "object" && "object" in value && "names" in value
}

/**
 * GET /api/v1/works
 *
 * @param full if true, returns full composition records; if false or not provided, returns only work IDs
 * @param names if true (only honored when full is true), each record is returned as a
 *   CompositionWithNames object ({ object, names }) with the referenced composer and contributor names resolved
 * @returns a list of work IDs, a list of
 *   Composition objects, a list of CompositionWithNames objects (when names is set), or undefined
 */
export async function listWork(full?: boolean, names?: boolean): Promise<any | null> {
    return requestPayload(composeUrl("works"), jsonInit("GET", undefined, { full: full, names: names }))
}

/**
 * GET /api/v1/works/{id}
 *
 * By default the plain Composition object is returned. When `names` is set, the server resolves the
 * referenced composer and contributor names and returns a CompositionWithNames ({ object, names }); use
 * isCompositionWithNames to discriminate the result.
 *
 * @param id the work ID to retrieve
 * @param names if true, returns a CompositionWithNames object with resolved composer and contributor names
 * @return the composition for the provided ID (plain or
 *   name-enhanced depending on the names flag), or null if not found
 */
export async function getWork(id: number, names?: boolean): Promise<Composition | CompositionWithNames | null> {
    return requestPayload(composeUrl("works", id.toString()), jsonInit("GET", undefined, { names: names }))
}

/**
 * POST /api/v1/works
 *
 * @param data the work data to create
 * @return the ID of the created work
 */
export async function createWork(data: Composition): Promise<number> {
    const payload_data = await requestPayload(composeUrl("works"), jsonInit("POST", data), "Location")
    // the works endpoint may return the new ID directly in the payload
    if (typeof payload_data === "number") {
        return payload_data
    }
    const id = stripAPILocation(String(payload_data))
    if (id !== null) {
        return id
    }
    throw new Error(`Unexpected response format: ${JSON.stringify(payload_data)}`)
}

/**
 * PUT /api/v1/works/{id}
 *
 * @param id the work ID to update
 * @param data the work representation
 * @param elevate optional; if true, allows consideration of admin status when reviewing contributor lockout
 * @param direct optional; if true, signals direct contributor management so the editor is not auto-added to contrib_addl
 * @return
 */
export async function replaceWork(id: number, data: Composition, elevate?: boolean, direct?: boolean): Promise<void> {
    return requestVoid(
        "update",
        composeUrl("works", id.toString()),
        jsonInit("PUT", data, { elevate: elevate, direct_contrib: direct })
    )
}

/**
 * PATCH /api/v1/works/{id}
 *
 * @param id the work ID to update
 * @param data the work data to update
 * @param elevate optional; if true, allows consideration of admin status when reviewing contributor lockout
 * @param direct optional; if true, signals direct contributor management so the editor is not auto-added to contrib_addl
 * @return
 */
export async function updateWork(
    id: number,
    data: Partial<Composition>,
    elevate?: boolean,
    direct?: boolean
): Promise<void> {
    return requestVoid(
        "update",
        composeUrl("works", id.toString()),
        jsonInit("PATCH", data, { elevate: elevate, direct_contrib: direct })
    )
}

/**
 * DELETE /api/v1/works/{id}
 *
 * @param id the work ID to delete
 * @param elevate optional; if true, allows consideration of admin status when reviewing contributor lockout
 * @return
 */
export async function deleteWork(id: number, elevate?: boolean): Promise<void> {
    return requestVoid(
        "delete",
        composeUrl("works", id.toString()),
        jsonInit("DELETE", undefined, { elevate: elevate })
    )
}

/**
 * GET /api/v1/contributors
 *
 * @param full if true, returns full contributor records; if false or not provided, returns only contributor IDs
 * @returns a list of contributor IDs, a list of Contributor objects, or undefined
 */
export async function listContributor(full?: boolean): Promise<any | null> {
    return requestPayload(composeUrl("contributors"), jsonInit("GET", undefined, { full: full }))
}

/**
 * GET /api/v1/contributors/{id}
 *
 * @param id the contributor ID to retrieve
 * @param elevate optional; if true and the user is an admin, disables the safe property check for non-self contributors
 * @return the Contributor object corresponding to the provided ID, or null if not found
 */
export async function getContributor(id: number, elevate?: boolean): Promise<Contributor | null> {
    return requestPayload(composeUrl("contributors", id.toString()), jsonInit("GET", undefined, { elevate: elevate }))
}

/**
 * POST /api/v1/contributors
 *
 * @param data the contributor data to create
 * @return the ID of the created contributor
 */
export async function createContributor(data: Contributor): Promise<number> {
    const payload_data = await requestPayload(composeUrl("contributors"), jsonInit("POST", data), "Location")
    const id = stripAPILocation(String(payload_data))
    if (id !== null) {
        return id
    }
    throw new Error(`Unexpected response format: ${JSON.stringify(payload_data)}`)
}

/**
 * PUT /api/v1/contributors/{id}
 *
 * @param id the contributor ID to update
 * @param data the contributor representation
 * @return
 */
export async function replaceContributor(id: number, data: Contributor): Promise<void> {
    return requestVoid("update", composeUrl("contributors", id.toString()), jsonInit("PUT", data))
}

/**
 * PATCH /api/v1/contributors/{id}
 *
 * @param id the contributor ID to update
 * @param data the contributor data to update
 * @param elevate optional; if true and the user is an admin, disables the safe property check and row-level security for this request
 * @return
 */
export async function updateContributor(id: number, data: Partial<Contributor>, elevate?: boolean): Promise<void> {
    return requestVoid(
        "update",
        composeUrl("contributors", id.toString()),
        jsonInit("PATCH", data, { elevate: elevate })
    )
}

/**
 * DELETE /api/v1/contributors/{id}
 *
 * @param id the contributor ID to delete
 * @return
 */
export async function deleteContributor(id: number): Promise<void> {
    return requestVoid("delete", composeUrl("contributors", id.toString()), jsonInit("DELETE"))
}

/**
 * POST /api/v1/search
 *
 * Runs a ranked keyword search over the entity tables.
 *
 * @param keyword the keyword query
 * @param database the table to search, or null/omitted to search all three
 * @returns ranked hits as { database, id, name }, or null
 */
export async function searchDatabase(
    keyword: string,
    database?: SearchDatabase | null
): Promise<SearchResult[] | null> {
    return requestPayload(composeUrl("search"), jsonInit("POST", { keyword, database: database ?? null }))
}

/**
 * Builds the API URL that serves a file's bytes
 *
 * This is the value stored in a record's image field (so the admin UI can load the image through the
 * authenticated files API).
 *
 * @param key the file key
 * @returns the file's API address, e.g. /api/v1/files/hero.webp
 */
export function fileApiUrl(key: string): string {
    return composeUrl("files", key)
}

/**
 * GET /api/v1/files
 *
 * @param full if true, returns full FileMeta records; if false or not provided, returns only file keys
 * @returns a list of file keys, a list of FileMeta objects, or null
 */
export async function listFiles(full?: boolean): Promise<string[] | FileMeta[] | null> {
    return requestPayload(composeUrl("files"), jsonInit("GET", undefined, { full: full }))
}

/**
 * Appends an optional crop selection to a file upload's form body as the crop_* fields the API expects
 * (see parseCropFromForm in lib/api/images.ts). A null/undefined crop is omitted, so the server applies
 * its default centered portrait crop.
 *
 * @param body the FormData being assembled for the upload
 * @param crop the normalized crop selection (aspect plus a 0..1 region), or null/undefined to omit
 */
function appendCrop(body: FormData, crop?: CropSelection | null): void {
    if (!crop) {
        return
    }
    body.append("crop_aspect", crop.aspect)
    body.append("crop_x", String(crop.x))
    body.append("crop_y", String(crop.y))
    body.append("crop_w", String(crop.w))
    body.append("crop_h", String(crop.h))
}

/**
 * POST /api/v1/files
 * Uploads a new file (multipart/form-data), returning the stored key
 *
 * @param file the file to upload
 * @param [name] an optional name to derive the key from; defaults to the file's own name
 * @param [crop] an optional crop selection; images are cropped to a canonical shape (default centered portrait)
 * @return the stored file key
 */
export async function uploadFile(file: File, name?: string, crop?: CropSelection | null): Promise<string> {
    const body = new FormData()
    body.append("file", file)
    if (name) {
        body.append("name", name)
    }
    appendCrop(body, crop)
    const payload = await requestPayload(composeUrl("files"), { method: "POST", body: body }, "Location")
    // the 201 body carries the stored FileMeta (with its key); fall back to the Location header
    if (payload && typeof payload === "object" && typeof (payload as FileMeta).key === "string") {
        return (payload as FileMeta).key
    }
    const key = String(payload).split("/").pop()
    if (key) {
        return key
    }
    throw new Error(`Unexpected response format: ${JSON.stringify(payload)}`)
}

/**
 * PUT /api/v1/files/{key}
 * Replaces an existing file's bytes (multipart/form-data)
 *
 * @param key the file key to replace
 * @param file the replacement file
 * @param [crop] an optional crop selection; images are cropped to a canonical shape (default centered portrait)
 * @return
 */
export async function replaceFile(key: string, file: File, crop?: CropSelection | null): Promise<void> {
    const body = new FormData()
    body.append("file", file)
    appendCrop(body, crop)
    return requestVoid("file replace", composeUrl("files", key), { method: "PUT", body: body })
}

/**
 * DELETE /api/v1/files/{key}
 *
 * @param key the file key to delete
 * @return
 */
export async function deleteFile(key: string): Promise<void> {
    return requestVoid("file delete", composeUrl("files", key), jsonInit("DELETE"))
}

/**
 * GET /api/v1/identity
 *
 * @returns list of user emails or undefined
 */
export async function listIdentity(): Promise<string[] | null> {
    return requestPayload(composeUrl("identity"), jsonInit("GET"))
}

/**
 * POST /api/v1/identity
 *
 * @param email the email to add
 * @param autoenrollment whether to automatically create a Contributor record with the following parameters (if true, the following parameters are required)
 * @param confer whether to grant the conferrable roles of the creating identity
 * @param name the name to set on autoenrollment
 * @param major the major to set on autoenrollment, or null to omit
 * @param class_year the class year to set on autoenrollment, or null to omit
 */
export async function addIdentity(
    email: string,
    autoenrollment?: boolean,
    confer?: boolean,
    name?: string,
    major?: string | null,
    class_year?: number | null
): Promise<void> {
    return requestVoid(
        "addIdentity",
        composeUrl("identity"),
        jsonInit("POST", email, {
            autoenrollment: autoenrollment,
            confer: confer,
            name: name,
            major: major,
            class_year: class_year
        })
    )
}

/**
 * PATCH /api/v1/identity
 *
 * @param operations the identity-centric operations object (see server docs)
 */
export async function updateIdentity(operations: object): Promise<void> {
    return requestVoid("updateIdentity", composeUrl("identity"), jsonInit("PATCH", operations))
}

/**
 * PUT /api/v1/identity/activation
 *
 * @param emails the identity emails of the accounts to activate
 */
export async function activateIdentity(emails: string[]): Promise<void> {
    return requestVoid("activateIdentity", composeUrl("identity", "activation"), jsonInit("PUT", { emails: emails }))
}

/**
 * DELETE /api/v1/identity/activation
 *
 * @param emails the identity emails of the accounts to deactivate
 */
export async function deactivateIdentity(emails: string[]): Promise<void> {
    return requestVoid(
        "deactivateIdentity",
        composeUrl("identity", "activation"),
        jsonInit("DELETE", { emails: emails })
    )
}

/**
 * PUT /api/v1/identity/admin
 *
 * @param emails the identity emails of the accounts to elevate to administrator
 */
export async function elevateIdentity(emails: string[]): Promise<void> {
    return requestVoid("elevateIdentity", composeUrl("identity", "admin"), jsonInit("PUT", { emails: emails }))
}

/**
 * DELETE /api/v1/identity/admin
 *
 * @param emails the identity emails of the accounts to demote from administrator
 */
export async function demoteIdentity(emails: string[]): Promise<void> {
    return requestVoid("demoteIdentity", composeUrl("identity", "admin"), jsonInit("DELETE", { emails: emails }))
}

/**
 * PATCH /api/v1/identity/roles
 * Incrementally adds and/or removes roles for the provided users.
 *
 * @param operations the add/remove operations object, of the shape
 *  { add?: { [email: string]: string[] }, remove?: { [email: string]: string[] } }
 */
export async function updateRoles(operations: {
    add?: Record<string, string[]>
    remove?: Record<string, string[]>
}): Promise<void> {
    return requestVoid("updateRoles", composeUrl("identity", "roles"), jsonInit("PATCH", operations))
}

/**
 * PUT /api/v1/identity/roles
 * Replaces the entire role set for the provided users (set semantics).
 *
 * @param role_map a map of identity email to the complete list of roles the user should have
 */
export async function setRolesIdentity(role_map: Record<string, string[]>): Promise<void> {
    return requestVoid("setRolesIdentity", composeUrl("identity", "roles"), jsonInit("PUT", { set: role_map }))
}

/**
 * PATCH /api/v1/identity/email
 * Changes the login (identity) email of other users, keyed by their current email.
 *
 * @param email_map a map of each user's current email to their new email
 */
export async function changeIdentityEmail(email_map: Record<string, string>): Promise<void> {
    return requestVoid("changeIdentityEmail", composeUrl("identity", "email"), jsonInit("PATCH", email_map))
}

/**
 * DELETE /api/v1/identity
 *
 * @param email the email to remove
 * @param autodeactivation whether to automatically deactivate the associated Contributor record
 */
export async function deleteIdentity(email: string, autodeactivation?: boolean): Promise<void> {
    return requestVoid(
        "deleteIdentity",
        composeUrl("identity"),
        jsonInit("DELETE", email, { autodeactivation: autodeactivation })
    )
}

/**
 * GET /api/v1/site
 *
 * @returns site/build info
 */
export async function getSite(): Promise<any | null> {
    return requestPayload(composeUrl("site"), jsonInit("GET"))
}

/**
 * POST /api/v1/site
 * Trigger rebuild
 */
export async function rebuildSite(): Promise<any | null> {
    return requestPayload(composeUrl("site"), { method: "POST" })
}

/**
 * DELETE /api/v1/site
 * Purge site cache
 */
export async function purgeSite(): Promise<any | null> {
    return requestPayload(composeUrl("site"), { method: "DELETE" })
}

/**
 * POST /api/v1/command
 * Execute one or more SQL commands on the server
 *
 * A single command yields a single D1Result; multiple commands yield an array of D1Results (one per
 * command, in order). When more than one command is supplied and `batch` is true (the default), the
 * server runs them as a single atomic transaction so any failure rolls back the whole set; passing
 * `batch` as false runs them sequentially as independent statements (no rollback).
 *
 * @param commands the SQL command string(s) to execute, in order
 * @param batch whether multiple commands should run as an atomic batch (default true)
 * @returns execution result (a single D1Result, or an array of D1Results for multiple commands)
 */
export async function executeCommand(commands: string[], batch: boolean = true): Promise<any> {
    // the body is the command list itself (not the single-item array convention), so it is serialized
    // directly rather than through jsonInit; the batch flag travels in the request-meta header
    const headers: Record<string, string> = { "Content-Type": "application/json", ...constructMeta({ batch }) }
    const init: RequestInit = { method: "POST", headers, body: JSON.stringify(commands) }
    return requestPayload(composeUrl("command"), init)
}

/**
 * GET /api/v1/identity/self
 * Returns information about the authenticated user's identity
 */
export async function getSelf(): Promise<Identity | null> {
    return requestPayload(composeUrl("identity/self"), jsonInit("GET"))
}

/**
 * PATCH /api/v1/identity/self
 * Change the authenticated user's own identity (sign-in) email
 *
 * The server changes the login email of the caller's own contributor record (and the underlying Access
 * policy); no special permissions are required, but the request only ever affects the caller themselves.
 *
 * @param new_email the new identity (sign-in) email to set
 */
export async function updateSelfLogin(new_email: string): Promise<void> {
    return requestVoid("updateSelfLogin", composeUrl("identity/self"), jsonInit("PATCH", new_email))
}

/**
 * POST /api/v1/identity/self
 * Perform self-enrollment with a partial Contributor record
 *
 * @param record required fields: name; major and class_year may be null or omitted
 */
export async function enrollSelf(record: Partial<Contributor>): Promise<void> {
    return requestVoid("enrollSelf", composeUrl("identity/self"), jsonInit("POST", record))
}

/**
 * DELETE /api/v1/identity/self
 * Deactivate the authenticated user's own contributor record (self-service)
 *
 * The server marks the caller's own record inactive (read-only access); the user keeps the ability to
 * sign in. No special permissions are required, but the request only ever affects the caller themselves.
 */
export async function deactivateSelf(): Promise<void> {
    return requestVoid("deactivateSelf", composeUrl("identity/self"), jsonInit("DELETE"))
}
