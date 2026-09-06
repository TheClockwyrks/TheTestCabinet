// Gantry — the vitest project the CASE's validators run as, for a build on the
// SIMPLE 3D engine. CASE-PROVIDED.
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
// the harness owns, and a check steps it with the engine's own frame.
//
// THE ENVIRONMENT IS `node`, AND THERE IS NO BROWSER. The engine takes every
// measurement through the `SurfaceMetrics` the harness supplies, and what a
// browser would supply around it — a `webgl2` context, `fetch`, an audio
// context — the shared harness supplies instead. What that costs is the scene's
// pixels, which no check in this project reads, and the engine's recorder, whose
// VP9 encoder and `emitReplay` command both want a browser — so every point this
// case declares is backed by a still rather than a recording, which `harness.ts`
// states in full. What it buys is a run that needs no browser, no server and no
// wall-clock time.
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator resolves the
// build's modules by the same relative paths the build itself uses —
// `../src/game` for the game the engine drives — and reads a produced asset off
// `assets/` by the same path `specs/assets.md` fixes for it. It is computed HERE,
// from this file's own URL, rather than inside the package: the package is staged
// one directory deeper than this file, so anything derived from its own location
// would name the wrong tree. In the staged project this file is
// `<workspace>/validation/vitest.config.ts`, so `..` is the workspace.
//
// Imported by its own specifier rather than through the package's barrel, because
// it is loaded by vite's own config path before the test runtime exists and it is
// the file whose failure mode is "the project would not load at all".

import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

export default defineEngineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
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
