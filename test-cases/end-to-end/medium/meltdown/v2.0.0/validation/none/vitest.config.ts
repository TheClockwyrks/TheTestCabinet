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
    //
    // EIGHT RATHER THAN FOUR, AND THE REASON IS THE RUNNER'S OWN TWENTY-MINUTE
    // CAP ON THE WHOLE RUN (`VITEST_TIMEOUT`,
    // `crates/core/src/vitest_validator.rs`). That cap is not a per-check
    // ceiling: when it expires nothing is scored at all, the checklist is
    // reported as not having run, and every point goes to a reviewer by hand. On
    // this repository's twenty-core machine this project's four hundred-odd
    // checks came to twenty minutes of wall clock at four workers with the load
    // average around two hundred — the whole margin gone, on a machine that has
    // been measured at four hundred and fifty. The same project at twelve workers
    // took the SAME twenty minutes with the load average at four hundred and
    // fifty, which is the shape of a run bound by round trips rather than by
    // cores: a page waiting on a crossing is not competing for one. Eight takes
    // most of that back while doubling rather than tripling what a run costs the
    // shared browser in memory, which is the reason there is a cap here at all.
    maxWorkers: 8,
    minWorkers: 1,
    // Most of Meltdown's operations take effect the moment they are called, so a
    // posed scenario is a few hundred crossings into the page rather than
    // thousands of real-time frames. The exceptions are the items governed by the
    // clock rule, which hand the clock back and wait for the BUILD's own clock to
    // gain the seconds their leg names; a starved page makes such a leg take
    // longer in real time, never cover less of the game.
    //
    // TEN MINUTES, AND IT IS A CEILING ON THE HOST RATHER THAN A TOLERANCE ON
    // THE BUILD. No validator in this project asserts anything about how long it
    // took, so this figure can only ever turn a slow machine into a failing point
    // — and a point taken off a build for the load on the runner that scored it
    // is exactly what a per-check ceiling must never produce.
    //
    // WHY THREE MINUTES WAS NOT ENOUGH, MEASURED RATHER THAN GUESSED. On this
    // repository's own twenty-core machine, with the nine engine-and-case
    // checklists of the surrounding suite running at once and the load average
    // between two hundred and four hundred and fifty, a check gets a percent or
    // two of a core: its wall clock is ten to twenty times its idle wall clock,
    // and the arithmetic it does is unchanged. Measured that way the longest
    // suites here — the ones that drive a minute of game time frame by frame —
    // ran to about two hundred and fifty seconds against the twenty-odd they take
    // idle, and failed points they pass idle. Ten minutes is a margin of nearly
    // thirty against those idle figures, which covers a machine several times
    // busier than the worst this one has been measured at.
    //
    // IT CANNOT RUN AWAY WITH THE RUN, because the runner caps the WHOLE vitest
    // invocation at twenty minutes of wall clock regardless (`VITEST_TIMEOUT`,
    // `crates/core/src/vitest_validator.rs`). A hung suite is still bounded, and
    // the figure here is deliberately half of that cap so that one stuck check
    // cannot be the thing that spends it.
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
