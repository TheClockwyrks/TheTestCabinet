// Carom — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
//
// CAROM NAMES NO DIAL, AND THAT IS THE DECISION RATHER THAN THE ABSENCE OF ONE.
// The costly thing in this suite is a rally driven to the speed ceiling —
// thousands of frames of real physics, each of them a crossing into the page —
// and it is the case's longest scenario, not an unusual one: what a crossing
// costs is a property of how busy the machine is rather than of the build, and
// the same suites measured on a loaded host take an order of magnitude longer
// than on an idle one. The package's defaults are set against exactly that. Its
// five-minute per-check allowance was measured against the case where sixty
// seconds was not enough — on a host running nine of these projects at once (load
// average ~450) an unmodified reference lost four points to that allowance at
// 66-76 s apiece against quiet times of 6-14 s — and it is a NINTH of the
// forty-five-minute cap the runner puts on the WHOLE suite run (`VITEST_TIMEOUT`,
// `crates/core/src/vitest_validator.rs`), so a single file can only cross it on a
// host where the run was already lost. Its hook allowance matches, because a page
// is built in a `beforeEach` and a hook that expires fails the check just as a
// timeout does; it also has to stay wider than every ceiling the harness itself
// sets (connect, page, surface and recorder are capped at 30, 60, 15 and 5
// seconds — `CONNECT_TIMEOUT_MS`, `PAGE_DEADLINE_MS`,
// `DEFAULT_SURFACE_TIMEOUT_MS` and `RECORDER_READY_TIMEOUT_MS`, with this case's
// `harness.ts` naming that same 15 s rather than raising it) or the last of them
// is decided here instead, and a hook that runs out reports that a hook ran out
// where those ceilings report which wait was crossed and whether the host or the
// build crossed it. And its eight workers were measured too: at load average
// ~650 the suite run took 1 059 s at eight with its slowest FILE at 170 s,
// against 861 s at sixteen with its slowest file at 316 s and four points lost to
// the per-test allowance.
//
// Carom is not costlier than what those figures were taken under, so raising any
// of them here would only trade a measured number for a guessed one — and
// lowering one to make a fast case look fast is how a correct build loses a point
// to the load average.

import { defineValidationConfig } from "./case-harness/vitest-config";

export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
});
