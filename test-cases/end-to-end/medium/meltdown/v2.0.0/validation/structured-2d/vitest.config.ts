// Meltdown — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// The environment is `node`. The engine runs over the canvas and the
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
    // A posed floor is advanced with `engine.advance`, so even a scenario that
    // spends a minute of game time costs milliseconds. The ceiling is for the
    // sweeps that release a whole wave against a maze, and for the handful of
    // checks that spend REAL time: a question about whether time passes is
    // measured on the build's own clock, so those hand the frame loop back and
    // wait out a window of wall-clock seconds (`harness.ts`, Windows on the
    // build's own clock).
    //
    // THREE MINUTES, AND IT IS A CEILING ON THE HOST RATHER THAN A TOLERANCE ON
    // THE BUILD. No validator in this project asserts anything about how long it
    // took, so this figure can only ever turn a slow machine into a failing
    // point — and that is a point taken off a build for the load on the runner
    // that scored it. Measured on this repository's own machine with the core
    // count oversubscribed twice over, the longest suites of the sibling projects
    // ran between sixty and a hundred and five seconds against the twenty-five
    // they take idle, and failed points they pass idle. Three minutes restores a
    // margin of seven, and the whole run is capped at twenty minutes of wall
    // clock by the runner regardless, so a hung suite is still bounded.
    testTimeout: 180_000,
    // The hook budget matches, for the same reason: `beforeEach` builds a harness
    // and poses a floor, and a host slow enough to need the ceiling above is slow
    // enough to need it here. It is the ceiling the engineless project already
    // carries.
    hookTimeout: 180_000,
  },
});
