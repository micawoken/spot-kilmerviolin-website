/**
 * tools/apply-fixes.mjs
 *
 * QoL wrapper for `pnpm run fix`: applies the mechanical fixes SDLC.md §5 requires before opening
 * a PR, without a human having to remember when each one applies.
 *
 *   1. Prettier --write (`pnpm run format`) — always safe, always run.
 *   2. SBOM regeneration (`pnpm sbom --sbom-format spdx --out=./sbom.json`) — only when
 *      pnpm-lock.yaml actually changed on this branch. The SBOM embeds a `created` timestamp, so
 *      regenerating it unconditionally would produce a spurious diff on every run even with no
 *      dependency changes.
 *
 * Lockfile-changed detection compares the working tree against the merge-base with main (falling
 * back to uncommitted status if no merge-base can be resolved, e.g. shallow clone). Use --sbom /
 * --no-sbom to override the auto-detection.
 */

import { execSync } from "node:child_process"

const args = process.argv.slice(2)
const forceSbom = args.includes("--sbom")
const skipSbom = args.includes("--no-sbom")

function sh(cmd) {
    return execSync(cmd, { encoding: "utf8" }).trim()
}

function run(cmd) {
    console.log(`> ${cmd}`)
    execSync(cmd, { stdio: "inherit" })
}

run("pnpm run format")

function lockfileChangedOnBranch() {
    for (const base of ["origin/main", "main"]) {
        try {
            const mergeBase = sh(`git merge-base HEAD ${base}`)
            const diff = sh(`git diff --name-only ${mergeBase} -- pnpm-lock.yaml`)
            if (diff.length > 0) return true
            // A resolved merge-base is authoritative for committed changes; still fall through
            // to the uncommitted-status check below before concluding "unchanged".
            break
        } catch {
            // base not available locally, try the next one
        }
    }
    const status = sh("git status --porcelain -- pnpm-lock.yaml")
    return status.length > 0
}

const shouldRegenSbom = forceSbom || (!skipSbom && lockfileChangedOnBranch())

if (shouldRegenSbom) {
    console.log(forceSbom ? "--sbom passed — regenerating SBOM" : "pnpm-lock.yaml changed — regenerating SBOM")
    run("pnpm sbom --sbom-format spdx --out=./sbom.json")
} else {
    console.log("No dependency changes detected — skipping SBOM regen (use --sbom to force)")
}
