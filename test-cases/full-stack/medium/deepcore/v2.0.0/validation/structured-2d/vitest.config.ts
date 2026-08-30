// Deepcore — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// The root is the workspace, not this directory, so a validator addresses the
// build by the same relative paths the build itself uses — `src/constants.ts`,
// `src/game.ts`, and the produced files under `assets/`, which several of the
// produced-asset suites read straight off disk. It is derived from this file's
// own URL rather than from the working directory, so the command above works
// from anywhere.
//
// The environment is `node`. The engine takes every measurement from the
// `SurfaceMetrics` the harness supplies, so these suites need no DOM; the pixel
// reads sample a `@napi-rs/canvas` surface the harness hands the engine.

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
    // A Deepcore scenario is posed rather than played to, so most cost
    // milliseconds; the headroom is for the Core Sample's ninety-second timer and
    // the generation sweeps over several seeds at the Marathon size, both driven
    // off the clock rather than waited out.
    testTimeout: 60_000,
  },
});
