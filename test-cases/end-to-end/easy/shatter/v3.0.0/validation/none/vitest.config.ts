// Shatter — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// SHATTER NAMES NO DIAL, AND THAT IS THE DECISION RATHER THAN THE ABSENCE OF ONE.
// The package's defaults — five minutes per check, five minutes per hook, eight
// suite files in flight — were measured on a host running nine of these projects
// at once, and this project is not costlier than what they were taken under: its
// longest scenarios are a saucer flown out to its lifetime and a wave shot down a
// round at a time, both of them thousands of driven ticks and all of them
// crossings into a page rather than processor. Raising any of them here would
// trade a measured number for a guessed one, and lowering one to make a fast case
// look fast is how a correct build loses a point to the load average. What the
// package's own figures are argued against is the one ceiling this project cannot
// move: the runner caps the WHOLE suite run at forty-five minutes
// (`VITEST_TIMEOUT`, `crates/core/src/vitest_validator.rs`).
//
// AND THE MEASUREMENT THAT SAYS SO, taken so a later author has an absolute rather
// than a fraction to reason from. Against the `warhead` reference build, 291 suite
// files and 324 checks finished in 45 s of wall clock at the package's eight
// workers, with the slowest FILE at 8.0 s (`saucer/at-most-one-at-a-time`, which
// flies a saucer out to its lifetime) and the next three at 5.3, 4.6 and 4.5 s
// (`harness.test.ts`, `waves/speed-scales-per-wave`, `saucer/avoids-the-core`).
// The reading was taken on a twenty-core box carrying four of these case
// worktrees at load average ~13 — a loaded host rather than an idle one, so it is
// an upper bound. Against that, the fifteen minutes
// `guides/authoring/writing-debug-apis-and-validators.md` asks a case to finish
// in is two orders of magnitude away, and no per-check allowance is anywhere near
// its five minutes.

import { defineValidationConfig } from "./case-harness/vitest-config";

export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
});
