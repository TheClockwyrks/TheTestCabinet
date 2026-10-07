// Facet — the vitest project the CASE's validators run as, under NO ENGINE.
// CASE-PROVIDED.
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
// drive: the project's name, the suites it collects, the scaffolding it loads,
// the refusal to pass a run that collected nothing, and the three dials the
// package sets from what it has measured — eight workers sharing one browser, and
// five minutes for a test and for a hook. An allowance a correct build can cross
// is a defect in the check, and sixty seconds has been measured being exactly
// that on a loaded host.
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
