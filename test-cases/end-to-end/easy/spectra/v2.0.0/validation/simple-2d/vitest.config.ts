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
// build by the same relative path the build itself uses. It is derived from this
// file's own URL rather than from the working directory, so the command above
// works from anywhere.
//
// The environment is `node`. The engine runs over an `@napi-rs/canvas` canvas and
// a `SurfaceMetrics` of the harness's own, so these suites need no DOM: a
// scenario is posed through the surface `engine.debug` returns, advanced with the
// engine's own stepping, and read back from the snapshot.
//
// SCAFFOLD NOTE: this project is not finished. The validator stage writes
// `harness.ts`, `assert.ts`, `fixtures.ts` and `surface.ts` beside this file, at
// which point this comment goes. Every suite here is a placeholder that THROWS.

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
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
