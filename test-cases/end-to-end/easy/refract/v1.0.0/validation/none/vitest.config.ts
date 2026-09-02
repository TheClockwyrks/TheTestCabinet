// Refract — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
    // is most of what decides how long the whole run takes. Capped rather than
    // left to the core count because the cost of a page is memory in one shared
    // browser process rather than a core, and the host running this is running a
    // model's build under it.
    //
    // Eight rather than four, because the number that matters is not how long
    // this project takes on an idle box — it is how much of the runner's cap on
    // the WHOLE suite run is left on a busy one. A crossing into a browser costs
    // 6 ms on an idle host and 90 ms on a loaded one, and a worker waiting on one
    // holds no core; four workers left the project serialized behind that wait
    // while the box had cores to spare, and the whole run measured 700 s against
    // a 20-minute cap. Eight halves that, and a page is still memory rather than
    // a core.
    maxWorkers: 8,
    minWorkers: 1,
    // WHAT A TIMEOUT IS FOR, AND WHAT IT MUST NOT DO. Nothing this project
    // measures is taken from the wall clock: every check drives the game frame by
    // frame and asserts on what the build's own snapshot reports. The one wall
    // clock left is this allowance — and an allowance a correct build can cross
    // is a defect in the check, because it turns "how busy the machine was" into
    // a lost point on a build that did nothing wrong.
    //
    // Sixty seconds was such an allowance. On a host running nine of these
    // projects at once (load average ~450), an unmodified reference lost
    // cascade/tier-ladder, cascade/sequence-is-endless,
    // cascade/boards-meet-the-tier-floor and campaign/select-states to it, at
    // 66-76 s apiece against quiet times of 6-14 s. Four minutes is set against
    // that measurement rather than against a healthy machine: the slowest suite
    // here is a twenty-five-board cascade sweep that costs about 2 s quiet and
    // about 40 s on a host under that load, so the allowance is roughly six times
    // the worst reading actually taken and about a hundred times the quiet one. A
    // hung build is still bounded — and bounded twice over, since the runner caps
    // the whole suite run as well.
    testTimeout: 240_000,
    // A hook opens a page on the shared browser and loads the built site in it.
    // The same reasoning applies, against a much smaller cost.
    hookTimeout: 120_000,
  },
});
