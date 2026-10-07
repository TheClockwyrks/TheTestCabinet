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

// NO TIMEOUT DIALS. The two minutes this project used to name for `testTimeout`
// and the one it named for `hookTimeout` were sized against a healthy machine.
// A fall driven to rest (`driveFall`) is up to nine hundred frames, each a
// crossing into the browser and a snapshot back, under a recording; a crossing
// costs 6 ms on an idle host and 90 ms on a loaded one, and a single such point
// measured 15 s run alone against a produced build. The package's five minutes
// are sized against the worst load these projects have been measured under and
// still sit at a ninth of the runner's cap on the whole suite run, so a file can
// only cross them on a host where the run was already lost. The hook allowance
// has to be wider than every wait the harness itself bounds — thirty seconds to
// reach the browser, the page load, fifteen for the surface, five for the
// recorder — or the last of them is decided here, and "a hook expired" says far
// less than which wait was crossed; one minute was not, and the package's five
// are. An allowance a correct build can cross is a defect in the check, not a
// dial to tighten. The one dial kept is the worker count below, which is about
// the host and not about the clock.
export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
  // Four rather than the package's eight, and never more than the host has
  // cores. A full-stack build loads the art and audio it produced into every
  // page, so a page here costs several times what one of a code-only case does,
  // and the host running this is running a model's build under it. On the
  // two-core host a run is validated on, four pages contending for two cores
  // spend a measurable share of the suite thrashing rather than working, so the
  // dial follows the host down and stops at four on a larger one.
  maxWorkers: Math.max(1, Math.min(4, availableParallelism())),
});
