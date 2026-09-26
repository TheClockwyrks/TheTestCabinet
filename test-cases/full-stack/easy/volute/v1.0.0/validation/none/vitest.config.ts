// Volute — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// Everything but the dials below is the shared validator harness's, because
// everything but the dials is what makes a staged validator project one shape the
// runner can drive: the project's name, the suites it collects, the scaffolding
// it loads, the four workers a shared browser can hold pages for, and the refusal
// to pass a run that collected nothing.
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator addresses the
// build's output by the same relative path the build itself produced it at. It is
// computed HERE, from this file's own URL, rather than inside the package: the
// package is staged one directory deeper than this file, so anything derived from
// its own location would name the wrong tree.
//
// Imported from its own module rather than through the package's barrel, for the
// reason `globalSetup.ts` gives.

import { defineValidationConfig } from "./case-harness/vitest-config";

// NO DIALS. The two minutes this project used to name for `testTimeout` were
// sized against a healthy machine, and against a cost model the harness has
// since retired: a sweep to an emission or a pose of the hall is one crossing
// now, and what a point spends is the build's own ticks rendered in the page —
// a walk to a level's second mark is nine hundred of them, twelve seconds on an
// idle host and past two minutes on a host running four such pages under a
// model's build. The package's five minutes are sized against that load and
// still sit well inside the runner's cap on the whole suite run, so a file can
// only cross them on a host where the run was already lost.
export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
});
