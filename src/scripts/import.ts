/**
 * scripts/import.ts
 *
 * DOM wiring for the admin CSV bulk-import pages (composers, contributors, compositions). It reads an
 * uploaded CSV, delegates record building / name resolution / phase mapping / duplicate flagging to
 * import_build.ts, renders an editable/deletable preview grid so a file can be "cured" in-browser without
 * re-uploading, runs an authoritative server dry-run (meta dry_run), and commits the cured rows atomically
 * (meta bulk) via the existing bulk endpoints.
 *
 * There is no dedicated import endpoint — the ordinary bulk create endpoints are the single write path; the
 * server stays authoritative through per-record validation, the dry-run report, and the atomic transaction.
 *
 *
 * Copyright (C) 2026 Michael Wong.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
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

import { parseCsvWithHeader } from "../lib/api/csv"
import {
    type ImportType,
    type WorksContext,
    type BuildResult,
    type BuildIssue,
    MAX_IMPORT_ROWS,
    columnSpec,
    compositionKey,
    normalizeName,
    indexByName,
    buildRecord,
    flagCompositionDuplicates,
    flagNameDuplicates
} from "./import_build"
import {
    listComposer,
    listContributor,
    listWork,
    bulkDryRun,
    bulkCreate,
    type BulkDryRunReport
} from "./connector"

export type { ImportType }

/** One preview row: the editable raw CSV cells plus the DOM handles used to update its status in place. */
interface RowState {
    /** editable raw cell values keyed by CSV column name */
    cells: Record<string, string>
    /** the row's <tr> element */
    tr: HTMLTableRowElement
    /** the cell that renders this row's resolution issues */
    issueCell: HTMLTableCellElement
    /** the per-column editable inputs, so a specific field can be highlighted when it causes an issue */
    inputs: Record<string, HTMLInputElement>
}

/** Requires an element by id, throwing a clear error if the page markup is missing it. */
function requireElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id)
    if (element === null) {
        throw new Error(`Import page is missing required element #${id}`)
    }
    return element as T
}

/**
 * Wires up an admin CSV import page. The page must provide the import control markup (see the import.astro
 * pages); this attaches the load/validate/commit behavior and renders the editable preview grid.
 *
 * @param type the entity type being imported (composers | contributors | works)
 */
export function initImport(type: ImportType): void {
    const fileInput = requireElement<HTMLInputElement>("import-file")
    const loadButton = requireElement<HTMLButtonElement>("import-load")
    const errorBox = requireElement<HTMLParagraphElement>("import-error")
    const phaseMapBox = requireElement<HTMLDivElement>("import-phasemap")
    const summaryBox = requireElement<HTMLParagraphElement>("import-summary")
    const gridBox = requireElement<HTMLDivElement>("import-grid")
    const validateButton = requireElement<HTMLButtonElement>("import-validate")
    const commitButton = requireElement<HTMLButtonElement>("import-commit")
    const statusBox = requireElement<HTMLParagraphElement>("transaction-status")

    const { columns, allowExtra } = columnSpec(type)
    let rows: RowState[] = []
    // resolution context is only populated (and the phase-map UI shown) for compositions
    let ctx: WorksContext | null = null
    // normalized names already present in the DB for this entity, used to flag existing-name collisions in
    // the preview (composers/contributors only; compositions dedup on composer+name+part via ctx.existingKeys)
    let existingNames = new Set<string>()
    // a successful server dry-run gates commit; any edit invalidates it and re-disables the commit button
    let validated = false

    // Maps a server/client field token to the CSV grid column(s) it should highlight. Most tokens are the
    // column itself; these are the composition-only cases where the API/D1 field name differs from the CSV
    // column (composer_id → the "composer" name column; phases → the free-text period column; the nested
    // publication_info / rating objects fan out to their flattened D1 columns, which are the CSV columns).
    const fieldToColumns: Record<string, string[]> =
        type === "works"
            ? {
                  composer_id: ["composer"],
                  phases: ["contribution_period"],
                  publication_info: ["publish_name", "publish_location", "publish_year", "uri_type", "uri"],
                  rating: ["rating_suzuki", "rating_nyssma"]
              }
            : {}

    /** The set of tokens that, when seen in an issue message, map to a grid column (for highlighting). */
    const knownTokens = new Set<string>([...columns, ...Object.keys(fieldToColumns)])

    /** Resolves a single field token to the grid column(s) it corresponds to. */
    function columnsForToken(token: string): string[] {
        if (token in fieldToColumns) {
            return fieldToColumns[token]
        }
        return columns.includes(token) ? [token] : []
    }

    /** Either a plain server-reported message (BulkDryRunReport.rows[].issues) or a client BuildIssue. */
    type RowIssue = string | BuildIssue

    function issueMessage(issue: RowIssue): string {
        return typeof issue === "string" ? issue : issue.message
    }

    /**
     * Extracts the grid columns implicated by an issue message. Server dry-run issues are plain strings, so
     * they are matched by word: both the server and the client builders name fields by token (e.g.
     * "…parameter(s): name, type", "…invalid value for publish_year…"); any word matching a known
     * column/field token is mapped to its grid column(s) so the exact input can be highlighted. Unmatched
     * messages simply highlight the row without a specific box.
     */
    function columnsFromIssue(issue: string): string[] {
        const found = new Set<string>()
        for (const word of issue.match(/[A-Za-z_]+/g) ?? []) {
            if (knownTokens.has(word)) {
                for (const column of columnsForToken(word)) {
                    found.add(column)
                }
            }
        }
        return Array.from(found)
    }

    /**
     * Resolves the grid column(s) an issue implicates. Client BuildIssues that name their column directly
     * are trusted as-is — this is what fixes the pre-server column misalignment, since some client messages
     * share a generic noun (e.g. "composer") with a different column's own name and would otherwise
     * word-match the wrong one. Falls back to the word-matching heuristic for plain-string issues, which is
     * all the server dry-run report provides.
     */
    function columnsForIssue(issue: RowIssue): string[] {
        if (typeof issue !== "string" && issue.column !== undefined) {
            return [issue.column]
        }
        return columnsFromIssue(issueMessage(issue))
    }

    /** Renders a row's issues in place: updates its status cell, row highlight, and per-field input highlights. */
    function markRow(row: RowState, issues: RowIssue[]): void {
        for (const input of Object.values(row.inputs)) {
            input.classList.remove("import-input-error")
        }
        if (issues.length === 0) {
            row.issueCell.textContent = "ok"
            row.issueCell.className = "import-issue import-issue-ok"
            row.tr.classList.remove("import-row-error")
            return
        }
        row.issueCell.textContent = issues.map(issueMessage).join("; ")
        row.issueCell.className = "import-issue import-issue-error"
        row.tr.classList.add("import-row-error")
        const columnsToFlag = new Set<string>()
        for (const issue of issues) {
            for (const column of columnsForIssue(issue)) {
                columnsToFlag.add(column)
            }
        }
        for (const column of columnsToFlag) {
            row.inputs[column]?.classList.add("import-input-error")
        }
    }

    /** Builds every row's record and, for compositions, flags within-file/existing duplicates. */
    function buildAll(): BuildResult[] {
        const built = rows.map((row) => buildRecord(type, row.cells, ctx))
        if (type === "works" && ctx !== null) {
            flagCompositionDuplicates(built, ctx.existingKeys)
        } else if (type === "composers") {
            flagNameDuplicates(built, existingNames, "composer")
        } else if (type === "contributors") {
            flagNameDuplicates(built, existingNames, "contributor")
        }
        return built
    }

    /** Recomputes every row's issues, updates the summary, and gates the validate/commit buttons. */
    function recompute(): void {
        const built = buildAll()
        let clean = 0
        built.forEach((result, index) => {
            const row = rows[index]
            if (result.issues.length === 0) {
                clean++
            }
            markRow(row, result.issues)
        })

        const hasIssues = clean !== rows.length
        summaryBox.textContent =
            rows.length === 0
                ? "No rows loaded."
                : `${rows.length} row(s); ${clean} ready, ${rows.length - clean} with issue(s).`
        // the dry-run is invalidated whenever the data changes; commit stays disabled until it passes again
        validated = false
        commitButton.disabled = true
        validateButton.disabled = rows.length === 0 || hasIssues
    }

    /** The current cured records to submit (rebuilt from live cell state at submit time). */
    function currentRecords(): Record<string, unknown>[] {
        return buildAll().map((result) => result.record)
    }

    /** Removes a row from the model and the DOM, then recomputes (dup counts depend on the whole set). */
    function deleteRow(row: RowState): void {
        rows = rows.filter((candidate) => candidate !== row)
        row.tr.remove()
        recompute()
    }

    /** Rebuilds the phase-map controls from the distinct non-blank contribution periods across all rows. */
    function renderPhaseMap(): void {
        if (type !== "works" || ctx === null) {
            return
        }
        const periods = new Set<string>()
        for (const row of rows) {
            const period = row.cells.contribution_period.trim()
            if (period !== "") {
                periods.add(period)
            }
        }
        // drop mappings for periods no longer present so stale entries do not linger
        for (const existing of Array.from(ctx.phaseMap.keys())) {
            if (!periods.has(existing)) {
                ctx.phaseMap.delete(existing)
            }
        }
        phaseMapBox.replaceChildren()
        if (periods.size === 0) {
            return
        }
        const heading = document.createElement("h3")
        heading.textContent = "Map contribution periods to phases"
        phaseMapBox.appendChild(heading)
        const help = document.createElement("p")
        help.className = "general-infohelp"
        help.textContent =
            'Enter the phase number(s) for each contribution period below (separate multiple with a comma, e.g. "1, 2").'
        phaseMapBox.appendChild(help)
        for (const period of Array.from(periods).sort()) {
            const label = document.createElement("label")
            label.className = "import-phasemap-row"
            const caption = document.createElement("span")
            caption.textContent = period
            const input = document.createElement("input")
            input.type = "text"
            input.value = ctx.phaseMap.get(period) ?? ""
            input.placeholder = "phase number(s)"
            input.addEventListener("input", () => {
                ctx!.phaseMap.set(period, input.value)
                recompute()
            })
            label.appendChild(caption)
            label.appendChild(input)
            phaseMapBox.appendChild(label)
        }
    }

    /** Renders the editable preview grid (one text input per column, a per-row delete, and an issue cell). */
    function renderGrid(): void {
        gridBox.replaceChildren()
        if (rows.length === 0) {
            return
        }
        const table = document.createElement("table")
        table.className = "import-grid-table"
        const thead = document.createElement("thead")
        const headRow = document.createElement("tr")
        for (const column of columns) {
            const th = document.createElement("th")
            th.textContent = column
            headRow.appendChild(th)
        }
        const statusTh = document.createElement("th")
        statusTh.textContent = "status"
        headRow.appendChild(statusTh)
        const actionTh = document.createElement("th")
        actionTh.textContent = ""
        headRow.appendChild(actionTh)
        thead.appendChild(headRow)
        table.appendChild(thead)

        const tbody = document.createElement("tbody")
        for (const row of rows) {
            row.inputs = {}
            for (const column of columns) {
                const td = document.createElement("td")
                const input = document.createElement("input")
                input.type = "text"
                input.value = row.cells[column] ?? ""
                input.addEventListener("input", () => {
                    row.cells[column] = input.value
                    // editing a period may introduce/remove a distinct period, so refresh the phase-map UI
                    if (type === "works" && column === "contribution_period") {
                        renderPhaseMap()
                    }
                    recompute()
                })
                row.inputs[column] = input
                td.appendChild(input)
                row.tr.appendChild(td)
            }
            row.tr.appendChild(row.issueCell)
            const actionCell = document.createElement("td")
            const removeButton = document.createElement("button")
            removeButton.type = "button"
            removeButton.textContent = "Delete"
            removeButton.addEventListener("click", () => deleteRow(row))
            actionCell.appendChild(removeButton)
            row.tr.appendChild(actionCell)
            tbody.appendChild(row.tr)
        }
        table.appendChild(tbody)
        gridBox.appendChild(table)
    }

    /** Fetches the composer/contributor/existing-work data needed to resolve composition references. */
    async function loadWorksContext(): Promise<WorksContext> {
        const [composers, contributors, works] = await Promise.all([
            listComposer(true) as Promise<NamedRecordLike[] | null>,
            listContributor(true) as Promise<NamedRecordLike[] | null>,
            listWork(true) as Promise<Array<{ composer_id: number; name: string; part: string | null }> | null>
        ])
        const composerIndex = indexByName((composers ?? []).map((record) => ({ id: record.id, name: record.name })))
        const contributorIndex = indexByName(
            (contributors ?? []).map((record) => ({ id: record.id, name: record.name }))
        )
        const existingKeys = new Set<string>()
        for (const work of works ?? []) {
            existingKeys.add(compositionKey(work.composer_id, work.name, work.part))
        }
        return {
            composerByName: composerIndex.byName,
            contributorByName: contributorIndex.byName,
            composerNames: composerIndex.names,
            contributorNames: contributorIndex.names,
            existingKeys,
            phaseMap: new Map<string, string>()
        }
    }

    /** Parses the selected file, builds the preview, and (for compositions) fetches resolution data. */
    async function loadFile(): Promise<void> {
        errorBox.textContent = ""
        statusBox.textContent = ""
        const file = fileInput.files?.[0]
        if (file === undefined) {
            errorBox.textContent = "Choose a .csv file first."
            return
        }
        loadButton.disabled = true
        try {
            const text = await file.text()
            const records = parseCsvWithHeader(text, columns, allowExtra)
            if (records.length === 0) {
                errorBox.textContent = "The file has a header but no data rows."
                return
            }
            if (records.length > MAX_IMPORT_ROWS) {
                errorBox.textContent = `The file has ${records.length} rows; at most ${MAX_IMPORT_ROWS} may be imported at once.`
                return
            }
            if (type === "works") {
                ctx = await loadWorksContext()
            } else {
                // composers/contributors: load existing names so preview can flag existing-name collisions
                const list = (await (type === "composers" ? listComposer(true) : listContributor(true))) as
                    | NamedRecordLike[]
                    | null
                existingNames = new Set<string>((list ?? []).map((record) => normalizeName(record.name)))
            }
            rows = records.map((record) => {
                // seed editable cells for exactly the known columns (ignore any tolerated extras)
                const cells: Record<string, string> = {}
                for (const column of columns) {
                    cells[column] = record[column] ?? ""
                }
                const issueCell = document.createElement("td")
                return { cells, tr: document.createElement("tr"), issueCell, inputs: {} }
            })
            renderPhaseMap()
            renderGrid()
            recompute()
        } catch (error) {
            errorBox.textContent = error instanceof Error ? error.message : "Failed to read the file."
        } finally {
            loadButton.disabled = false
        }
    }

    /** Runs the authoritative server dry-run and renders its per-row report; passing enables commit. */
    async function validate(): Promise<void> {
        statusBox.textContent = "Validating with the server…"
        validateButton.disabled = true
        try {
            const report: BulkDryRunReport = await bulkDryRun(type, currentRecords())
            if (report.ok) {
                validated = true
                commitButton.disabled = false
                // clear any stale highlights from a previous failed validation
                for (const row of rows) {
                    markRow(row, [])
                }
                statusBox.textContent = `Server validation passed for all ${report.count} row(s). You may now import.`
            } else {
                validated = false
                commitButton.disabled = true
                // push each row's server issues onto that row (status cell + row/field highlight) instead of
                // dumping them all at the bottom, then point the admin at the first affected row
                let firstFailing: RowState | null = null
                for (const entry of report.rows) {
                    const row = rows[entry.index]
                    if (row === undefined) {
                        continue
                    }
                    markRow(row, entry.issues)
                    if (!entry.ok && firstFailing === null) {
                        firstFailing = row
                    }
                }
                const failedCount = report.rows.filter((entry) => !entry.ok).length
                statusBox.textContent = `Server validation found issues in ${failedCount} of ${report.count} row(s); see the highlighted rows below.`
                firstFailing?.tr.scrollIntoView({ behavior: "smooth", block: "center" })
            }
        } catch (error) {
            validated = false
            commitButton.disabled = true
            statusBox.textContent =
                error instanceof Error ? `Validation failed: ${error.message}` : "Validation failed."
        } finally {
            validateButton.disabled = rows.length === 0
        }
    }

    /** Commits the cured rows atomically and reports the assigned ids; re-enables editing on failure. */
    async function commit(): Promise<void> {
        if (!validated) {
            statusBox.textContent = "Run server validation before importing."
            return
        }
        commitButton.disabled = true
        statusBox.textContent = "Importing…"
        try {
            const ids = await bulkCreate(type, currentRecords())
            statusBox.textContent = `Imported ${ids.length} record(s). Assigned id(s): ${ids.join(", ")}.`
            // the write succeeded and consumed the file; clear the grid so the rows cannot be submitted twice
            rows = []
            ctx = null
            existingNames = new Set<string>()
            validated = false
            fileInput.value = ""
            phaseMapBox.replaceChildren()
            gridBox.replaceChildren()
            summaryBox.textContent = ""
            validateButton.disabled = true
        } catch (error) {
            // the transaction rolled back; let the admin fix and retry (re-validation required)
            statusBox.textContent = error instanceof Error ? `Import failed: ${error.message}` : "Import failed."
            validated = false
            commitButton.disabled = true
            validateButton.disabled = rows.length === 0
        }
    }

    loadButton.addEventListener("click", () => void loadFile())
    validateButton.addEventListener("click", () => void validate())
    commitButton.addEventListener("click", () => void commit())
    validateButton.disabled = true
    commitButton.disabled = true
}

/** The shape of a record returned by the list endpoints that carries an id and a name. */
interface NamedRecordLike {
    id: number
    name: string
}
