// Floe — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// Everything but the root below is the shared validator harness's, because
// everything but the root is what makes a staged validator project one shape the
// runner can drive: the project's name, the suites it collects, the scaffolding
// it loads, and the refusal to pass a run that collected nothing.
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator addresses the
// build's output by the same relative path the build itself produced it at. It is
// computed HERE, from this file's own URL, rather than inside the package: the
// package is staged one directory deeper than this file, so anything derived from
// its own location would name the wrong tree.
//
// Imported from its own module rather than through the package's barrel, for the
// reason `globalSetup.ts` gives.
//
// FLOE NAMES NO DIAL, AND THAT IS THE DECISION RATHER THAN THE ABSENCE OF ONE.
// The package's five-minute per-check allowance and its matching hook allowance
// are the two figures this project used to state for itself, at exactly those
// values, so nothing moves by taking them. Its EIGHT workers are the one figure
// that changes, and upward: a suite file here spends almost all of its time
// waiting on a crossing into a page rather than on a core, so what the ceiling
// bounds is pages held open in one shared browser process rather than cores.
//
// AND EIGHT IS THE MEASURED FIGURE, not the inherited one. The two hundred and
// fifty-eight files of this project were run against the `none` reference on a
// host pinned to TWO CORES, which is what the runner validates on: eight workers
// finished in 2 min 43 s and four in 3 min 19 s, both with every point passing.
// Four was this case's own guess and it costs half a minute; the guide's budget
// is fifteen minutes on that host, so the whole run sits at a fifth of it either
// way and the choice is made on the measurement rather than on the margin.

import { defineValidationConfig } from "./case-harness/vitest-config";

export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
});
