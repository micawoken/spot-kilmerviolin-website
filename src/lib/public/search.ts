/**
 * lib/public/search.ts
 * 
 * Implements an interface to perform database search
 * 
 */

import { SQLStatement, regexToSqlLike } from "../api/sql"
import { run_stmt } from "../api/database"


interface SearchOptionsPrimitive {
    database: "composers" | "works" | "contributors" | "free",
    limit: number | null
}

type ComposerSearchOptions = Partial<ComposerRecord>
type CompositionSearchOptions = Partial<CompositionRecord>
type ContributorSearchOptions = Partial<ContributorRecord>

type AdvancedSearchOptions = SearchOptionsPrimitive & (ComposerSearchOptions | CompositionSearchOptions | ContributorSearchOptions)

export interface QuickSearchOptions extends SearchOptionsPrimitive {
    free_text: string
}
