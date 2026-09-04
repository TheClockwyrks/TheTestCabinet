// Fathom — the vitest project the CASE's validators run as. CASE-PROVIDED.
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

import { defineValidationConfig } from "./case-harness/vitest-config";

// NO DIALS, AND THAT IS THE MEASURED CHOICE. This case used to state two of its
// own — a two-minute check and a one-minute hook — reasoned about a dive driven
// out to a game over: tens of thousands of ticks of real simulation, each of them
// a crossing into the page, generous against that and still seconds in practice.
// Both were sized against a machine with room to spare, which is the one thing an
// allowance must not be sized against: nothing this project measures is taken
// from the wall clock, so a ceiling a correct build can cross turns "how busy the
// host was" into a lost point.
//
// The package's defaults are five minutes for each, set against the worst load
// these projects have been measured under — at load average ~450 a sixty-second
// allowance cost an unmodified reference four checks at 66-76 s apiece against
// quiet times of 6-14 s, and Fathom's driven ticks are costlier than that case's
// pointer work, not cheaper. Five minutes is also a ninth of the forty-five
// minutes the runner caps the WHOLE suite run at (`VITEST_TIMEOUT`,
// `crates/core/src/vitest_validator.rs`), so a file can only cross it on a host
// where the run was already lost. Nothing here is unlike the other engineless
// cases in either direction, so this case names neither ceiling and takes both.
// `vitest-config.ts` states the measurements in full.

export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
});
