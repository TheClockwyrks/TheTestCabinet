// Spectra — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// A project of its own, separate from the build's `vitest.config.ts` at the
// workspace root. The two never mix: the build's config names `src/**/*.test.ts`
// and measures coverage over `src/`, so the tests a build wrote are counted and
// covered on their own, and the verdict rests on the checks in this directory
// alone. A build cannot reach the verdict by writing a test, and a case's check
// cannot flatter the build's coverage.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// The root is the workspace, not this directory, so a validator resolves the
// build's modules by the same relative paths the build itself uses, and reads the
// seeded art off the workspace's own `assets/` tree. It is derived from this
// file's own URL rather than from the working directory, so the command above
// works from anywhere.
//
// The environment is `node`. The engine takes every measurement from the
// `SurfaceMetrics` the harness supplies, so these suites need no DOM; the harness
// stands `fetch` and `createImageBitmap` up over that `assets/` tree itself, so a
// build that loads its sprites inside `initialize` gets them here exactly as it
// does in a browser.

import { defineConfig } from "vitest/config";

export default defineConfig({
  root: new URL("..", import.meta.url).pathname,
  test: {
    name: "validation",
    include: ["validation/**/*.test.ts"],
    environment: "node",
    // A missing validator is a broken suite, not a passing one.
    passWithNoTests: false,
    coverage: { enabled: false },
    // Every scenario is posed and stepped in process, so a suite costs
    // milliseconds on a quiet host. The ceiling is not a figure any check is
    // sized against: what it bounds is a suite that never returns, and it stands
    // far above the longest reading taken even on a host running a hundred other
    // jobs — a check cut short by the runner reports a build's failure that never
    // happened, and how busy the machine was is not a property of the build.
    testTimeout: 300_000,
    // The same ceiling on the hooks, because every suite builds its harness in a
    // `beforeEach`: a build whose `initialize` is slow must fail on its own
    // merits rather than on a hook the runner cut short.
    hookTimeout: 300_000,
    // Every frame a suite advances is a frame the engine renders into an
    // `@napi-rs/canvas` surface, so these projects are CPU rather than round
    // trips, and left to itself vitest fans out over every core the box has.
    // Capped so the project does not contend with itself on a host that is
    // already running everything else.
    maxWorkers: 8,
  },
});
