// Facet — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// WHY THIS PROJECT NEEDS SCAFFOLDING THE ENGINE-BACKED ONE DOES NOT. An
// engineless build is a static site with nothing to import, so every check drives
// it in a real browser. `globalSetup` starts the one server and the one Chromium
// the whole project shares, before any suite runs; `setupFiles` gives each suite
// worker the teardown that returns its page when the file is done. The
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
    // is most of what decides how long the whole run takes. EIGHT rather than
    // four: a crossing into a browser costs 6 ms on an idle host and 90 ms on a
    // loaded one, and a worker waiting on one holds no core, so four left a
    // project serialized behind that wait while the box had cores to spare. A
    // page is memory in one shared browser process rather than a core, which is
    // what makes eight of them affordable on a host that is also running a
    // model's build.
    maxWorkers: 8,
    minWorkers: 1,
    // AN ALLOWANCE A CORRECT BUILD CAN CROSS IS A DEFECT IN THE CHECK. Nothing
    // these checks measure comes off the wall clock — every one drives the build
    // frame by frame and asserts on what its own snapshot reports — so the only
    // thing a short allowance can decide is how busy the machine was. Sixty
    // seconds was measured doing exactly that on a loaded host: an unmodified
    // reference lost four points to it, at 66-76 s apiece against quiet times of
    // 6-14 s. Five minutes is set against that worst case, and it is a ninth of
    // the forty-five minutes the runner caps the WHOLE suite run at, so a single
    // file can only cross it on a host where the whole run was already lost. A
    // hung build is still bounded, twice over.
    testTimeout: 300_000,
    // The same reasoning, and one thing more: a hook opens a page, loads the
    // built site in it, and waits for the surface and the recorder, so this has
    // to be wider than every ceiling the harness itself sets. A hook that runs
    // out reports that a hook ran out; the harness's own waits report WHICH wait
    // was crossed and whether the host or the build crossed it, which is the
    // account a reviewer needs.
    hookTimeout: 300_000,
  },
});
