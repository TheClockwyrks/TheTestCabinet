// Arc Foundry — the vitest project the CASE's validators run as. CASE-PROVIDED.
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
// build's output by the same relative path the build itself produced it at, and
// reads a produced asset off `assets/` by the path `specs/assets.md` fixes for it.
// It is derived from this file's own URL rather than from the working directory,
// so the command above works from anywhere.
//
// WHY THIS PROJECT NEEDS SCAFFOLDING THE ENGINE-BACKED ONES DO NOT. An engineless
// build is a static site with nothing to import, so every check drives it in a
// real browser and reaches the game through the `window.__foundry` surface. The
// environment stays `node` — the suites drive a browser, they do not run in one.
//
// The browser-drive scaffolding this project will carry — `globalSetup.ts`
// starting the one server and the one Chromium the whole project shares,
// `setup.ts` returning each worker's page, `chromium.ts`, `constants.ts`,
// `audio-init.js` and the injected `recorder-init.js` that makes a replay output
// possible without an engine — lands with the suites themselves, and this config
// gains its `globalSetup`, `setupFiles`, `maxWorkers` and raised timeouts at the
// same moment. Until then it names no file it does not ship.

import { defineConfig } from "vitest/config";

export default defineConfig({
  root: new URL("..", import.meta.url).pathname,
  test: {
    name: "validation",
    include: ["validation/**/*.test.ts"],
    environment: "node",
    // A missing validator is a broken suite, not a passing one.
    passWithNoTests: false,
    coverage: { enabled: false },
    // Each frame of a drive is a crossing into the page, and a wave driven to its
    // clear is thousands of them; generous here, and still seconds in practice.
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
