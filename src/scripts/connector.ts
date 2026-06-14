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

// API REQUEST GENERATION

/**
 * The API version for this connector file
 */
export const api_version = 1

/**
 * Internal function to generate endpoint
 * 
 * @param {string} noun the API object representation to access (ex. composers, contributors, etc.)
 * @param {string} subject the specific instance, if any, of the object to access
 * @returns {string} the generated API endpoint
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
 * @param {object | null | undefined} objects the object to be stringified and included in the header
 * @returns {string | undefined} the stringified object, or undefined if the input is not an object
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
 * @param {object | null | undefined} objects the object to be included in the header
 * @returns {Record<string, string>} an object containing the X-MWMSC-Request-Meta header if the meta value is valid, or an empty object if the meta value is undefined or exceeds length limits
 */
function constructMeta(objects: object | null | undefined): Record<string, string> {
    const meta_value = _constructMeta(objects)
    if (meta_value && meta_value.length > 512) {
        console.warn("Meta header value exceeds maximum length of 512 characters and will be omitted: ", meta_value)
        return {}
    }
    return (meta_value ? { "X-MWMSC-Request-Meta": meta_value } : {})
}

// API RESPONSE PROCESSING

/**
 * Converts a Location header into an ID number
 * 
 * The expected location format is "/api/v{ver}/{noun}/{id}"
 * 
 * @param {string} location the Location header value to parse
 * @return {number | null} the extracted ID as a number, or null if the format is invalid or the ID is not a valid number
 * 
 */
function stripAPILocation(location: string): number | null {
    const components = location.split("/")
    console.log(components)
    const validate = location.startsWith("/api/v") && components.length >= 4 && components[4] !== ""
    if (!validate) {
        console.warn(`Invalid Location header format: ${location}`)
        return null
    }
    const id_component = parseInt(components[4])
    if (isNaN(id_component)) {
        console.warn(`ID component of Location header is not a valid number: ${components[4]}`)
        return null
    }
    return id_component || null
}

/**
 * Internal function to parse API responses
 * 
 * @param {Response} response the response object returned by the fetch call
 * @param {string | undefined} null_request_header if the response body is null, attempt to fetch the content of the specified header and return as a string
 * @returns {object | string | undefined} the parsed response body, or the raw text if parsing fails, or undefined if the response body is empty
 */
async function parser(response: Response, null_request_header?: string): Promise<APIResponse | string | undefined> {
    console.log("Received response: ", response)
    const text = await response.text()
    if (!response.ok) {
        // attempt to surface the server's error comment instead of a generic failure message
        try {
            const error_data = JSON.parse(text)
            if (error_data && typeof error_data === "object" && typeof error_data.comment === "string" && error_data.comment !== "") {
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
    console.log("Raw response text: ", text)
    try {
        const data = JSON.parse(text)
        // successful responses (e.g. 201 Created) carry a JSON body whose payload may be null while the
        // requested value travels in a header (e.g. Location); substitute it so callers see the header value
        if (null_request_header && data && typeof data === "object" && data.success === true && (data.payload === null || data.payload === undefined)) {
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
 * @param {APIResponse | string | undefined} data_response the response body returned by the parser function
 * @returns {any | null} the interpreted payload, or null if the response indicates failure or if the payload is empty
 * @throws {Error} if the response indicates failure with an accompanying comment, or if the response format is unexpected
 */
function interpretPayload(data_response: APIResponse | string | undefined) {
    console.log(data_response)
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
 * @param {boolean} full if true, returns full composer records; if false or not provided, returns only composer IDs
 * @returns {number[] | Composer[] | undefined} a list of composer IDs, a list of Composer objects, or undefined
 */
export async function listComposer(full? : boolean): Promise<any | null> {
    const response = await fetch(composeUrl("composers"), {
        method: "GET",
        headers: {...constructMeta({ full: full }), 
            "Content-Type": "application/json"
        }
    })
    const data: string | APIResponse | undefined = await parser(response)
    return interpretPayload(data)
}

/**
 * GET /api/v1/composers/{id}
 * 
 * @param {number} id the composer ID to retrieve
 * @return {Composer | null} the Composer object corresponding to the provided ID, or null if not found
 */
export async function getComposer(id: number): Promise<Composer | null> {
    const response = await fetch(composeUrl("composers", id.toString()), {
        method: "GET"
    })
    console.log("Body: ", await response.clone().text())
    return interpretPayload(await parser(response))
}

/**
 * POST /api/v1/composers
 * 
 * @param {Composer} data the composer data to create
 * @return {number} the ID of the created composer
 */
export async function createComposer(data: Composer): Promise<number> {
    const response = await fetch(composeUrl("composers"), {
        "method": "POST",
        "body": JSON.stringify([data]),
        "headers": {
            "Content-Type": "application/json"
        }
    })
    const payload_data = interpretPayload(await parser(response, "Location"))
    const id = stripAPILocation(payload_data as string)
    if (id !== null) {
        return id
    }
    throw new Error(`Unexpected response format: ${JSON.stringify(payload_data)}`)
}

/**
 * PUT /api/v1/composers/{id}
 * 
 * @param {number} id the composer ID to update
 * @param {Composer} data the composer representation
 * @return {void}
 */
export async function replaceComposer(id: number, data: Composer): Promise<void> {
    const response = await fetch(composeUrl("composers", id.toString()), {
        "method": "PUT",
        "body": JSON.stringify([data]),
        "headers": {
            "Content-Type": "application/json"
        }
    })
    const payload_data = interpretPayload(await parser(response))
    if (payload_data !== null) {
        throw new Error(`Unexpected response payload for update operation: ${JSON.stringify(payload_data)}`)
    }
    return;
}

/**
 * PATCH /api/v1/composers/{id}
 * 
 * @param {number} id the composer ID to update
 * @param {Partial<Composer>} data the composer data to update
 * @return {void}
 */
export async function updateComposer(id: number, data: Partial<Composer>): Promise<void> {
    const response = await fetch(composeUrl("composers", id.toString()), {
        "method": "PATCH",
        "body": JSON.stringify([data]),
        "headers": {
            "Content-Type": "application/json"
        }
    })
    const payload_data = interpretPayload(await parser(response))
    if (payload_data !== null) {
        throw new Error(`Unexpected response payload for update operation: ${JSON.stringify(payload_data)}`)
    }
    return;
}

/**
 * DELETE /api/v1/composers/{id}
 * 
 * @param {number} id the composer ID to delete
 * @return {void}
 */
export async function deleteComposer(id: number): Promise<void> {
    const response = await fetch(composeUrl("composers", id.toString()), {
        "method": "DELETE"
    })
    const payload_data = interpretPayload(await parser(response))
    if (payload_data !== null) {
        throw new Error(`Unexpected response payload for delete operation: ${JSON.stringify(payload_data)}`)
    }
    return;
}

/**
 * Type guard distinguishing the enhanced composition response from a plain Composition API object.
 *
 * When the `names` flag is passed to getWork/listWork, the server resolves the composition's referenced
 * composer names and returns a CompositionWithNames ({ object, names }) instead of a bare Composition.
 * Consumers call this to branch on which shape they received before reading the data.
 *
 * @param {Composition | CompositionWithNames | null | undefined} value the value to test
 * @returns {boolean} true if the value is a CompositionWithNames (carrying resolved names)
 */
export function isCompositionWithNames(value: Composition | CompositionWithNames | null | undefined): value is CompositionWithNames {
    return value !== null && typeof value === "object" && "object" in value && "names" in value
}

/**
 * GET /api/v1/works
 *
 * @param {boolean} full if true, returns full composition records; if false or not provided, returns only work IDs
 * @param {boolean} names if true (only honored when full is true), each record is returned as a
 *   CompositionWithNames object ({ object, names }) with the referenced composer names resolved
 * @returns {number[] | Composition[] | CompositionWithNames[] | undefined} a list of work IDs, a list of
 *   Composition objects, a list of CompositionWithNames objects (when names is set), or undefined
 */
export async function listWork(full?: boolean, names?: boolean): Promise<any | null> {
    const response = await fetch(composeUrl("works"), {
        method: "GET",
        headers: {...constructMeta({ full: full, names: names }),
            "Content-Type": "application/json"
        }
    })
    const data: string | APIResponse | undefined = await parser(response)
    return interpretPayload(data)
}

/**
 * GET /api/v1/works/{id}
 *
 * By default the plain Composition object is returned. When `names` is set, the server resolves the
 * referenced composer names and returns a CompositionWithNames ({ object, names }); use
 * isCompositionWithNames to discriminate the result.
 *
 * @param {number} id the work ID to retrieve
 * @param {boolean} names if true, returns a CompositionWithNames object with resolved composer names
 * @return {Composition | CompositionWithNames | null} the composition for the provided ID (plain or
 *   name-enhanced depending on the names flag), or null if not found
 */
export async function getWork(id: number, names?: boolean): Promise<Composition | CompositionWithNames | null> {
    const response = await fetch(composeUrl("works", id.toString()), {
        method: "GET",
        headers: constructMeta({ names: names })
    })
    return interpretPayload(await parser(response))
}

/**
 * POST /api/v1/works
 *
 * @param {Composition} data the work data to create
 * @return {number} the ID of the created work
 */
export async function createWork(data: Composition): Promise<number> {
    const response = await fetch(composeUrl("works"), {
        "method": "POST",
        "body": JSON.stringify([data]),
        "headers": {
            "Content-Type": "application/json"
        }
    })
    const payload_data = interpretPayload(await parser(response, "Location"))
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
 * @param {number} id the work ID to update
 * @param {Composition} data the work representation
 * @param {boolean} elevate optional; if true, allows consideration of admin status when reviewing contributor lockout
 * @param {boolean} direct optional; if true, signals direct contributor management so the editor is not auto-added to contrib_addl
 * @return {void}
 */
export async function replaceWork(id: number, data: Composition, elevate?: boolean, direct?: boolean): Promise<void> {
    const response = await fetch(composeUrl("works", id.toString()), {
        "method": "PUT",
        "body": JSON.stringify([data]),
        "headers": {...constructMeta({ elevate: elevate, direct_contrib: direct }),
            "Content-Type": "application/json"
        }
    })
    const payload_data = interpretPayload(await parser(response))
    if (payload_data !== null) {
        throw new Error(`Unexpected response payload for update operation: ${JSON.stringify(payload_data)}`)
    }
    return;
}

/**
 * PATCH /api/v1/works/{id}
 *
 * @param {number} id the work ID to update
 * @param {Partial<Composition>} data the work data to update
 * @param {boolean} elevate optional; if true, allows consideration of admin status when reviewing contributor lockout
 * @param {boolean} direct optional; if true, signals direct contributor management so the editor is not auto-added to contrib_addl
 * @return {void}
 */
export async function updateWork(id: number, data: Partial<Composition>, elevate?: boolean, direct?: boolean): Promise<void> {
    const response = await fetch(composeUrl("works", id.toString()), {
        "method": "PATCH",
        "body": JSON.stringify([data]),
        "headers": {...constructMeta({ elevate: elevate, direct_contrib: direct }),
            "Content-Type": "application/json"
        }
    })
    const payload_data = interpretPayload(await parser(response))
    if (payload_data !== null) {
        throw new Error(`Unexpected response payload for update operation: ${JSON.stringify(payload_data)}`)
    }
    return;
}

/**
 * DELETE /api/v1/works/{id}
 *
 * @param {number} id the work ID to delete
 * @param {boolean} elevate optional; if true, allows consideration of admin status when reviewing contributor lockout
 * @return {void}
 */
export async function deleteWork(id: number, elevate?: boolean): Promise<void> {
    const response = await fetch(composeUrl("works", id.toString()), {
        "method": "DELETE",
        "headers": constructMeta({ elevate: elevate })
    })
    const payload_data = interpretPayload(await parser(response))
    if (payload_data !== null) {
        throw new Error(`Unexpected response payload for delete operation: ${JSON.stringify(payload_data)}`)
    }
    return;
}

/**
 * GET /api/v1/contributors
 *
 * @param {boolean} full if true, returns full contributor records; if false or not provided, returns only contributor IDs
 * @returns {number[] | Contributor[] | undefined} a list of contributor IDs, a list of Contributor objects, or undefined
 */
export async function listContributor(full?: boolean): Promise<any | null> {
    const response = await fetch(composeUrl("contributors"), {
        method: "GET",
        headers: {...constructMeta({ full: full }),
            "Content-Type": "application/json"
        }
    })
    const data: string | APIResponse | undefined = await parser(response)
    return interpretPayload(data)
}

/**
 * GET /api/v1/contributors/{id}
 *
 * @param {number} id the contributor ID to retrieve
 * @param {boolean} elevate optional; if true and the user is an admin, disables the safe property check for non-self contributors
 * @return {Contributor | null} the Contributor object corresponding to the provided ID, or null if not found
 */
export async function getContributor(id: number, elevate?: boolean): Promise<Contributor | null> {
    const response = await fetch(composeUrl("contributors", id.toString()), {
        method: "GET",
        headers: constructMeta({ elevate: elevate })
    })
    return interpretPayload(await parser(response))
}

/**
 * POST /api/v1/contributors
 *
 * @param {Contributor} data the contributor data to create
 * @return {number} the ID of the created contributor
 */
export async function createContributor(data: Contributor): Promise<number> {
    const response = await fetch(composeUrl("contributors"), {
        "method": "POST",
        "body": JSON.stringify([data]),
        "headers": {
            "Content-Type": "application/json"
        }
    })
    const payload_data = interpretPayload(await parser(response, "Location"))
    const id = stripAPILocation(String(payload_data))
    if (id !== null) {
        return id
    }
    throw new Error(`Unexpected response format: ${JSON.stringify(payload_data)}`)
}

/**
 * PUT /api/v1/contributors/{id}
 *
 * @param {number} id the contributor ID to update
 * @param {Contributor} data the contributor representation
 * @return {void}
 */
export async function replaceContributor(id: number, data: Contributor): Promise<void> {
    const response = await fetch(composeUrl("contributors", id.toString()), {
        "method": "PUT",
        "body": JSON.stringify([data]),
        "headers": {
            "Content-Type": "application/json"
        }
    })
    const payload_data = interpretPayload(await parser(response))
    if (payload_data !== null) {
        throw new Error(`Unexpected response payload for update operation: ${JSON.stringify(payload_data)}`)
    }
    return;
}

/**
 * PATCH /api/v1/contributors/{id}
 *
 * @param {number} id the contributor ID to update
 * @param {Partial<Contributor>} data the contributor data to update
 * @param {boolean} elevate optional; if true and the user is an admin, disables the safe property check and row-level security for this request
 * @return {void}
 */
export async function updateContributor(id: number, data: Partial<Contributor>, elevate?: boolean): Promise<void> {
    const response = await fetch(composeUrl("contributors", id.toString()), {
        "method": "PATCH",
        "body": JSON.stringify([data]),
        "headers": {...constructMeta({ elevate: elevate }),
            "Content-Type": "application/json"
        }
    })
    const payload_data = interpretPayload(await parser(response))
    if (payload_data !== null) {
        throw new Error(`Unexpected response payload for update operation: ${JSON.stringify(payload_data)}`)
    }
    return;
}

/**
 * DELETE /api/v1/contributors/{id}
 *
 * @param {number} id the contributor ID to delete
 * @return {void}
 */
export async function deleteContributor(id: number): Promise<void> {
    const response = await fetch(composeUrl("contributors", id.toString()), {
        "method": "DELETE"
    })
    const payload_data = interpretPayload(await parser(response))
    if (payload_data !== null) {
        throw new Error(`Unexpected response payload for delete operation: ${JSON.stringify(payload_data)}`)
    }
    return;
}

/**
 * POST /api/v1/search
 *
 * Runs a ranked keyword search over the entity tables.
 *
 * @param {string} keyword the keyword query
 * @param {SearchDatabase | null} database the table to search, or null/omitted to search all three
 * @returns {SearchResult[] | null} ranked hits as { database, id, name }, or null
 */
export async function searchDatabase(keyword: string, database?: SearchDatabase | null): Promise<SearchResult[] | null> {
    const response = await fetch(composeUrl("search"), {
        method: "POST",
        body: JSON.stringify([{ keyword, database: database ?? null }]),
        headers: {
            "Content-Type": "application/json"
        }
    })
    return interpretPayload(await parser(response))
}

/**
 * GET /api/v1/identity
 *
 * @returns {string[] | undefined} list of user emails or undefined
 */
export async function listIdentity(): Promise<string[] | null> {
    const response = await fetch(composeUrl("identity"), {
        method: "GET"
    })
    const data: string | APIResponse | undefined = await parser(response)
    return interpretPayload(data)
}

/**
 * POST /api/v1/identity
 *
 * @param {string} email the email to add
 * @param {boolean} autoenrollment whether to automatically create a Contributor record with the following parameters (if true, the following parameters are required)
 * @param {boolean} confer whether to grant the conferrable roles of the creating identity
 * @param {string} name the name to set on autoenrollment
 * @param {string | null} major the major to set on autoenrollment, or null to omit
 * @param {number | null} class_year the class year to set on autoenrollment, or null to omit
 */
export async function addIdentity(email: string, autoenrollment?: boolean, confer?: boolean, name?: string, major?: string | null, class_year?: number | null): Promise<void> {
    const response = await fetch(composeUrl("identity"), {
        method: "POST",
        body: JSON.stringify([email]),
        headers: {...constructMeta({
            autoenrollment: autoenrollment,
            confer: confer,
            name: name,
            major: major,
            class_year: class_year
        }),
            "Content-Type": "application/json"
        }
    })
    const payload_data = interpretPayload(await parser(response))
    if (payload_data !== null) {
        throw new Error(`Unexpected response payload for addIdentity operation: ${JSON.stringify(payload_data)}`)
    }
    return
}

/**
 * PATCH /api/v1/identity
 *
 * @param {object} operations the identity-centric operations object (see server docs)
 */
export async function updateIdentity(operations: object): Promise<void> {
    const response = await fetch(composeUrl("identity"), {
        method: "PATCH",
        body: JSON.stringify([operations]),
        headers: {
            "Content-Type": "application/json"
        }
    })
    const payload_data = interpretPayload(await parser(response))
    if (payload_data !== null) {
        throw new Error(`Unexpected response payload for updateIdentity operation: ${JSON.stringify(payload_data)}`)
    }
    return
}

/**
 * DELETE /api/v1/identity
 *
 * @param {string} email the email to remove
 * @param {boolean} autodeactivation whether to automatically deactivate the associated Contributor record
 */
export async function deleteIdentity(email: string, autodeactivation?: boolean): Promise<void> {
    const response = await fetch(composeUrl("identity"), {
        method: "DELETE",
        body: JSON.stringify([email]),
        headers: {...constructMeta({ autodeactivation: autodeactivation }),
            "Content-Type": "application/json"
        }
    })
    const payload_data = interpretPayload(await parser(response))
    if (payload_data !== null) {
        throw new Error(`Unexpected response payload for deleteIdentity operation: ${JSON.stringify(payload_data)}`)
    }
    return
}

/**
 * GET /api/v1/site
 *
 * @returns {object | null} site/build info
 */
export async function getSite(): Promise<any | null> {
    const response = await fetch(composeUrl("site"), {
        method: "GET"
    })
    const data: string | APIResponse | undefined = await parser(response)
    return interpretPayload(data)
}

/**
 * POST /api/v1/site
 * Trigger rebuild
 */
export async function rebuildSite(): Promise<any | null> {
    const response = await fetch(composeUrl("site"), {
        method: "POST"
    })
    const data: string | APIResponse | undefined = await parser(response)
    return interpretPayload(data)
}

/**
 * DELETE /api/v1/site
 * Purge site cache
 */
export async function purgeSite(): Promise<any | null> {
    const response = await fetch(composeUrl("site"), {
        method: "DELETE"
    })
    const data: string | APIResponse | undefined = await parser(response)
    return interpretPayload(data)
}

/**
 * POST /api/v1/command
 * Execute SQL command on server
 *
 * @param {string} command the SQL string to execute
 * @returns {any} execution result
 */
export async function executeCommand(command: string): Promise<any> {
    const response = await fetch(composeUrl("command"), {
        method: "POST",
        body: JSON.stringify([command]),
        headers: {
            "Content-Type": "application/json"
        }
    })
    const data: string | APIResponse | undefined = await parser(response)
    return interpretPayload(data)
}

/**
 * GET /api/v1/identity/self
 * Returns information about the authenticated user's identity
 */
export async function getSelf(): Promise<Identity | null> {
    const response = await fetch(composeUrl("identity/self"), {
        method: "GET"
    })
    return interpretPayload(await parser(response))
}

/**
 * PATCH /api/v1/identity/self
 * Change the authenticated user's own identity (sign-in) email
 *
 * The server changes the login email of the caller's own contributor record (and the underlying Access
 * policy); no special permissions are required, but the request only ever affects the caller themselves.
 *
 * @param {string} new_email the new identity (sign-in) email to set
 */
export async function updateSelfLogin(new_email: string): Promise<void> {
    const response = await fetch(composeUrl("identity/self"), {
        method: "PATCH",
        body: JSON.stringify([new_email]),
        headers: {
            "Content-Type": "application/json"
        }
    })
    const payload_data = interpretPayload(await parser(response))
    if (payload_data !== null) {
        throw new Error(`Unexpected response payload for updateSelfLogin operation: ${JSON.stringify(payload_data)}`)
    }
    return
}

/**
 * POST /api/v1/identity/self
 * Perform self-enrollment with a partial Contributor record
 *
 * @param {Partial<Contributor>} record required fields: name; major and class_year may be null or omitted
 */
export async function enrollSelf(record: Partial<Contributor>): Promise<void> {
    const response = await fetch(composeUrl("identity/self"), {
        method: "POST",
        body: JSON.stringify([record]),
        headers: {
            "Content-Type": "application/json"
        }
    })
    const payload_data = interpretPayload(await parser(response))
    if (payload_data !== null) {
        throw new Error(`Unexpected response payload for enrollSelf operation: ${JSON.stringify(payload_data)}`)
    }
    return
}