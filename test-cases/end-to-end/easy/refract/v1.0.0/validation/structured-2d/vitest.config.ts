// Refract — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// build's modules by the same relative paths the build itself uses. It is derived
// from this file's own URL rather than from the working directory, so the command
// above works from anywhere.
//
// The environment is `node`. The engine takes every measurement from the
// `SurfaceMetrics` the harness supplies, so these suites need no DOM.

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
    // WHAT A TIMEOUT IS FOR, AND WHAT IT MUST NOT DO. Nothing this project
    // measures is taken from the wall clock: every check drives the game frame by
    // frame through the engine's host interface and asserts on what the build's
    // own snapshot reports. The one wall clock left is this allowance — and an
    // allowance a correct build can cross is a defect in the check, because it
    // turns "how busy the machine was" into a lost point on a build that did
    // nothing wrong.
    //
    // The measurement it is set against: on a host running nine of these
    // projects at once (load average ~450), the slowest suite here — a
    // twenty-five-board cascade sweep — took about 40 s against about 6 s quiet,
    // and the engineless sibling of this project lost four points to a sixty-
    // second allowance under the same conditions. Five minutes is a quarter of
    // the twenty-minute cap the runner puts on the WHOLE suite run, so a single
    // file can only cross it on a host where the whole run was already lost;
    // below that, no correct build loses a point to the clock. A hung build is
    // still bounded, and bounded twice over.
    testTimeout: 300_000,
    // Vitest defaults an unset hook allowance to TEN SECONDS, which is the
    // tightest wall clock in the project and the one least related to anything
    // the build does — a `beforeEach` that builds a harness over the engine can
    // cross it on a loaded host alone. Set explicitly, for the same reason the
    // test allowance is.
    hookTimeout: 120_000,
  },
});
