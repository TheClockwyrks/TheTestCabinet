// Cascade — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// real browser through `window.__cascade`. `globalSetup` starts the one server
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
    // ceiling on files in flight is the ceiling on pages.
    //
    // WHAT A SUITE SPENDS ITS TIME ON DECIDES THIS FIGURE, and it is no longer
    // what it was. A suite used to sit waiting on a crossing into the page for
    // almost all of its life — a round trip per frame — so overlapping suites was
    // most of what decided how long the whole run took and a small number of them
    // could keep the browser busy. The frames now run inside the page in batches
    // (`Harness.sample`), so what a suite spends its time on is the build's own
    // update and render: a core, not a wait. Eight rather than four because eight
    // busy pages use a machine of any ordinary size properly, and eight rather
    // than the core count because the cost of a page is also memory in one shared
    // browser process, and the host running this is running a model's build under
    // it.
    maxWorkers: 8,
    minWorkers: 1,
    // WHAT THESE TWO BOUND, AND WHAT THEY MUST NOT DECIDE. Every suite here is
    // deterministic: it poses a board, drives a counted number of frames through
    // the build's own `advance`, and reads what they left. Not one assertion in
    // the project reads a wall clock. So what a timeout can measure is how much
    // of this machine the suite was given — and a figure a correct build can
    // cross on a busy host is not a bound on the build at all, it is a second
    // verdict on the host, and it fails the wrong thing.
    //
    // They are set from the longest scenario the checklist asks for. The victory
    // cascade runs for a little over twelve seconds of game time with up to
    // fifty-two cards in the air, and every frame of it is a full update and
    // render inside a real browser; the waits are taken at `RUNOUT_HZ` so the
    // cost is a quarter of what it was, and the whole of one still runs to tens
    // of seconds on an idle host. Ten minutes is that with an order of magnitude
    // of room, which is what it takes to survive a host running many times its
    // own number of cores. It remains a ceiling and not a target: a suite that
    // hangs costs this and no more, and every suite here finishes in seconds when
    // the machine is its own.
    testTimeout: 600_000,
    // A hook opens a page, loads the build, waits for its surface and resets it —
    // half a dozen crossings and a page load, every one of them the host's cost
    // rather than the build's. Matched to the test allowance, because a hook that
    // expires reports no verdict at all: the point is lost to a failure that names
    // nothing the build did.
    hookTimeout: 600_000,
  },
});
