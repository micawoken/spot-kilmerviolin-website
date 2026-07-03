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

import { parseCsvWithHeader } from "../lib/api/csv"
import {
    type ImportType,
    type WorksContext,
    type BuildResult,
    MAX_IMPORT_ROWS,
    columnSpec,
    compositionKey,
    indexByName,
    buildRecord,
    flagCompositionDuplicates
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
    // a successful server dry-run gates commit; any edit invalidates it and re-disables the commit button
    let validated = false

    /** Builds every row's record and, for compositions, flags within-file/existing duplicates. */
    function buildAll(): BuildResult[] {
        const built = rows.map((row) => buildRecord(type, row.cells, ctx))
        if (type === "works" && ctx !== null) {
            flagCompositionDuplicates(built, ctx.existingKeys)
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
                row.issueCell.textContent = "ok"
                row.issueCell.className = "import-issue import-issue-ok"
            } else {
                row.issueCell.textContent = result.issues.join("; ")
                row.issueCell.className = "import-issue import-issue-error"
            }
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
            listWork(true) as Promise<Array<{ composer_id: number; name: string }> | null>
        ])
        const composerIndex = indexByName((composers ?? []).map((record) => ({ id: record.id, name: record.name })))
        const contributorIndex = indexByName(
            (contributors ?? []).map((record) => ({ id: record.id, name: record.name }))
        )
        const existingKeys = new Set<string>()
        for (const work of works ?? []) {
            existingKeys.add(compositionKey(work.composer_id, work.name))
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
            }
            rows = records.map((record) => {
                // seed editable cells for exactly the known columns (ignore any tolerated extras)
                const cells: Record<string, string> = {}
                for (const column of columns) {
                    cells[column] = record[column] ?? ""
                }
                const issueCell = document.createElement("td")
                return { cells, tr: document.createElement("tr"), issueCell }
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
                statusBox.textContent = `Server validation passed for all ${report.count} row(s). You may now import.`
            } else {
                validated = false
                commitButton.disabled = true
                const failures = report.rows
                    .filter((entry) => !entry.ok)
                    .map((entry) => `row ${entry.index + 1}: ${entry.issues.join("; ")}`)
                statusBox.textContent = `Server validation found issues:\n${failures.join("\n")}`
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
