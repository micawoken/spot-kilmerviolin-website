# SOFTWARE DEVELOPMENT LIFE CYCLE

This document details the process by which features are ideated, planned, implemented, and deployed. This process is used by the code maintainer (and possible future maintainers) to manage the development of software so that it complies with this repository's other policies, including the code of conduct and the security policy. Code agents are required to follow this SDLC when working on new features.

## 1. Roles and ownership

There is currently only one software maintainer: see CONTRIBUTORS.md for the current list. The first maintainer (Michael Wong) owns the primary deploy using his personal Cloudflare account and their developer resources. As such, there is no current distinct human reviewer: the CI check and any manually-triggered autonomous or automated check are the only conditions prior to deployment.

## 2. Intake

Work starts from one of these pathways:
- A reported issue via GitHub Issues (security issues can be privately reported to `kilmer_security@mwmsc.net`).
- A fix or desired feature from a maintainer.
- A mitigation for an issue from a security review (see section 11).

Non-trivial work should have a design plan written covering the scope, assumptions, and success criteria of work before code is written. They may be stored in docs/dev/*, which is gitignored.

## 3. Branching

- `main` is the branch used by Worker Builds for continuous deployment. The `staging-preview` check (`.github/workflows/staging.yaml`) is the continuous integration check run on every pull request into main. Unless bypassed by an admin, it must succeed before a merge is allowed.
- Feature branches are the preferred method of introducing new features. Feature branches should be single-scope/single-feature and branch off from main.
- Branch names are descriptive kebab-case (e.g. `a11y-wcag-aa-fixes`, `refactor/split-long-files`).
- Delete branches after merge, locally and on `origin`. Once in a while, prune stale branches both locally and at origin.

## 4. Local development

1. `pnpm install` - installs dependencies
2. `pnpm dev` - starts the Astro local development server
3. Compositor/template-routing changes must also pass `pnpm run gate:compositor-routing` (the frozen-fixture routing gate) before being considered done.

## 5. Pre-PR verification

The following checks must be run before a PR is opened:

- `pnpm run format:check` - prettier code formatting
- `pnpm run check` - runs `astro build` (builds the website) and `wrangler deploy --dry-run` (simulates live deploy)
- `pnpm test` - unit and integration tests through vitest, including for security-relevant checks
- Live browser testing, using the development server (or Playwright, for agents)
- `pnpm run gate:compositor-routing` if compositor/template routing was touched
- Manual verification in the browser for any UI-visible change
- For updates to dependencies, the software bill of materials (SBOM) must be regenerated using `pnpm sbom --sbom-format spdx --out=./sbom.json`.

## 6. Code review and AI disclosure

It is expected that all code must be either:
1. Written by a human, or
2. Reviewed by a human.

The AI-assisted code policy in CONTRIBUTORS.md applies to all maintainers regardless of identity. They must do the following when using AI-assisted coding tools:
- Instruct the agent to put the `Co-Authored-By` git tag in the commit message, amend any commits with AI-assisted code to include the tag, or include the tag if committing manually. The tag must include the model(s) used to write the code.
- The pull request must explicitly indicate that AI was used in the commit and that a human maintainer has reviewed and approved the change. In addition to reading the code, the maintainer may use tools such as GitHub Copilot review and Claude Code /code-review to satisfy the human review requirement. 

## 7. CI gate (automatic, required)

The staging gate `staging.yaml` runs on every pull request into `main`. It verifies code formatting, runs type-checking, runs the test suite, runs the build, and performs a deployment to the staging Worker. The gate must pass before GitHub permits the branch to be merged. If any sub-step of the check fails, the entire check fails.

## 8. Merge and deploy

When the staging checks pass, a feature branch can be merged into main. Upon merge, Cloudflare Worker Builds picks up the event and triggers continuous deployment. This is one of the two triggers for CD - the other is the user-triggered deploy hook (stored as a Worker secret), fired when database or CMS content has been updated for publication.

- Merge once the staging preview check is green and review (§6) is complete.
- Cloudflare Worker Builds has its own Git integration on `main` and auto-builds/deploys on merge. There is no separate GitHub Actions deploy step for production.
- `CF_DEPLOY_HOOK` exists as a manual rebuild trigger, rate-limited by `REBUILD_COOLDOWN_SEC` (1800s).

## 9. Rollback and incident response

If an issue is discovered in a recent deployment:
1. **Roll back the deployment**: perform a rollback using the Cloudflare dashboard (Workers & Pages → the Worker → Deployments → select the last known-good deployment → roll back) or via `wrangler rollback`
2. **Fix `main`**: revert the bad commit using `git revert`, and merge it in using a PR.
3. **Fix the problem**: fix the problem in a new feature branch, and merge it in using a PR.

Note: changes to the D1 database schema are reverted differently:
- Use Cloudflare D1 Time Travel to revert the database to the last version pre-migration, or
- Write and apply a D1 migration (or execute relevant SQL code on remote) to revert the database change.

Incidents are currently discovered by human interaction, not automatically

## 10. Post-deploy

- Review the site with humans for any UI/UX changes.
- Update local documentation, notes, or memory of the changes, their completion status, and notes for the future.

## 11. Ongoing maintenance

- **Security reviews**: periodically review security-relevant components of the repository for vulnerabilities, and respond to security reports. It is recommended to do this at least every three months.
- **Dependency updates**: periodically update dependencies to latest. Follow the standard feature branch process (including full testing) to merge the changes in. GitHub Dependabot alerts are active to detect security vulnerabilities with dependencies.
- **Vulnerability intake**: per SECURITY.md, acknowledge reports to `kilmer_security@mwmsc.net` within 72 hours.

## 12. Known gaps / open items

- The CI gate (section 7) does not include automated browser testing or the compositor routing gate. An automated Playwright test could close this gap.
- There is no automated way to review the site post-deploy or detect a bad deployment, let alone implement a fix.
