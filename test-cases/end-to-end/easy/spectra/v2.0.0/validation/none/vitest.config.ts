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
// The root is the workspace, not this directory, so a validator addresses the
// build by the same relative path the build itself uses, and reads the seeded art
// off the workspace's own `assets/` tree. It is derived from this file's own URL
// rather than from the working directory, so the command above works from
// anywhere.
//
// The environment is `node`: these suites DRIVE a browser, they do not run in
// one. An engineless build is a static site with nothing to import, so every
// check reaches it through Chromium and `window.__spectra`.
//
// WHY THIS PROJECT NEEDS SCAFFOLDING THE ENGINE-BACKED ONES DO NOT. `globalSetup`
// starts the one static server and the one Chromium the whole project shares,
// before any suite runs; `setupFiles` gives each suite worker the teardown that
// returns its page when the file is done.

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
    // model's build under it. Eight rather than four because a suite waiting on a
    // round trip holds no core: on a host already running everything else, the
    // whole project finishes sooner with more of them in flight, and the machine
    // it ran on is exactly what a verdict may not depend on.
    maxWorkers: 8,
    minWorkers: 1,
    // Every scenario is posed rather than played into, so a suite is a few dozen
    // crossings into the page rather than thousands of real-time frames. The
    // ceiling is not a figure any check is sized against: what it bounds is a
    // suite that never returns. It stands far above the longest reading taken
    // even on a host running a hundred other jobs, because a check cut short by
    // the runner reports a build's failure that never happened, and how busy the
    // machine was is not a property of the build.
    testTimeout: 480_000,
    hookTimeout: 480_000,
  },
});
