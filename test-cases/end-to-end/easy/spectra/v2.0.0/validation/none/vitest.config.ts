// Spectra — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// A project of its own, separate from the build's `vitest.config.ts` at the
// workspace root. The two never mix: the build's config names `src/**/*.test.ts`
// and measures coverage over `src/`, so the tests a build wrote are counted and
// covered on their own, and the verdict rests on the suites in this directory
// alone. A build cannot reach the verdict by writing a test, and a case's
// validator cannot flatter the build's coverage.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// Everything but the dials below is the shared validator harness's, because
// everything but the dials is what makes a staged validator project one shape the
// runner can drive: the project's name, the suites it collects, the scaffolding
// it loads (the one server and the one Chromium, and each worker's teardown), and
// the refusal to pass a run that collected nothing.
//
// THE ROOT IS THE WORKSPACE, NOT THIS DIRECTORY, so a validator addresses the
// build by the same relative path the build itself uses, and reads the seeded art
// off the workspace's own `assets/` tree. It is computed HERE, from this file's
// own URL, rather than inside the package: the package is staged one directory
// deeper than this file, so anything derived from its own location would name the
// wrong tree.
//
// Imported from its own module rather than through the package's barrel, for the
// reason `globalSetup.ts` gives.

import { defineValidationConfig } from "./case-harness/vitest-config";

export default defineValidationConfig({
  root: new URL("..", import.meta.url).pathname,
  // FOUR WORKERS, AND THE CEILING IS WHY — this project's own measurement, and
  // the one place it departs from the package's eight. Each suite file holds a
  // page of the shared browser while it runs, and a crossing does not merely
  // wait: the frames it drives and the pixels they draw run inside the ONE
  // Chromium this project shares, so pages in flight contend for that process
  // rather than idling in it. Measured over this whole project on an idle host,
  // going from four workers to eight took 12% off the wall clock and made every
  // suite in it almost twice as slow — the longest went from 7.3 s to 13.9 s. A
  // per-test ceiling is charged against a SUITE's duration, so the second figure
  // is the one that decides whether a correct build is failed by the runner, and
  // trading half of a suite's headroom for a tenth of the wall clock is the wrong
  // way round.
  maxWorkers: 4,
  // Every scenario is posed rather than played into, so a suite is a few dozen
  // crossings into the page rather than thousands of real-time frames. The
  // ceiling is not a figure any check is sized against: what it bounds is a suite
  // that never returns. It stands far above the longest reading taken even on a
  // host running a hundred other jobs, because a check cut short by the runner
  // reports a build's failure that never happened, and how busy the machine was
  // is not a property of the build. Above the package's five minutes because this
  // project runs at four workers rather than eight, so its own longest file waits
  // out more of the shared browser than a project at the default does.
  testTimeout: 480_000,
  hookTimeout: 480_000,
});
