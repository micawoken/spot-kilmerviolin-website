/**
 * tools/apply-fixes.mjs
 *
 * QoL wrapper for `pnpm run fix` - runs Prettier write and SBOM regen (automatic, but can be triggered by --sbom)
 * 
 * 
 * Copyright (C) 2026 Michael Wong.
 *
 * This file is part of the spot-kilmerviolin-website program, available at 
 * https://github.com/micawoken/spot-kilmerviolin-website.
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
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
    console.log(forceSbom ? "--sbom passed - regenerating SBOM" : "pnpm-lock.yaml changed - regenerating SBOM")
    run("pnpm sbom --sbom-format spdx --out=./sbom.json")
} else {
    console.log("No dependency changes detected - skipping SBOM regen (use --sbom to force)")
}
