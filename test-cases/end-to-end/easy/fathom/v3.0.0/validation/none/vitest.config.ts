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
// The root is the workspace, not this directory, so a validator addresses the
// build's output by the same relative path the build itself produced it at. It is
// derived from this file's own URL rather than from the working directory, so the
// command above works from anywhere.
//
// WHY THIS PROJECT NEEDS SCAFFOLDING THE ENGINE-BACKED ONES DO NOT. An engineless
// build is a static site with nothing to import, so every check drives it in a
// real browser through `window.__fathom`. The one server and the one Chromium the
// whole project shares are started by a `globalSetup` before any suite runs, and
// each suite worker takes a page of that browser and gives it back through a
// `setupFiles` teardown; both land with the suites that need them. The
// environment stays `node` — the suites drive a browser, they do not run in one.

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
    // WHAT THIS CEILING IS FOR, AND WHAT IT IS NOT FOR. It is here so a build that
    // hangs — a frame loop that never returns, a surface that never answers — ends
    // the check rather than the run. It is NOT a budget for the measurement: every
    // check in this directory decides its verdict on ticks and on the state they
    // left, all of it deterministic, and none of it faster or slower on the build's
    // account. What varies is the wall clock the same work takes, and that is a
    // property of the machine: `specs/instrumentation.md` has `advance` REDRAW, so
    // a driven tick costs the build a frame of its own rendering — a few
    // milliseconds on an idle host and, on one running a model's build and whatever
    // else it is running, tens of times that.
    //
    // So it is set well past the slowest check on a busy machine rather than close
    // to the slowest on an idle one. The suites themselves are what keeps a run
    // short: each samples at the grain its own stated bound needs, drives its ticks
    // in one crossing rather than one apiece, and closes a recorded frame only
    // while a capture is keeping them.
    testTimeout: 300_000,
    // The same ceiling as a check, rather than half of it. `beforeEach` here opens
    // a page of the shared browser, loads the built site into it and waits for the
    // build to install its surface — real work, and work that competes with
    // whatever else the host is running. A hook budget sized for a quiet machine
    // fails a perfectly good build as "hook timed out", which says nothing about
    // the build at all.
    hookTimeout: 300_000,
  },
});
