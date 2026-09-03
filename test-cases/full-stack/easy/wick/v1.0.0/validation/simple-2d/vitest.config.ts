// Wick — the vitest project the CASE's validators run as, under the Simple 2D
// engine. CASE-PROVIDED.
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
// build's modules by the same relative paths the build itself uses: `../src/game`
// is the module `src/main.ts` imports. It is derived from this file's own URL
// rather than from the working directory, so the command above works from
// anywhere.
//
// Under an engine there is no browser and no server: the build exports its game,
// this project stands the engine up over a canvas of its own and a clock of its
// own, and every check runs IN PROCESS. The environment is `node`, since the
// engine takes every measurement from the `SurfaceMetrics` the harness supplies.

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
    // A scenario that runs a night to its last window, or four thousand seeded
    // kills for the drop roll, is thousands of ticks of the real simulation,
    // each a full update and a full render; generous here, seconds in practice.
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
