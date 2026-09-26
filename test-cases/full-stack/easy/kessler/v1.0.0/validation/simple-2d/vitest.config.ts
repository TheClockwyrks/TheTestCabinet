// Kessler — the vitest project the CASE's validators run as, under the
// Simple 2D engine. CASE-PROVIDED.
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
// Everything but the root is the shared factory's, because everything but the
// root is what makes a staged validator project one shape the runner can drive:
// the project's name, the suites it collects, the `node` environment an engine
// project needs — every measurement comes from the engine's own surfaces and
// from the draw commands it records, so these suites need no DOM — and the
// refusal to pass a run that collected nothing.
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator resolves the
// build's modules by the same relative paths the build itself uses. It is
// derived from this file's own URL rather than from the working directory, so
// the command above works from anywhere — and it may never be derived inside the
// shared package, which is staged one directory deeper than this file.
//
// NO ALLOWANCE IS NAMED HERE. This project used to set 60 s per check and to
// leave the hook allowance at vitest's own ten seconds. Neither was measured
// against anything: the factory's 300 s and 120 s are the figures taken across
// the tree against a host running nine of these projects at once, and both are
// strictly more generous than what stood here — the second by thirty seconds
// over the only wall clock a `beforeEach` that builds an engine can cross.
//
// WHY THIS PROJECT NEEDS NO SCAFFOLDING. Under an engine there is no browser and
// no server: the build exports its game, this project stands the engine up over
// a canvas of its own and a clock of its own, and every check runs IN PROCESS.
// So there is no `globalSetup` and no `setupFiles` — the harness a suite builds
// in its `beforeEach` is the whole of the arrangement.
//
// The factory is imported by its own specifier rather than through the package's
// barrel, because it is loaded by vite's own config path before the test runtime
// exists and it is the file whose failure mode is "the project would not load at
// all".

import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

export default defineEngineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
});
