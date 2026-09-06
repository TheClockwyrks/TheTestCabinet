// Coil — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// Everything but the root is the shared validator harness's, because everything
// but the root is what makes a staged validator project one shape the runner can
// drive: the project's name, the suites it collects, the environment they run
// in, and the refusal to pass a run that collected nothing.
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator resolves the
// build's modules by the same relative paths the build itself uses. It is
// computed HERE, from this file's own URL, rather than inside the package: the
// package is staged one directory deeper than this file, so anything derived
// from its own location would name the wrong tree.
//
// Imported from its own module rather than through the package's barrel: it is
// loaded by vite's config path before the test runtime exists, and it is the
// file whose failure mode is "the project would not load at all".

import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

// NO DIALS. The minute this project used to name for `testTimeout` was sized
// against a healthy machine, and the package's five is sized against the worst
// load these projects have been measured under — a scenario that drains the
// whole combo window, or fills the board to reach the cleared ending, is
// thousands of ticks of the real simulation, and on a busy host that is exactly
// the shape of check that loses a point to the clock rather than to the build.
// The hook allowance matters more here than the raise does: this project named
// none, so it sat on vitest's TEN-SECOND default, and a `beforeEach` that
// constructs an engine and awaits a game that loads seven produced sprites can
// cross that on load alone. The package's 120 s is the fix.
export default defineEngineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
});
