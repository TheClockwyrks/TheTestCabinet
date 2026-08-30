// Deepcore — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// build by the same relative paths the build itself uses — `src/constants.ts`,
// `src/game.ts`, and the produced files under `assets/`, which several of the
// produced-asset suites read straight off disk. It is derived from this file's
// own URL rather than from the working directory, so the command above works
// from anywhere.
//
// WHY THIS PROJECT NEEDS SCAFFOLDING THE ENGINE-BACKED ONES DO NOT. An engineless
// build is a static site with nothing to import, so every check drives it in a
// real browser through `window.__deepcore`. `globalSetup` starts the one server
// and the one Chromium the whole project shares, before any suite runs, and
// hands both to the workers through `provide`. The environment stays `node` —
// the suites drive a browser, they do not run in one.
//
// A `setupFiles` entry belongs beside `globalSetup` and is deliberately absent
// until the suites are written. Its only job is the per-worker teardown that
// hands a page back when a suite file is done, which is a call into the shared
// harness; the harness lands with the suites, and the entry lands with it. A
// `setupFiles` naming a file that does not exist is not a deferral, it is a
// project that cannot be collected at all.

import { defineConfig } from "vitest/config";

export default defineConfig({
  root: new URL("..", import.meta.url).pathname,
  test: {
    name: "validation",
    include: ["validation/**/*.test.ts"],
    environment: "node",
    globalSetup: ["validation/globalSetup.ts"],
    // A missing validator is a broken suite, not a passing one.
    passWithNoTests: false,
    coverage: { enabled: false },
    // Each suite file holds a page of the shared browser while it runs, so the
    // ceiling on files in flight is the ceiling on pages. Capped rather than left
    // to the core count because the cost of a page is memory in one shared
    // browser process rather than a core, and the host running this is running a
    // model's build under it.
    maxWorkers: 4,
    minWorkers: 1,
    // A Deepcore scenario is posed rather than played to, so the long ones are
    // the Core Sample's ninety-second timer and the generation sweeps over
    // several seeds at the Marathon size, both driven off the clock rather than
    // waited out. Two minutes is generous against a healthy build and still
    // bounds a hung one.
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
