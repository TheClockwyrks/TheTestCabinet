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

import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

/** One worker per core: see the note on `maxWorkers` below. */
const WORKERS = Math.max(availableParallelism(), 1);

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
    // use.
    //
    // FIVE MINUTES, MEASURED. Every produced file reaches the loader for every
    // check, so a campaign drive blits the run's own art frame after frame rather
    // than stroking geometry, and the heaviest files in this project were measured
    // at three and a half minutes each with every worker simulating at once — past
    // the three-minute ceiling that stood before. An allowance a CORRECT build can
    // cross is a defect in the check, because it turns how busy the machine was
    // into a lost point, so the ceiling is set against the measured worst case
    // rather than against a quiet machine. It is still a cap on a hang rather than
    // a budget anything spends, and the whole run is capped again from outside at
    // forty-five minutes.
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // ONE WORKER PER CORE, WHICH IS NEITHER OF VITEST'S TWO EASY ANSWERS.
    //
    // Left alone, vitest takes `availableParallelism() - 1` workers. On the
    // two-core host a run is validated on that is ONE: the suites run strictly in
    // series and the second core sits idle for the whole run, which is how a
    // project that fits the fifteen-minute budget everywhere else misses it on
    // the machine that grades it.
    //
    // Eight — the count `@test-cabinet/case-harness` sets for the ENGINELESS
    // project — is the opposite mistake here. That project's workers each hold a
    // page of one shared browser and spend almost all of their time waiting on a
    // crossing into it, so a worker waiting holds no core and overlapping them is
    // free. These workers hold an ENGINE and step a simulation in their own
    // process: every one of them wants a core for the whole time it runs. Eight of
    // them on two cores gives each file a quarter of a core, and it was measured
    // doing exactly what that predicts.
    //
    // So the count is the core count: both cores busy, and every file running at
    // the speed the machine can actually give it.
    maxWorkers: WORKERS,
    minWorkers: WORKERS,
  },
});
