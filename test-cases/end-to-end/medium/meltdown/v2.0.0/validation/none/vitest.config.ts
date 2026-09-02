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
// The root is the workspace, not this directory, so a validator addresses the
// build's output by the same relative path the build itself produced it at. It is
// derived from this file's own URL rather than from the working directory, so the
// command above works from anywhere.
//
// WHY THIS PROJECT NEEDS SCAFFOLDING THE ENGINE-BACKED ONES DO NOT. An engineless
// build is a static site with nothing to import, so every check drives it in a
// real browser through `window.__meltdown`. `globalSetup` starts the one server
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
    maxWorkers: 4,
    minWorkers: 1,
    // Most of Meltdown's operations take effect the moment they are called, so a
    // posed scenario is a few hundred crossings into the page rather than
    // thousands of real-time frames. The exceptions are the items governed by the
    // clock rule, which spend real seconds on the build's own clock by design.
    //
    // THREE MINUTES, AND IT IS A CEILING ON THE HOST RATHER THAN A TOLERANCE ON
    // THE BUILD. No validator in this project asserts anything about how long it
    // took, so this figure can only ever turn a slow machine into a failing point
    // — and that is a point taken off a build for the load on the runner that
    // scored it. Measured on this repository's own machine with the core count
    // oversubscribed twice over, the longest suites of the sibling projects ran
    // between sixty and a hundred and five seconds against the twenty-five they
    // take idle, and failed points they pass idle; a browser page under the same
    // contention is slower still. Three minutes is the same ceiling all three
    // engines carry, and the whole run is capped at twenty minutes of wall clock
    // by the runner regardless, so a hung suite is still bounded.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
