// Volute — the vitest project the CASE's validators run as, under the Structured
// 2D engine. CASE-PROVIDED.
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
// project needs, and the refusal to pass a run that collected nothing.
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator resolves the
// build's modules by the same relative paths the build itself uses: `../src/game`
// is the module `src/main.ts` imports, and `harness.ts` is the one file that
// takes it. Every figure a check asserts comes from this project's own
// `constants.ts`, transcribed from the rendered specs; nothing here reads a
// figure out of the build. It is derived from this file's own URL rather than
// from the working directory, so the command above works from anywhere — and it
// may never be derived inside the shared package, which is staged one directory
// deeper than this file.
//
// NO ALLOWANCE IS NAMED HERE. This project used to set 120 s per check and 60 s
// per hook, which were a floor written to be generous rather than a ceiling
// measured against anything; the factory's own 300 s and 120 s are the figures
// measured across the tree against a host running nine of these projects at
// once, and both are strictly more generous than what stood here. Nothing a
// correct build does can reach either.
//
// WHY THIS PROJECT NEEDS NO SCAFFOLDING. Under an engine there is no browser and
// no server: the build exports its game, this project stands the engine up over a
// canvas of its own and a clock of its own, and every check runs IN PROCESS. So
// there is no `globalSetup` and no `setupFiles` — the harness a suite builds in
// its `beforeEach` is the whole of the arrangement.

import { defineEngineValidationConfig } from "./case-harness/engine/vitest-config";

export default defineEngineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
});
