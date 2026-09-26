// Gantry — the vitest project the CASE's validators run as, for the STRUCTURED
// 3D build. CASE-PROVIDED.
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
// Everything but the dial below is the shared harness's factory, because
// everything but the dial is what makes a staged validator project one shape the
// runner can drive: the project's name, the suites it collects
// (`validation/**/*.test.ts`), the `node` environment, the coverage it does not
// measure, and the refusal to pass a run that collected nothing
// (`passWithNoTests: false` — a missing validator is a broken suite, not a
// passing one). There is no `globalSetup` and no `setupFiles`, because an engine
// project stands nothing up: the engine is constructed in process, over canvases
// the harness owns, and a check steps it with `engine.advance`.
//
// THE ENVIRONMENT IS `node`, AND THERE IS NO BROWSER ANYWHERE IN THIS PROJECT.
// The engine takes every measurement through the `SurfaceMetrics` the harness
// supplies, and what a browser would supply around it — a `webgl2` context,
// `fetch`, an audio context — the shared harness supplies instead. What it does
// NOT supply is the engine's recorder, whose VP9 encoder and `emitReplay` command
// both want a browser, so every point this case declares is backed by a still
// rather than a recording; `harness.ts` states that in full.
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator resolves the
// build's module by the same relative path the build itself uses — `../src/game`
// for the definition the engine is created over — and the harness finds the
// produced files under `assets/` where `specs/assets.md` had the build commit
// them. It is computed HERE, from this file's own URL, rather than inside the
// package: the package is staged one directory deeper than this file, so anything
// derived from its own location would name the wrong tree. In the staged project
// this file is `<workspace>/validation/vitest.config.ts`, so `..` is the
// workspace.
//
// Imported by its own specifier rather than through the package's barrel, because
// it is loaded by vite's own config path before the test runtime exists and it is
// the file whose failure mode is "the project would not load at all".

import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

export default defineEngineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
  // ONE FILE IN FLIGHT PER TWO CORES, rather than the one per core vitest picks
  // when no ceiling is named. A file here holds a core for as long as it runs, and
  // one of them starts work of its own beside it: the point about the build
  // interface runs the build in a scratch copy, and with a suite on every core
  // that build takes about twice what it takes beside half of them. What the
  // ceiling buys is that every FILE lands near what it costs alone, which is what
  // a per-check allowance is read against; what it costs is a little of the whole
  // run's wall clock, which is the runner's to spend. On the two-core host a run
  // is graded on, this is the one worker vitest would have chosen anyway.
  maxWorkers: "50%",
  // A Gantry scenario is real structural simulation: a reference tape is a
  // thousand ticks of two linear solves per tick, and a crane is posed one edit
  // at a time before any of it starts. Those drives run in this process rather
  // than in a browser, so a file in flight is a core in use: the ceiling has to
  // hold when every worker is simulating at once, not only when one file runs
  // alone. Three minutes is that ceiling — this case's own measurement rather
  // than the factory's five-minute default, and stated for that reason. It is a
  // cap on a hang rather than a budget anything spends, and the whole run is
  // capped again from outside.
  testTimeout: 180_000,
  // `hookTimeout` is deliberately NOT set. This project used to name 60 s, which
  // was tighter than the factory's 120 s and rested on no measurement — and the
  // hook it bounds is the one that constructs an engine and awaits a game's
  // `initialize`, which for this case decodes eight produced models and twelve
  // produced sounds. An allowance a correct build can cross is a defect in the
  // check, so the more generous measured one is the right one.
});
