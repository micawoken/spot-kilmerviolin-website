/**
 * Unit tests for the contributor-reference display helpers (scripts/references.ts)
 * These format the inline "id (name)" rendering shared by the SSR CompositionInfo card and the
 * client-side READ flow.
 */

import { describe, it, expect } from "vitest"
import { formatContributorRef, formatContributorRefs } from "../src/scripts/references.ts"

describe("formatContributorRef", () => {
    it("renders an id with its resolved name in parentheses", () => {
        expect(formatContributorRef(5, "John Smith", "(none)")).toBe("5 (John Smith)")
    })

    it("renders the bare id when the name is blank or missing", () => {
        expect(formatContributorRef(5, "", "(none)")).toBe("5")
        expect(formatContributorRef(5, "   ", "(none)")).toBe("5")
        expect(formatContributorRef(5, null, "(none)")).toBe("5")
        expect(formatContributorRef(5, undefined, "(none)")).toBe("5")
    })

    it("trims surrounding whitespace from the name", () => {
        expect(formatContributorRef(5, "  Jane Doe  ", "(none)")).toBe("5 (Jane Doe)")
    })

    it("returns the placeholder when no id is present", () => {
        expect(formatContributorRef(null, "ignored", "(no contributor)")).toBe("(no contributor)")
        expect(formatContributorRef(undefined, "ignored", "(no contributor)")).toBe("(no contributor)")
    })
})

describe("formatContributorRefs", () => {
    it("joins multiple references positionally with their names", () => {
        expect(formatContributorRefs([1, 2], ["Alice", "Bob"], "(none)")).toBe("1 (Alice), 2 (Bob)")
    })

    it("falls back to the bare id when a name slot is blank or missing", () => {
        // index 1 is blank and index 2 has no corresponding name slot (names array is shorter than ids)
        expect(formatContributorRefs([1, 2, 3], ["Alice", ""], "(none)")).toBe("1 (Alice), 2, 3")
    })

    it("returns the placeholder for an empty or missing id list", () => {
        expect(formatContributorRefs([], ["ignored"], "(no additional contributors)")).toBe("(no additional contributors)")
        expect(formatContributorRefs(null, null, "(no additional contributors)")).toBe("(no additional contributors)")
        expect(formatContributorRefs(undefined, undefined, "(no additional contributors)")).toBe("(no additional contributors)")
    })
})
