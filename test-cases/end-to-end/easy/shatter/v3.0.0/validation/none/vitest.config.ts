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
// The root is the workspace, not this directory, so a validator addresses the
// build's output by the same relative path the build itself produced it at. It is
// derived from this file's own URL rather than from the working directory, so the
// command above works from anywhere.
//
// WHY THIS PROJECT NEEDS SCAFFOLDING THE ENGINE-BACKED ONES DO NOT. An engineless
// build is a static site with nothing to import, so every check drives it in a
// real browser through `window.__shatter`. `globalSetup` starts the one server
// and the one Chromium the whole project shares, before any suite runs;
// `setupFiles` gives each suite worker the teardown that returns its page when
// the file is done. The environment stays `node` — the suites drive a browser,
// they do not run in one.

import { defineConfig } from "vitest/config";

export default defineConfig({
  root: new URL("..", import.meta.url).pathname,
  test: {
    name: "validation",
    include: ["validation/**/*.test.ts"],
    environment: "node",
    globalSetup: ["validation/globalSetup.ts"],
    setupFiles: ["validation/setup.ts"],
    // A missing validator is a broken suite, not a passing one.
    passWithNoTests: false,
    coverage: { enabled: false },
    // Each suite file holds a page of the shared browser while it runs, so the
    // ceiling on files in flight is the ceiling on pages — and a suite spends
    // almost all of its time waiting on a crossing into one, so overlapping them
    // is most of what decides how long the whole run takes. Capped rather than
    // left to the core count because the cost of a page is memory in one shared
    // browser process rather than a core, and the host running this is running a
    // model's build under it.
    //
    // EIGHT RATHER THAN FOUR, because the binding limit is not this project's
    // own budget but the runner's: `VITEST_TIMEOUT` in
    // `crates/core/src/vitest_validator.rs` bounds the whole suite run at twenty
    // minutes, and this project's work is dominated by waiting on a crossing
    // into a page rather than by processor. On a host running at twenty-five
    // times its core count, four workers put the whole run past that ceiling and
    // eight bring it back inside it — and a run the ceiling kills reports no
    // point at all, which is a far worse answer than a slow one.
    maxWorkers: 8,
    minWorkers: 1,
    // A ceiling on a suite that never terminates, not a schedule any check is
    // written to. Every scenario here is stepped in whole ticks through the debug
    // surface and none of them measures the wall clock, so what a check costs is
    // round trips into a page on a host this project does not own — and a check
    // that a busy host pushes past its allowance is a check that failed a correct
    // build for a fact about the machine. The figure is therefore many times the
    // longest scenario rather than a snug fit around it: the longest here run in
    // well under a minute on a quiet host, and five minutes is room for one
    // twenty times oversubscribed.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
});
