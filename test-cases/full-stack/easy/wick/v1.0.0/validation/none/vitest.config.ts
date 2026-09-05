// Wick — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// Everything but the root is the shared validator harness's, because that is what
// makes a staged validator project one shape the runner can drive: the project's
// name, the suites it collects, the scaffolding it loads, the workers a shared
// browser holds pages for, the ceilings on a check and on a hook, and the refusal
// to pass a run that collected nothing.
//
// THE CEILINGS ARE THE HARNESS'S ON PURPOSE. This project used to name its own,
// 180s for a check and 60s for a hook. `pickups/drop-at-most-one` then grew a
// sample of sixty thousand kills, the ceiling did not follow, and the check
// spent 187s under eight-way contention against an allowance of 180 and lost
// its point to the clock on a conformant build. Both halves of that were wrong:
// the sample is now the four thousand kills the other drop-roll checks share,
// read from both ends rather than driven longer, and the ceiling is the
// harness's. An allowance a correct build can cross is a defect in the check,
// and a case lowers it only to make a fast case look fast.
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

export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
});
