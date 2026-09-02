// Floe — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// build by the same relative paths the build itself uses. It is derived from this
// file's own URL rather than from the working directory, so the command above
// works from anywhere.
//
// WHY THIS PROJECT NEEDS SCAFFOLDING THE ENGINE-BACKED ONES DO NOT. An engineless
// build is a static site with nothing to import, so every check drives it in a
// real browser through `window.__floe`. `globalSetup` starts the one server and
// the one Chromium the whole project shares, before any suite runs; `setupFiles`
// gives each suite worker the teardown that returns its page when the file is
// done. The environment stays `node` — the suites drive a browser, they do not
// run in one.

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
    // most of its time waiting on crossings into one, so overlapping them is
    // most of what decides how long the whole run takes. Capped rather than left
    // to the core count because the cost of a page is memory in one shared
    // browser process rather than a core, and the host running this is running a
    // model's build under it.
    maxWorkers: 4,
    minWorkers: 1,
    // A CEILING FOR A HUNG SUITE, NOT AN ALLOWANCE FOR A SLOW ONE. Every
    // measurement in this project is taken in the game's own ticks and decides
    // the same thing however long the host took to run them; the only thing this
    // figure can decide is whether a BUSY MACHINE fails a build that is right.
    // The suites here are seconds of work — measured on a twenty-core host under
    // a load average of four hundred and sixty, the slowest of them was under a
    // minute — so five minutes is several times over the worst a loaded host has
    // been seen to produce, and it costs a conforming build nothing.
    testTimeout: 300_000,
    // The same figure for the hooks, which is where the harness is built. Left
    // unset it would be vitest's ten seconds, and building a harness on a loaded
    // host has been measured well past that — a hook that expires reports the
    // check as broken rather than reporting anything about the build.
    hookTimeout: 300_000,
  },
});
