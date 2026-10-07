// Wick — the vitest project the CASE's validators run as, under the Structured
// 2D engine. CASE-PROVIDED.
//
// A project of its own, separate from the build's `vitest.config.ts` at the
// workspace root. The two never mix: the build's config names
// `src/**/*.test.ts` and measures coverage over `src/`, so the tests a build
// wrote are counted and covered on their own, and the verdict rests on the
// checks in this directory alone. A build cannot reach the verdict by writing
// a test, and a case's check cannot flatter the build's coverage.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// The root is the workspace, not this directory, so a validator resolves the
// build's modules by the same relative paths the build itself uses. It is
// derived from this file's own URL rather than from the working directory, so
// the command above works from anywhere — and it is passed IN rather than
// derived inside the factory, because the shared harness is staged one directory
// deeper than this file and anything taken from its own location would name the
// wrong tree.
//
// WHY THIS PROJECT NEEDS NO SCAFFOLDING. Under an engine there is no browser and
// no server: the build exports its game, this project stands the engine up over
// a canvas of its own and a clock of its own, and every check runs IN PROCESS.
// So there is no `globalSetup` and no `setupFiles` — the harness a suite builds
// in its `beforeEach` is the whole of the arrangement. The environment is still
// `node`: the engine takes every measurement from the `SurfaceMetrics` the
// harness supplies, and every reading comes from the engine's own object model,
// its events, and the draw commands it records, so these suites need no DOM.
//
// NO DIALS. This project used to name `testTimeout: 180_000` and no
// `hookTimeout` at all. Neither figure was measured against anything, and the
// second was the more dangerous of the two: naming none left it on vitest's
// TEN-SECOND default, which is the tightest wall clock a validator project has
// and the one least related to anything the build does — a `beforeEach` that
// constructs an engine and awaits a game that loads a whole tree of produced
// sprites can cross ten seconds on host load alone, and every point in the file
// goes with it. The factory's `300_000` and `120_000` are the figures taken
// across the tree against a host running nine of these projects at once, and
// both are strictly more generous than what stood here. An allowance a correct
// build can cross is a defect in the check, not a dial to tighten.
//
// The factory is imported by its own specifier rather than through the package's
// barrel, because it is loaded by vite's own config path before the test runtime
// exists and it is the file whose failure mode is "the project would not load at
// all".

import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

export default defineEngineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
});
