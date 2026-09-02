// Wick — the vitest project the CASE's validators run as. CASE-PROVIDED.
//
// A project of its own, separate from the build's `vitest.config.ts` at the
// workspace root. The two never mix: the build's config names
// `src/**/*.test.ts` and measures coverage over `src/`, so the tests a build
// wrote are counted and covered on their own, and the verdict rests on the
// checks in this directory alone. A build cannot reach the verdict by writing
// a test, and a case's check cannot flatter the build's coverage.
//
//   npx vitest run                                       # the build's own tests
//   npx vitest run --config validation/vitest.config.ts  # the case's validators
//
// The root is the workspace, not this directory, so a validator resolves the
// build's modules by the same relative paths the build itself uses. It is
// derived from this file's own URL rather than from the working directory, so
// the command above works from anywhere.
//
// The environment is `node`. The engine takes every measurement from the
// `SurfaceMetrics` the harness supplies, and every reading comes from the
// engine's own object model, its events, and the draw commands it records, so
// these suites need no DOM.

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("..", import.meta.url)),
  test: {
    name: "validation",
    include: ["validation/**/*.test.ts"],
    environment: "node",
    // A missing validator is a broken suite, not a passing one.
    passWithNoTests: false,
    coverage: { enabled: false },
    // A scenario that runs a Flare cooldown of 60 seconds out, walks the
    // director through a window, or carries the clock to dawn is thousands of
    // ticks of the real simulation. The longest is the drop roll's pair check,
    // which kills `DROP_PAIR_TRIALS` (60000) moths and takes the better part of
    // a minute; this leaves it room on a machine several times slower, so a
    // conformant build is never failed by the clock.
    testTimeout: 180_000,
  },
});
