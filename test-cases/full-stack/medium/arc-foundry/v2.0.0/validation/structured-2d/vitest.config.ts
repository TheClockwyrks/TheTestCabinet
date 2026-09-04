// Arc Foundry — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// build's modules by the same relative paths the build itself uses — `src/game.ts`
// for the game and the debug surface's type, which is the whole of what this
// project takes from the build — and reads a produced asset off `assets/` by the
// same path `specs/assets.md` fixes for it. Every figure a check asserts comes
// from `constants.ts` beside it instead. It is derived from this file's own URL
// rather than from the working directory, so the command above works from
// anywhere.
//
// The environment is `node`. A suite stands the engine up over a canvas and a
// clock of its own, so nothing here needs a DOM.

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
    // A wave driven to its clear, or a run driven to its finale, is thousands of
    // frames of real simulation, and a check that reads a whole campaign's worth
    // of compositions drives fourteen of them in one test. Those drives run in
    // this process rather than in a browser, so a file in flight is a core in
    // use: the ceiling has to hold when every worker is simulating at once, not
    // only when one file runs alone. Three minutes is that ceiling. It is a cap
    // on a hang, not a budget anything spends — the heaviest check in the
    // project finishes inside a minute on its own — and the whole run is capped
    // again from outside.
    testTimeout: 180_000,
  },
});
