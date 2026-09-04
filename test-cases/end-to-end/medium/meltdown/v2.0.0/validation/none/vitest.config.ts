// Meltdown — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// THE WORKER COUNT IS THE PACKAGE'S, AND THAT IS THE DECISION RATHER THAN THE
// ABSENCE OF ONE. Each suite file here holds a page of the one shared browser
// while it runs, so the ceiling on files in flight is the ceiling on pages — a
// page costs memory in one browser process rather than a core, on a host that is
// also running a model's build. The package's eight were measured against exactly
// that, and against the one ceiling this project cannot move: the runner caps the
// WHOLE suite run at forty-five minutes (`VITEST_TIMEOUT`,
// `crates/core/src/vitest_validator.rs`).
//
// WHAT THE 376-POINT CHECKLIST ACTUALLY COSTS, MEASURED AGAINST THE CONFORMANT
// REFERENCE. Every figure below is this project's own, taken on this
// repository's twenty-core development machine, which is shared with the other
// cases' checklists and is never idle — the load average is quoted with each
// because it is half the reading:
//
//   * all twenty cores, load average about fifteen: 75 s of wall clock, and
//     about eight and a half minutes of test time spread over the eight workers;
//   * all twenty cores, load average about thirty: 130 s of wall clock;
//   * PINNED TO TWO CORES with `taskset -c 0,1`, load average about thirty:
//     890 s — fourteen and three quarter minutes — with all 376 points decided
//     and passed;
//   * pinned the same way with the load average nearer fifty: 1027 s, and four
//     suites that could not open a page on the browser at all. Those came back
//     as unmet host faults rather than as failed points, which is the path
//     `case-harness/host.ts` exists for.
//
// The two engine-backed projects next door, pinned to the same two cores at the
// same time, came to 136 s and 154 s. The browser is the whole of the difference.
//
// SO THE TWO-CORE BUDGET IS MET, AND THE MARGIN IS THIN.
// `guides/authoring/writing-debug-apis-and-validators.md` asks a case to finish
// in fifteen minutes on a two-core host, and the reading above is fourteen and
// three quarter minutes — on two cores that were also carrying the rest of a
// machine at a load average of thirty, so it is a PESSIMISTIC reading of a
// two-core host rather than a reading of a quiet one. It is not a figure to
// spend: a checklist that grows much past 376 points should be re-measured
// before it lands, and the run-wide forty-five-minute cap is the only thing
// underneath it.
//
// THE PER-CHECK ALLOWANCE IS RAISED, AND IT IS A CEILING ON THE HOST RATHER THAN
// A TOLERANCE ON THE BUILD. No validator in this project asserts anything about
// how long it took, so this figure can only ever turn a slow machine into a
// failing point — and a point taken off a build for the load on the runner that
// scored it is exactly what a per-check ceiling must never produce. Measured on
// the same twenty-core machine with the nine engine-and-case checklists of the
// surrounding suite running at once and the load average between two hundred and
// four hundred and fifty, a check gets a percent or two of a core: the longest
// suites here — the ones that drive a minute of game time frame by frame — ran to
// about two hundred and fifty seconds against the twenty-odd they take idle, and
// failed points they pass idle. The package's five minutes leaves a fifth of that
// worst case in hand; ten minutes leaves a margin of nearly thirty against the
// idle figures, and is still between a fifth and a quarter of the run-wide cap, so
// one stuck check cannot be the thing that spends it. The hook budget matches,
// because a page is built in a `beforeEach` and a hook that expires fails the
// check just as a timeout does.

import { defineValidationConfig } from "./case-harness/vitest-config";

export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
  testTimeout: 600_000,
  hookTimeout: 600_000,
});
