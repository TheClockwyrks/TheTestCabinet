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
// drive: the project's name, the suites it collects, the scaffolding it loads —
// the `globalSetup` that stands up the one server and the one Chromium, and the
// `setupFiles` that gives each worker its teardown — and the refusal to pass a
// run that collected nothing. The environment stays `node`: the suites drive a
// browser, they do not run in one.
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
// sized against a healthy machine — a scenario that drains the whole combo
// window, or fills the board to reach the cleared ending, is thousands of ticks
// driven a crossing at a time, and a crossing costs 6 ms on an idle host and
// 90 ms on a loaded one. The package's five minutes are sized against the worst
// load these projects have been measured under and still sit at a ninth of the
// runner's cap on the whole suite run, so a file can only cross them on a host
// where the run was already lost. Its `maxWorkers` of eight is the measured
// figure too: four left this project serialized behind a wait that holds no core.
export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
});
