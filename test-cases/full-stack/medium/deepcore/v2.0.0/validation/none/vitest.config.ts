// Deepcore — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// it loads, the workers a shared browser can hold pages for, and the refusal to
// pass a run that collected nothing.
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator addresses the
// build's output by the same relative path the build itself produced it at —
// which is also how the produced-asset suites read the files under `assets/`
// straight off disk. It is computed HERE, from this file's own URL, rather than
// inside the package: the package is staged one directory deeper than this file,
// so anything derived from its own location would name the wrong tree.
//
// Imported from its own module rather than through the package's barrel, for the
// reason `globalSetup.ts` gives.

import { availableParallelism } from "node:os";

import { defineValidationConfig } from "./case-harness/vitest-config";

export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
  // A Deepcore scenario is posed rather than played to, so the long one is the
  // Core Sample's ninety-second timer, driven off the clock rather than waited
  // out. Two minutes is generous against a healthy build and still bounds a hung
  // one.
  testTimeout: 120_000,
  hookTimeout: 60_000,
  // Four rather than the package's eight, and never more than the host has
  // cores. A full-stack build loads the art and audio it produced into every
  // page, so a page here costs several times what one of a code-only case does,
  // and the host running this is running a model's build under it. On the
  // two-core host a run is validated on, four pages contending for two cores
  // spend a measurable share of the suite thrashing rather than working, so the
  // dial follows the host down and stops at four on a larger one.
  maxWorkers: Math.max(1, Math.min(4, availableParallelism())),
});
