// makes the "cloudflare:test" module declarations visible to the root tsc run (npm run check),
// which sweeps the tests folder; the package exposes them under the ./types export, not its root types
/// <reference types="@cloudflare/vitest-pool-workers/types" />
