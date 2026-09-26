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
// Everything but the root and the three dials below is the shared validator
// harness's, because everything but those is what makes a staged validator project
// one shape the runner can drive: the project's name, the suites it collects, the
// `node` environment an engine project runs in, and the refusal to pass a run that
// collected nothing.
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator resolves the
// build's modules by the same relative paths the build itself uses — `src/game.ts`
// for the game definition, which is the whole of what this project takes from the
// build — and reads a produced asset off `assets/` by the same path
// `specs/assets.md` fixes for it. Every figure a check asserts comes from
// `constants.ts` beside it instead. It is computed HERE, from this file's own URL,
// rather than inside the package: the package is staged one directory deeper than
// this file, so anything derived from its own location would name the wrong tree.
//
// There is no `resolve.alias` here, and there is not meant to be one: an alias
// would redirect an import that reads correctly in the source, and this project
// resolves everything from inside itself and from the build beside it.
//
// Imported from its own module rather than through the package's barrel: it is
// loaded by vite's own config path before the test runtime exists, and reaching it
// through the barrel would drag the whole package into every worker for one
// function no suite ever calls.

import { availableParallelism } from "node:os";
import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

/** One worker per core: see the note on `maxWorkers` below. */
const WORKERS = Math.max(availableParallelism(), 1);

export default defineEngineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
  // A wave driven to its clear, and a run driven to its finale, are posed rather
  // than played out: a check reaches the state its requirement is about through
  // the debug API and spends its frames on the behaviour it reads, at a frame
  // rate it chooses for the span it is covering. Those drives run in this process
  // rather than in a browser, so a file in flight is a core in use.
  //
  // FIVE MINUTES, WHICH IS A HANG CAP AND NOT A BUDGET. The frame counts here are
  // chosen so that every check finishes in a few seconds on a quiet core against a
  // build that draws the yard the way the reference does — and the specification
  // fixes nothing about how a build draws it. A build that tiles the substrate as
  // sixteen hundred separate blits a frame, each under its own transform, costs
  // the recording canvas an order of magnitude more per frame than one that fills
  // it with a pattern, and it is a conforming build: every check here reads the
  // simulation and the picture, never the wall clock, so the only thing a low
  // ceiling can take from such a build is a point it did nothing to lose. A run
  // was measured losing exactly that — nine points across the two engine
  // projects to "Test timed out in 30000ms", on drives of a few hundred frames
  // that pass in ten to twenty seconds alone and in under two minutes with a
  // whole project in flight. So the allowance is the shared harness's,
  // `DEFAULT_TEST_TIMEOUT_MS` in `case-harness/engine/vitest-config`: a ninth of
  // the forty-five-minute cap the runner puts on the whole run, sized so that a
  // check reaching it is hung rather than slow. The authoring guide's ask that a
  // validator finish in seconds still stands for what a check DRIVES; this is
  // the ceiling, not the budget.
  testTimeout: 300_000,
  // The same reasoning for a hook: a `beforeEach` here constructs an engine and
  // awaits a game whose `initialize` decodes some hundred produced sprites, on a
  // host where every other worker is simulating.
  hookTimeout: 120_000,
  // ONE WORKER PER CORE, WHICH IS NEITHER OF VITEST'S TWO EASY ANSWERS.
  //
  // Left alone, vitest takes `availableParallelism() - 1` workers. On the two-core
  // host a run is validated on that is ONE: the suites run strictly in series and
  // the second core sits idle for the whole run, which is how a project that fits
  // the fifteen-minute budget everywhere else misses it on the machine that grades
  // it.
  //
  // Eight — the count `@clockwyrks/case-harness` sets for the ENGINELESS project —
  // is the opposite mistake here. That project's workers each hold a page of one
  // shared browser and spend almost all of their time waiting on a crossing into
  // it, so a worker waiting holds no core and overlapping them is free. These
  // workers hold an ENGINE and step a simulation in their own process: every one of
  // them wants a core for the whole time it runs. Eight of them on two cores gives
  // each file a quarter of a core, and it was measured doing exactly what that
  // predicts.
  //
  // So the count is the core count: both cores busy, and every file running at the
  // speed the machine can actually give it.
  maxWorkers: WORKERS,
});
