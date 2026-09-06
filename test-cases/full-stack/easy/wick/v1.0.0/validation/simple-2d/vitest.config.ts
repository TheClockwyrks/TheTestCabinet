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
// anywhere — and it is passed IN rather than computed inside the shared harness,
// which is staged one directory deeper than this file and would name the wrong
// tree.
//
// Under an engine there is no browser and no server: the build exports its game,
// this project stands the engine up over a canvas of its own and a clock of its
// own, and every check runs IN PROCESS. So there is no `globalSetup` and no
// `setupFiles` — the harness a suite builds in its `beforeEach` is the whole of
// the arrangement — and the environment is `node`, since the engine takes every
// measurement from the `SurfaceMetrics` the harness supplies.
//
// NO DIALS. This project used to name a 120 s ceiling on a check and a 60 s one
// on a hook, sized against nothing in particular; the factory's 300 s and 120 s
// are the figures measured across the tree on a host running nine of these
// projects at once, and both are strictly more generous than what stood here. An
// allowance a correct build can cross is a defect in the check rather than in
// the build — a scenario that runs a night to its last window, or four thousand
// posed kills for the drop roll, is thousands of ticks of the real simulation,
// and on a busy host that is exactly the shape of check that loses a point to
// the clock — so the ceilings are the harness's and this file names none.
//
// The factory is imported by its own specifier rather than through the package's
// barrel, because it is loaded by vite's own config path before the test runtime
// exists and it is the file whose failure mode is "the project would not load at
// all".

import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

export default defineEngineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
});
